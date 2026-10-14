import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConsentNoticeScope } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface NoticeRow {
  version: number;
  enabled: boolean;
  text: string;
  url: string | null;
  channels: string[];
  createdAt: string;
}

type Raw = Record<string, unknown>;
const toRow = (r: Raw): NoticeRow => ({
  version: Number(r.version),
  enabled: r.enabled === true,
  text: String(r.text ?? ''),
  url: (r.url as string | null) ?? null,
  channels: Array.isArray(r.channels) ? (r.channels as string[]) : [],
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
});

/** SQL of the versioned consent notices. Every statement is tenant scoped by `org_id` (and by forced RLS underneath). */
@Injectable()
export class ConsentNoticeRepository {
  /** The newest version of an intake point's notice, or null when none was ever saved. */
  async current(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
  ): Promise<NoticeRow | null> {
    const res = await tx.execute(sql`
      SELECT version, enabled, text, url, channels, created_at FROM consent_notices
      WHERE org_id = ${orgId} AND scope = ${scope} AND scope_ref = ${ref}
      ORDER BY version DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : null;
  }

  /** One named version (what a person saw), enabled or not. */
  async version(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
    version: number,
  ): Promise<NoticeRow | null> {
    const res = await tx.execute(sql`
      SELECT version, enabled, text, url, channels, created_at FROM consent_notices
      WHERE org_id = ${orgId} AND scope = ${scope} AND scope_ref = ${ref} AND version = ${version}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : null;
  }

  async insert(
    tx: Tx,
    orgId: number,
    row: {
      scope: ConsentNoticeScope;
      ref: string;
      version: number;
      enabled: boolean;
      text: string;
      url: string | null;
      channels: string[];
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO consent_notices (org_id, scope, scope_ref, version, enabled, text, url, channels, created_by)
      VALUES (${orgId}, ${row.scope}, ${row.ref}, ${row.version}, ${row.enabled}, ${row.text}, ${row.url}, ${`{${row.channels.join(',')}}`}::text[], ${row.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Does the intake point exist in this workspace? `ref` is the widget or booking type uuid, or `<store kind>:<integration uuid>`. */
  async targetExists(
    tx: Tx,
    orgId: number,
    scope: ConsentNoticeScope,
    ref: string,
  ): Promise<boolean> {
    const uuid = scope === 'commerce' ? ref.split(':')[1] : ref;
    if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return false;
    let res;
    if (scope === 'widget') {
      res = await tx.execute(
        sql`SELECT 1 FROM chatbot_widgets WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
      );
    } else if (scope === 'booking') {
      res = await tx.execute(
        sql`SELECT 1 FROM booking_types WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
      );
    } else if (ref.startsWith('shopify:')) {
      res = await tx.execute(
        sql`SELECT 1 FROM shopify_integrations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
      );
    } else if (ref.startsWith('woocommerce:')) {
      res = await tx.execute(
        sql`SELECT 1 FROM woocommerce_integrations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
      );
    } else {
      return false;
    }
    return res.rows.length > 0;
  }
}
