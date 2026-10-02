import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { ChannelRegistryService } from '../../chat-conversations';

interface NumberRow {
  org_id: number | string;
  uuid: string;
  status: string;
  phone_number: string | null;
  display_label: string | null;
}

const digits = (s: string | null) => (s ?? '').replace(/\D+/g, '');

/**
 * Keeps one inbox channel (`whatsapp_waba`) per connected WhatsApp number, its handle the number's uuid (TW-WABA-034, 049). The WABA
 * domain owns the number and its credentials; the inbox only needs a channel to hang threads and replies on. The channel is
 * `connected` while the number is, so an agent is not offered a number that cannot send.
 *
 * A number gets its channel when the first message arrives (`ensure`) and by a periodic pass (`reconcile`) that also marks the
 * channel of a number that was removed or disconnected, so the picker is right without a hook in every connect and disconnect path.
 */
@Injectable()
export class WabaChannelSync {
  private readonly logger = new Logger(WabaChannelSync.name);
  /** What was last written per number, so an unchanged number costs no transaction. */
  private readonly seen = new Map<string, { uuid: string; sig: string }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelRegistryService,
  ) {}

  /** The channel uuid for a number, created on first use. */
  async ensure(orgId: number, numberUuid: string): Promise<string | null> {
    const hit = this.seen.get(`${orgId}:${numberUuid}`);
    if (hit) return hit.uuid;
    const row = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, uuid, status, phone_number, display_label
          FROM wa_provider_configs WHERE org_id = ${orgId} AND uuid = ${numberUuid}::uuid AND provider = 'waba'`);
      return (res.rows[0] as unknown as NumberRow | undefined) ?? null;
    });
    return row ? this.write(row) : null;
  }

  /** Every connected number has a channel in the right state; a number that is gone leaves a disconnected channel behind. */
  async reconcile(): Promise<{ synced: number; closed: number }> {
    const numbers = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, uuid, status, phone_number, display_label
          FROM wa_provider_configs WHERE provider = 'waba'`);
      return res.rows as unknown as NumberRow[];
    });
    let synced = 0;
    for (const n of numbers) {
      const before = this.seen.get(`${Number(n.org_id)}:${n.uuid}`)?.sig;
      try {
        await this.write(n);
        if (before !== this.signature(n)) synced++;
      } catch (err) {
        // One number failing must not stop the others.
        this.logger.warn({ number: n.uuid, err: String(err) }, '[WABA] channel sync failed');
      }
    }
    const alive = new Set(numbers.map((n) => n.uuid));
    const orphans = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT org_id, external_id FROM channels
         WHERE kind = 'whatsapp_waba' AND status <> 'disconnected' AND external_id IS NOT NULL`);
      return (res.rows as unknown as Array<{ org_id: number | string; external_id: string }>).filter(
        (r) => !alive.has(r.external_id),
      );
    });
    for (const o of orphans) {
      await this.system(Number(o.org_id), () =>
        this.channels.syncProviderChannel(Number(o.org_id), {
          kind: 'whatsapp_waba',
          externalId: o.external_id,
          name: 'Removed number',
          displayAddress: null,
          connected: false,
          metered: true,
        }),
      ).catch(() => undefined);
    }
    return { synced, closed: orphans.length };
  }

  private signature(n: NumberRow) {
    return `${n.status}|${n.phone_number ?? ''}|${n.display_label ?? ''}`;
  }

  private async write(n: NumberRow): Promise<string> {
    const orgId = Number(n.org_id);
    const key = `${orgId}:${n.uuid}`;
    const sig = this.signature(n);
    const hit = this.seen.get(key);
    if (hit && hit.sig === sig) return hit.uuid;
    const number = digits(n.phone_number);
    const { uuid } = await this.system(orgId, () =>
      this.channels.syncProviderChannel(orgId, {
        kind: 'whatsapp_waba',
        externalId: n.uuid,
        name: (n.display_label ?? '').trim() || (number ? `+${number}` : 'WhatsApp'),
        displayAddress: number ? `+${number}` : null,
        connected: n.status === 'connected',
        // A Cloud API number is billed per message by Meta: it draws on the allowance and the wallet.
        metered: true,
      }),
    );
    this.seen.set(key, { uuid, sig });
    return uuid;
  }

  private system<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    return RequestContextStore.run(
      {
        requestId: `waba-channel-${orgId}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
