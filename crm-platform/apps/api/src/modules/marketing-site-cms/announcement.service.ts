import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  type Announcement,
  type AnnouncementListQuery,
  type AnnouncementListResponse,
  type CreateAnnouncementRequest,
  type LiveAnnouncementsResponse,
  type UpdateAnnouncementRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService } from '../auth';
import { CMS_EVENTS, iso, num, operatorId } from './cms-context';
import { decodeTupleCursor, encodeTupleCursor, escapeLike } from './cms-rules';
import { CmsStore } from './cms-store';

interface Row {
  id: string | number;
  uuid: string;
  text: string;
  link_url: string | null;
  link_label: string | null;
  tone: Announcement['tone'];
  is_active: boolean;
  dismissible: boolean;
  sort_order: number;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  status: Announcement['status'];
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Status is decided by the database clock: one clock for the window test and for the list. */
const SELECT = sql`
  SELECT id, uuid, text, link_url, link_label, tone, is_active, dismissible, sort_order, starts_at, expires_at,
         row_version, created_at, updated_at,
         CASE WHEN NOT is_active THEN 'disabled'
              WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
              WHEN starts_at IS NOT NULL AND starts_at > now() THEN 'scheduled'
              ELSE 'live' END AS status
  FROM announcements`;

const LIVE = sql`is_active AND (starts_at IS NULL OR starts_at <= now()) AND (expires_at IS NULL OR expires_at >= now())`;

const blank = (v: string | null | undefined): string | null =>
  v && v.trim() !== '' ? v.trim() : null;

const toItem = (r: Row): Announcement => ({
  id: r.uuid,
  text: r.text,
  linkUrl: r.link_url,
  linkLabel: r.link_label,
  tone: r.tone,
  isActive: r.is_active,
  dismissible: r.dismissible,
  sortOrder: num(r.sort_order),
  startsAt: iso(r.starts_at),
  expiresAt: iso(r.expires_at),
  status: r.status,
  rowVersion: num(r.row_version),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

/**
 * Announcements (WD-CMS-017, 039..041). Visibility is evaluated at read, so a schedule boundary takes effect on the
 * next request and no cache can show a stale bar (WaDesk cached for 60 seconds and busted on write). Times are stored
 * as instants; the editor converts the wall-clock time in the chosen zone before it sends (WaDesk stored the wall-clock
 * as if it were server time, a deliberate fix). Link targets are checked by the contract (no `javascript:`).
 */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: CmsStore,
    private readonly audit: AuthAuditService,
  ) {}

  /** The marquee: live rows, `sort_order` then `id` (WD-CMS-017). */
  async live(): Promise<LiveAnnouncementsResponse> {
    const res = await this.db.primary.execute(
      sql`SELECT uuid, text, link_url, link_label, tone, dismissible FROM announcements WHERE ${LIVE} ORDER BY sort_order, id`,
    );
    return {
      data: (
        res.rows as unknown as Array<{
          uuid: string;
          text: string;
          link_url: string | null;
          link_label: string | null;
          tone: Announcement['tone'];
          dismissible: boolean;
        }>
      ).map((r) => ({
        id: r.uuid,
        text: r.text,
        linkUrl: r.link_url,
        linkLabel: r.link_label,
        tone: r.tone,
        dismissible: r.dismissible,
      })),
    };
  }

  async list(q: AnnouncementListQuery): Promise<AnnouncementListResponse> {
    const conds: SQL[] = [sql`TRUE`];
    // WaDesk quirk kept on purpose: "Expired" ignores is_active, so a disabled expired row shows under both pills.
    if (q.status === 'active') conds.push(LIVE);
    else if (q.status === 'inactive') conds.push(sql`NOT is_active`);
    else if (q.status === 'expired') conds.push(sql`expires_at IS NOT NULL AND expires_at < now()`);
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(sql`(text ILIKE ${like} OR link_label ILIKE ${like})`);
    }
    if (q.cursor) {
      const [sort, id] = decodeTupleCursor(q.cursor, 2);
      conds.push(
        sql`(sort_order > ${num(sort)} OR (sort_order = ${num(sort)} AND id < ${num(id)}))`,
      );
    }
    const [rows, tiles] = await Promise.all([
      this.db.primary.execute(
        sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY sort_order ASC, id DESC LIMIT ${q.limit + 1}`,
      ),
      this.db.primary.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE ${LIVE})::int AS live,
               count(*) FILTER (WHERE starts_at IS NOT NULL AND starts_at > now())::int AS scheduled,
               count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < now())::int AS expired,
               count(*) FILTER (WHERE is_active)::int AS switched_on
        FROM announcements`),
    ]);
    const all = rows.rows as unknown as Row[];
    const hasMore = all.length > q.limit;
    const page = hasMore ? all.slice(0, q.limit) : all;
    const last = page[page.length - 1];
    const t = tiles.rows[0] as {
      total: number;
      live: number;
      scheduled: number;
      expired: number;
      switched_on: number;
    };
    return {
      data: page.map(toItem),
      page: {
        hasMore,
        limit: q.limit,
        nextCursor:
          hasMore && last ? encodeTupleCursor([num(last.sort_order), num(last.id)]) : null,
      },
      summary: {
        total: num(t.total),
        live: num(t.live),
        scheduled: num(t.scheduled),
        expired: num(t.expired),
        switchedOn: num(t.switched_on),
      },
    };
  }

  private async find(tx: Tx | DatabaseService['primary'], uuid: string): Promise<Row | null> {
    const res = await tx.execute(sql`${SELECT} WHERE uuid = ${uuid}`);
    return (res.rows[0] as unknown as Row | undefined) ?? null;
  }

  async get(uuid: string): Promise<Announcement> {
    const row = await this.find(this.db.primary, uuid);
    if (!row) throw AppError.notFound('Announcement', uuid);
    return toItem(row);
  }

  async create(req: CreateAnnouncementRequest): Promise<Announcement> {
    operatorId();
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO announcements (text, link_url, link_label, tone, is_active, dismissible, sort_order, starts_at, expires_at)
        VALUES (${req.text}, ${blank(req.linkUrl)}, ${blank(req.linkLabel)}, ${req.tone}, ${req.isActive},
                ${req.dismissible}, ${req.sortOrder}, ${req.startsAt ?? null}, ${req.expiresAt ?? null})
        RETURNING uuid`);
      const uuid = (res.rows[0] as { uuid: string }).uuid;
      await this.audit.record(tx, {
        event: CMS_EVENTS.announcementChanged,
        status: 'success',
        payload: { action: 'created', uuid, tone: req.tone },
      });
      return toItem((await this.find(tx, uuid))!);
    });
  }

  async update(uuid: string, req: UpdateAnnouncementRequest): Promise<Announcement> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, row_version FROM announcements WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as { id: string | number; row_version: number } | undefined;
      if (!cur) throw AppError.notFound('Announcement', uuid);
      if (num(cur.row_version) !== req.rowVersion) {
        throw AppError.rowVersionConflict('This announcement');
      }
      await tx.execute(sql`
        UPDATE announcements
        SET text = ${req.text}, link_url = ${blank(req.linkUrl)}, link_label = ${blank(req.linkLabel)},
            tone = ${req.tone}, is_active = ${req.isActive}, dismissible = ${req.dismissible},
            sort_order = ${req.sortOrder}, starts_at = ${req.startsAt ?? null}, expires_at = ${req.expiresAt ?? null}
        WHERE id = ${cur.id}`);
      await this.audit.record(tx, {
        event: CMS_EVENTS.announcementChanged,
        status: 'success',
        payload: { action: 'updated', uuid, tone: req.tone },
      });
      return toItem((await this.find(tx, uuid))!);
    });
  }

  async toggle(uuid: string, rowVersion?: number): Promise<Announcement> {
    operatorId();
    return this.store.tx(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, is_active, row_version FROM announcements WHERE uuid = ${uuid} FOR UPDATE`,
      );
      const cur = locked.rows[0] as
        { id: string | number; is_active: boolean; row_version: number } | undefined;
      if (!cur) throw AppError.notFound('Announcement', uuid);
      if (rowVersion !== undefined && num(cur.row_version) !== rowVersion) {
        throw AppError.rowVersionConflict('This announcement');
      }
      await tx.execute(
        sql`UPDATE announcements SET is_active = ${!cur.is_active} WHERE id = ${cur.id}`,
      );
      await this.audit.record(tx, {
        event: CMS_EVENTS.announcementChanged,
        status: 'success',
        payload: { action: cur.is_active ? 'disabled' : 'activated', uuid },
      });
      return toItem((await this.find(tx, uuid))!);
    });
  }

  async remove(uuid: string): Promise<void> {
    operatorId();
    await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM announcements WHERE uuid = ${uuid} RETURNING id`,
      );
      if (!res.rows[0]) throw AppError.notFound('Announcement', uuid);
      await this.audit.record(tx, {
        event: CMS_EVENTS.announcementChanged,
        status: 'success',
        payload: { action: 'deleted', uuid },
      });
    });
  }
}
