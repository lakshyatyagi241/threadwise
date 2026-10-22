import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Cursor } from '../../common/pagination/cursor';

/** Satisfied by both a tenant `Tx` and the raw `DatabaseService.primary` handle used outside any tenant context. */
type Executable = Pick<Tx, 'execute'>;

/** A `wa_chat_links` row as the list/builder screens read it. */
export interface WaChatLinkRow {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  country_code: string;
  phone_number: string;
  welcome_message: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  click_count: number;
  last_clicked_at: Date | null;
  expires_at: Date | null;
  status: string;
  created_at: Date;
  created_at_iso: string;
  row_version: number;
}

const COLUMNS =
  sql.raw(`id, uuid, name, slug, country_code, phone_number, welcome_message, utm_source,
  utm_medium, utm_campaign, click_count, last_clicked_at, expires_at, status, created_at, row_version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`);

const toRow = (r: Record<string, unknown>): WaChatLinkRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  slug: String(r.slug),
  country_code: String(r.country_code),
  phone_number: String(r.phone_number),
  welcome_message: (r.welcome_message as string | null) ?? null,
  utm_source: (r.utm_source as string | null) ?? null,
  utm_medium: (r.utm_medium as string | null) ?? null,
  utm_campaign: (r.utm_campaign as string | null) ?? null,
  click_count: Number(r.click_count),
  last_clicked_at: r.last_clicked_at ? new Date(r.last_clicked_at as string) : null,
  expires_at: r.expires_at ? new Date(r.expires_at as string) : null,
  status: String(r.status),
  created_at: new Date(r.created_at as string),
  created_at_iso: String(r.created_at_iso),
  row_version: Number(r.row_version),
});

export interface WaChatLinkStatsRow {
  all: number;
  live: number;
  totalClicks: number;
  avgClicksPerLink: number;
}

/**
 * Tenant-scoped access to `wa_chat_links` (WFL; docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-012..018).
 * Every authenticated method runs inside the caller's `DatabaseService.tx`. `findBySlugPublic` is the one exception
 * (see `wa-chat-links.service.ts::resolvePublic`): the public redirect has no tenant context, so it reads by the
 * globally-unique slug alone, the same shape as `forms-builder`'s `web_form_lookup` public-lookup pattern.
 */
@Injectable()
export class WaChatLinksRepository {
  async list(
    tx: Tx,
    orgId: number,
    limit: number,
    status: 'all' | 'live' | 'paused',
    cursor?: Cursor,
  ): Promise<WaChatLinkRow[]> {
    const after = cursor
      ? sql`AND (created_at, id) < (${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
      : sql``;
    const statusFilter =
      status === 'live'
        ? sql`AND status = 'active' AND (expires_at IS NULL OR expires_at > now())`
        : status === 'paused'
          ? sql`AND (status = 'paused' OR (status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()))`
          : sql``;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_chat_links
       WHERE org_id = ${orgId} ${statusFilter} ${after}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit + 1}`);
    return res.rows.map(toRow);
  }

  async stats(tx: Tx, orgId: number): Promise<WaChatLinkStatsRow> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS all,
             (count(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())))::int AS live,
             coalesce(sum(click_count), 0)::int AS total_clicks
        FROM wa_chat_links WHERE org_id = ${orgId}`);
    const r = (res.rows[0] ?? {}) as Record<string, unknown>;
    const all = Number(r.all ?? 0);
    const totalClicks = Number(r.total_clicks ?? 0);
    return {
      all,
      live: Number(r.live ?? 0),
      totalClicks,
      avgClicksPerLink: all > 0 ? totalClicks / all : 0,
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<WaChatLinkRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_chat_links WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid
      ${lock ? sql`FOR UPDATE` : sql``}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  /**
   * Public redirect lookup: no tenant context, and the slug namespace is global — so this goes through the
   * `wa_chat_link_lookup` SECURITY DEFINER function (RLS would otherwise hide every row). Returns only what the
   * redirect needs, never the full row.
   */
  async lookupPublic(
    tx: Executable,
    slug: string,
  ): Promise<{
    org_id: number;
    id: number;
    country_code: string;
    phone_number: string;
    welcome_message: string | null;
    status: string;
    expires_at: Date | null;
  } | null> {
    const res = await tx.execute(sql`SELECT * FROM wa_chat_link_lookup(${slug})`);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.route_org_id == null) return null;
    return {
      org_id: Number(row.route_org_id),
      id: Number(row.route_id),
      country_code: String(row.route_country_code),
      phone_number: String(row.route_phone_number),
      welcome_message: (row.route_welcome_message as string | null) ?? null,
      status: String(row.route_status),
      expires_at: row.route_expires_at ? new Date(row.route_expires_at as string) : null,
    };
  }

  /** Atomic click bump by internal id, through the SECURITY DEFINER function (no tenant context on the public path). */
  async recordClickPublic(tx: Executable, id: number): Promise<void> {
    await tx.execute(sql`SELECT wa_chat_link_record_click(${id})`);
  }

  /**
   * Slug uniqueness is global (the public `/l/{slug}` namespace is shared across every workspace), so this checks
   * through the `wa_chat_link_slug_taken` SECURITY DEFINER function rather than a plain SELECT, which RLS would
   * otherwise scope to the caller's own org.
   */
  async freshSlug(tx: Tx, base: string, excludeId?: number): Promise<string> {
    let candidate = base;
    for (let n = 2; n < 1000; n++) {
      const res = await tx.execute(
        sql`SELECT wa_chat_link_slug_taken(${candidate}, ${excludeId ?? null}) AS taken`,
      );
      const taken = Boolean((res.rows[0] as Record<string, unknown> | undefined)?.taken);
      if (!taken) return candidate;
      candidate = `${base}-${n}`;
    }
    return `${base}-${Date.now()}`;
  }

  static randomSlug(): string {
    return Math.random().toString(36).slice(2, 10).padEnd(8, '0').slice(0, 8);
  }

  async insert(
    tx: Tx,
    orgId: number,
    userId: number | null,
    input: {
      name: string;
      slug: string;
      countryCode: string;
      phoneNumber: string;
      welcomeMessage: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      expiresAt: Date | null;
      status: string;
    },
  ): Promise<WaChatLinkRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_chat_links (org_id, user_id, name, slug, country_code, phone_number, welcome_message,
                                  utm_source, utm_medium, utm_campaign, expires_at, status)
      VALUES (${orgId}, ${userId}, ${input.name}, ${input.slug}, ${input.countryCode}, ${input.phoneNumber},
              ${input.welcomeMessage}, ${input.utmSource}, ${input.utmMedium}, ${input.utmCampaign},
              ${input.expiresAt}, ${input.status})
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    input: {
      name: string;
      countryCode: string;
      phoneNumber: string;
      welcomeMessage: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      expiresAt: Date | null;
      status: string;
    },
  ): Promise<WaChatLinkRow | null> {
    const res = await tx.execute(sql`
      UPDATE wa_chat_links SET
        name = ${input.name}, country_code = ${input.countryCode}, phone_number = ${input.phoneNumber},
        welcome_message = ${input.welcomeMessage}, utm_source = ${input.utmSource}, utm_medium = ${input.utmMedium},
        utm_campaign = ${input.utmCampaign}, expires_at = ${input.expiresAt}, status = ${input.status}
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING ${COLUMNS}`);
    return res.rows[0] ? toRow(res.rows[0]) : null;
  }

  async duplicate(
    tx: Tx,
    orgId: number,
    userId: number | null,
    source: WaChatLinkRow,
    newSlug: string,
  ): Promise<WaChatLinkRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_chat_links (org_id, user_id, name, slug, country_code, phone_number, welcome_message,
                                  utm_source, utm_medium, utm_campaign, expires_at, status)
      VALUES (${orgId}, ${userId}, ${`${source.name} (copy)`}, ${newSlug}, ${source.country_code}, ${source.phone_number},
              ${source.welcome_message}, ${source.utm_source}, ${source.utm_medium}, ${source.utm_campaign},
              ${source.expires_at}, ${source.status})
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wa_chat_links WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
