import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import { RequestContextStore } from '../../../common/context/request-context';
import { senderDigits } from '../recipient-phone';
import type { DispatchSender, ResolvedSender, SenderDirectory } from './tokens';

const ENGINES = new Set(['baileys', 'waba', 'twilio', 'sms', 'email']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A connected mailbox a campaign may send from (`email:<mailbox uuid>`). A shared mailbox is the company's, so anyone who may send a
 * campaign may pick it; a personal one belongs to its owner alone, so nobody else can send bulk mail from another person's inbox.
 */
const emailMailbox = (orgId: number, uuid: string, userId: number | null) => sql`
  SELECT id, coalesce(nullif(display_name, ''), address::text) AS label
  FROM mail_mailboxes
  WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'connected'
    AND (scope = 'shared' OR (owner_user_id IS NOT NULL AND owner_user_id = ${userId}))`;

/**
 * Reads `devices`, `wa_provider_configs` and `mail_mailboxes` directly until the device and WABA domains export their own lookup.
 *
 * While the platform's unofficial-engine switch is off (owner decision 2026-10-05) no `baileys` sender exists here: a picked
 * `baileys:` key is dropped, the default engine is `waba`, and a stored broadcast that names `baileys` has no sender.
 */
@Injectable()
export class SqlSenderDirectory implements SenderDirectory {
  constructor(
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async resolve(tx: Tx, orgId: number, keys: readonly string[]): Promise<ResolvedSender[]> {
    const out = new Map<string, ResolvedSender>();
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    for (const raw of keys) {
      const key = raw.trim();
      const [engine, uuid] = key.split(':');
      if (!engine || !uuid || !ENGINES.has(engine) || !UUID.test(uuid)) continue;
      if (engine === 'baileys' && !unofficialOn) continue;
      if (out.has(key)) continue;

      const res =
        engine === 'email'
          ? await tx.execute(emailMailbox(orgId, uuid, RequestContextStore.peek()?.userId ?? null))
          : engine === 'baileys'
            ? await tx.execute(sql`
              SELECT id, coalesce(nullif(device_name, ''), phone_number) AS label
              FROM devices
              WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'connected' AND active`)
            : await tx.execute(sql`
              SELECT id, coalesce(nullif(display_label, ''), phone_number) AS label
              FROM wa_provider_configs
              WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND provider = ${engine} AND status = 'connected'`);
      const row = res.rows[0] as { id: number | string; label: string | null } | undefined;
      if (row) out.set(key, { key, id: Number(row.id), engine, label: row.label ?? '' });
    }
    return [...out.values()];
  }

  async defaultEngine(tx: Tx, orgId: number): Promise<string> {
    const res = await tx.execute(
      sql`SELECT default_engine FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
    );
    const engine = (res.rows[0] as { default_engine: string | null } | undefined)?.default_engine;
    if (
      engine &&
      ENGINES.has(engine) &&
      (engine !== 'baileys' || (await this.unofficial.isEnabledFor(orgId)))
    ) {
      return engine;
    }
    // No setting, or `baileys` while the engine is off: the official Cloud API.
    return (await this.unofficial.isEnabledFor(orgId)) ? 'baileys' : 'waba';
  }

  async resolveForDispatch(
    tx: Tx,
    orgId: number,
    broadcast: { provider: string | null; deviceId: number | null },
  ): Promise<DispatchSender | null> {
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    const engine =
      broadcast.provider && ENGINES.has(broadcast.provider)
        ? broadcast.provider
        : unofficialOn
          ? 'baileys'
          : 'waba';

    if (engine === 'email') {
      // The mailbox the campaign names, as long as it is still connected. A dispatch never swaps it for another mailbox: the sender
      // of an email campaign is a person's or a team's address, and mail that goes out from the wrong one is not recoverable.
      if (broadcast.deviceId === null) return null;
      const res = await tx.execute(sql`
        SELECT id, address::text AS address, coalesce(nullif(display_name, ''), address::text) AS label
        FROM mail_mailboxes
        WHERE org_id = ${orgId} AND id = ${broadcast.deviceId} AND status = 'connected'`);
      const m = res.rows[0] as { id: number | string; address: string; label: string } | undefined;
      // The From address stands where an SMS sender's From value does: it is what makes the sender usable.
      return m ? { engine, id: Number(m.id), phoneDigits: m.address, label: m.label } : null;
    }

    if (engine === 'baileys') {
      if (!unofficialOn) return null;
      const res = await tx.execute(sql`
        SELECT id, country_code, phone_number, coalesce(nullif(device_name, ''), phone_number) AS label
        FROM devices
        WHERE org_id = ${orgId}
          AND (id = ${broadcast.deviceId} OR status = 'connected')
        ORDER BY (id = ${broadcast.deviceId}) DESC NULLS LAST, id DESC
        LIMIT 1`);
      const r = res.rows[0] as
        | {
            id: number | string;
            country_code: string | null;
            phone_number: string | null;
            label: string | null;
          }
        | undefined;
      if (!r) return null;
      return {
        engine,
        id: Number(r.id),
        phoneDigits: senderDigits(r.country_code, r.phone_number),
        label: r.label ?? '',
      };
    }

    // The row the broadcast names, else the organization's primary connected config of the same provider.
    const res = await tx.execute(sql`
      SELECT id, phone_number, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = ${engine}
        AND (id = ${broadcast.deviceId} OR status = 'connected')
      ORDER BY (id = ${broadcast.deviceId}) DESC NULLS LAST, is_primary DESC, id DESC
      LIMIT 1`);
    const r = res.rows[0] as
      { id: number | string; phone_number: string | null; label: string | null } | undefined;
    if (!r) return null;
    return {
      engine,
      id: Number(r.id),
      // An SMS sender may be an alphanumeric id with no digits at all; its From value, as typed, is what makes it usable.
      phoneDigits:
        engine === 'sms' ? (r.phone_number ?? '').trim() : senderDigits(null, r.phone_number),
      label: r.label ?? '',
    };
  }
}
