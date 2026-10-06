import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import type { SenderRef } from './outbound';

const ENGINES = new Set(['baileys', 'waba', 'twilio']);
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');

/** The sender's own number: country-code digits + local digits unless the local number already begins with them. */
export function senderDigits(countryCode: string | null, phone: string | null): string {
  const local = digits(phone);
  if (local === '') return '';
  if ((phone ?? '').trim().startsWith('+')) return local;
  const cc = digits(countryCode);
  return cc !== '' && !local.startsWith(cc) ? `${cc}${local}` : local;
}

/**
 * Finds the number a send goes out through (WD-NODE-022: the row names the engine, the engine names the table).
 * The unofficial engine's numbers are `devices`; Cloud API and Twilio numbers are `wa_provider_configs`. A row that is
 * not connected is not a sender: the caller reports "no sender" instead of trying.
 */
@Injectable()
export class SenderResolver {
  constructor(
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  /**
   * `provider` is the engine the row asked for; blank means the unofficial engine, as in WaDesk, while the platform switch
   * for it is on. With the switch off blank means the Cloud API (`waba`), and a row that names `baileys` has no sender: the
   * caller reports "no sender" and leaves the row untouched (owner decision 2026-10-05).
   */
  async resolve(
    tx: Tx,
    orgId: number,
    pick: { provider: string | null; deviceId: number | null },
  ): Promise<SenderRef | null> {
    const unofficialOn = await this.unofficial.isEnabled();
    const engine =
      pick.provider && ENGINES.has(pick.provider)
        ? pick.provider
        : unofficialOn
          ? 'baileys'
          : 'waba';

    if (engine === 'baileys') {
      if (!unofficialOn) return null;
      const res = await tx.execute(sql`
        SELECT id, country_code, phone_number, coalesce(nullif(device_name, ''), phone_number) AS label
        FROM devices
        WHERE org_id = ${orgId} AND status = 'connected' AND active
          AND (${pick.deviceId}::bigint IS NULL OR id = ${pick.deviceId})
        ORDER BY id DESC LIMIT 1`);
      const r = res.rows[0] as
        | {
            id: number | string;
            country_code: string | null;
            phone_number: string | null;
            label: string | null;
          }
        | undefined;
      return r
        ? {
            engine,
            id: Number(r.id),
            phoneDigits: senderDigits(r.country_code, r.phone_number),
            label: r.label ?? '',
          }
        : null;
    }

    const res = await tx.execute(sql`
      SELECT id, phone_number, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider = ${engine} AND status = 'connected'
        AND (${pick.deviceId}::bigint IS NULL OR id = ${pick.deviceId})
      ORDER BY is_primary DESC, id DESC LIMIT 1`);
    const r = res.rows[0] as
      { id: number | string; phone_number: string | null; label: string | null } | undefined;
    return r
      ? {
          engine,
          id: Number(r.id),
          phoneDigits: senderDigits(null, r.phone_number),
          label: r.label ?? '',
        }
      : null;
  }
}
