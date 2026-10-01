import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ResolvedSender, SenderDirectory } from './tokens';

const ENGINES = new Set(['baileys', 'waba', 'twilio', 'sms']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads `devices` and `wa_provider_configs` directly until the device and WABA domains export their own lookup. */
@Injectable()
export class SqlSenderDirectory implements SenderDirectory {
  async resolve(tx: Tx, orgId: number, keys: readonly string[]): Promise<ResolvedSender[]> {
    const out = new Map<string, ResolvedSender>();
    for (const raw of keys) {
      const key = raw.trim();
      const [engine, uuid] = key.split(':');
      if (!engine || !uuid || !ENGINES.has(engine) || !UUID.test(uuid)) continue;
      if (out.has(key)) continue;

      const res =
        engine === 'baileys'
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
    return engine && ENGINES.has(engine) ? engine : 'baileys';
  }
}
