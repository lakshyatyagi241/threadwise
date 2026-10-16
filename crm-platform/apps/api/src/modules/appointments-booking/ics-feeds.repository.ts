import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { IcsFeedError, IcsFeedStatus, IcsFeedWarnings } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export interface IcsFeedRow {
  id: number;
  uuid: string;
  name: string;
  /** Sealed with the credentials key: only the feed service opens it. */
  urlEnc: string;
  urlHost: string;
  blockAllDay: boolean;
  isActive: boolean;
  status: IcsFeedStatus;
  lastErrorCode: IcsFeedError | null;
  lastFetchedAt: Date | null;
  lastSuccessAt: Date | null;
  nextFetchAt: Date;
  consecutiveFailures: number;
  etag: string | null;
  lastModified: string | null;
  calendarName: string | null;
  eventCount: number;
  busyCount: number;
  warnings: IcsFeedWarnings;
  createdBy: number | null;
  createdAt: Date;
  rowVersion: number;
}

function toRow(r: Raw): IcsFeedRow {
  const w = (r.warnings ?? {}) as Partial<IcsFeedWarnings>;
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    name: r.name as string,
    urlEnc: r.url_enc as string,
    urlHost: r.url_host as string,
    blockAllDay: r.block_all_day as boolean,
    isActive: r.is_active as boolean,
    status: r.status as IcsFeedStatus,
    lastErrorCode: (r.last_error_code as IcsFeedError | null) ?? null,
    lastFetchedAt: d(r.last_fetched_at),
    lastSuccessAt: d(r.last_success_at),
    nextFetchAt: d(r.next_fetch_at)!,
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    etag: s(r.etag),
    lastModified: s(r.last_modified),
    calendarName: s(r.calendar_name),
    eventCount: Number(r.event_count ?? 0),
    busyCount: Number(r.busy_count ?? 0),
    warnings: {
      unknownZone: Number(w.unknownZone ?? 0),
      unsupportedRule: Number(w.unsupportedRule ?? 0),
      truncated: w.truncated === true,
    },
    createdBy: r.created_by === null ? null : Number(r.created_by),
    createdAt: d(r.created_at)!,
    rowVersion: Number(r.row_version),
  };
}

export interface NewIcsFeed {
  name: string;
  urlEnc: string;
  urlHost: string;
  urlHash: string;
  blockAllDay: boolean;
  createdBy: number | null;
}

/** What a read of the feed left behind. A failure keeps the busy intervals the last good read stored. */
export type FetchOutcome =
  | {
      kind: 'ok';
      etag: string | null;
      lastModified: string | null;
      calendarName: string | null;
      eventCount: number;
      busyCount: number;
      warnings: IcsFeedWarnings;
    }
  | { kind: 'not_modified' }
  | { kind: 'failed'; code: IcsFeedError };

/** The workspace's iCal subscriptions (`calendar_ics_feeds`) and the busy intervals they contribute (`calendar_ics_busy`). */
@Injectable()
export class IcsFeedsRepository {
  async list(tx: Tx, orgId: number): Promise<IcsFeedRow[]> {
    const res = await tx.execute(
      sql`SELECT * FROM calendar_ics_feeds WHERE org_id = ${orgId} ORDER BY created_at ASC, id ASC`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM calendar_ics_feeds WHERE org_id = ${orgId}`,
    );
    return Number((res.rows as Raw[])[0]?.n ?? 0);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<IcsFeedRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM calendar_ics_feeds WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<IcsFeedRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM calendar_ics_feeds WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Null when the workspace already subscribes to that address. */
  async insert(tx: Tx, orgId: number, f: NewIcsFeed): Promise<IcsFeedRow | null> {
    const res = await tx.execute(sql`
      INSERT INTO calendar_ics_feeds (org_id, name, url_enc, url_host, url_hash, block_all_day, created_by)
      VALUES (${orgId}, ${f.name}, ${f.urlEnc}, ${f.urlHost}, ${f.urlHash}, ${f.blockAllDay}, ${f.createdBy})
      ON CONFLICT (org_id, url_hash) DO NOTHING
      RETURNING *`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : null;
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    patch: { name?: string; isActive?: boolean; blockAllDay?: boolean },
  ): Promise<IcsFeedRow | null> {
    const sets = [
      patch.name !== undefined ? sql`name = ${patch.name}` : null,
      patch.isActive !== undefined ? sql`is_active = ${patch.isActive}` : null,
      patch.blockAllDay !== undefined ? sql`block_all_day = ${patch.blockAllDay}` : null,
      // A feed switched back on is read again at once; a changed all-day rule needs a fresh read to take effect.
      patch.isActive === true || patch.blockAllDay !== undefined
        ? sql`next_fetch_at = now(), etag = NULL, last_modified = NULL`
        : null,
    ].filter((x) => x !== null);
    const res = await tx.execute(sql`
      UPDATE calendar_ics_feeds SET ${sql.join(sets, sql`, `)}
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
       RETURNING *`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : null;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM calendar_ics_feeds WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- the refresh job ---------------------------------------------------------------------------------------------------

  /**
   * Active feeds that are due, across all workspaces (the caller is the scheduler, privileged), most overdue first. Claims them by pushing
   * `next_fetch_at` a little way ahead in the same statement, so several workers asking at once get different feeds, and a worker that dies
   * mid-read only delays that feed by the claim.
   */
  async claimDue(
    tx: Tx,
    limit: number,
    claimMs: number,
  ): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      UPDATE calendar_ics_feeds f SET next_fetch_at = now() + (${claimMs} || ' milliseconds')::interval
       WHERE (f.org_id, f.id) IN (
         SELECT org_id, id FROM calendar_ics_feeds
          WHERE is_active AND next_fetch_at <= now()
          ORDER BY next_fetch_at ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED)
       RETURNING f.org_id, f.id`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /**
   * Records what a read found. A good read replaces the feed's busy intervals as a whole in the same transaction; a failure keeps the old
   * ones (a calendar that is down for an hour must not suddenly look empty) and only counts the failure. The monitoring columns do not bump
   * `row_version` (the trigger), so an editing admin never gets a 409 because of a refresh.
   */
  async record(
    tx: Tx,
    orgId: number,
    id: number,
    outcome: FetchOutcome,
    nextFetchAt: Date,
    busy?: Array<{ startMs: number; endMs: number }>,
  ): Promise<void> {
    const next = nextFetchAt.toISOString();
    if (outcome.kind === 'failed') {
      await tx.execute(sql`
        UPDATE calendar_ics_feeds
           SET status = 'error', last_error_code = ${outcome.code}, last_fetched_at = now(),
               consecutive_failures = consecutive_failures + 1, next_fetch_at = ${next}::timestamptz
         WHERE org_id = ${orgId} AND id = ${id}`);
      return;
    }
    if (outcome.kind === 'not_modified') {
      await tx.execute(sql`
        UPDATE calendar_ics_feeds
           SET status = 'ok', last_error_code = NULL, last_fetched_at = now(), last_success_at = now(),
               consecutive_failures = 0, next_fetch_at = ${next}::timestamptz
         WHERE org_id = ${orgId} AND id = ${id}`);
      return;
    }
    await tx.execute(
      sql`DELETE FROM calendar_ics_busy WHERE org_id = ${orgId} AND feed_id = ${id}`,
    );
    const rows = busy ?? [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx.execute(sql`
        INSERT INTO calendar_ics_busy (org_id, feed_id, starts_at, ends_at)
        VALUES ${sql.join(
          chunk.map(
            (b) =>
              sql`(${orgId}, ${id}, ${new Date(b.startMs).toISOString()}::timestamptz, ${new Date(b.endMs).toISOString()}::timestamptz)`,
          ),
          sql`, `,
        )}`);
    }
    await tx.execute(sql`
      UPDATE calendar_ics_feeds
         SET status = 'ok', last_error_code = NULL, last_fetched_at = now(), last_success_at = now(),
             consecutive_failures = 0, next_fetch_at = ${next}::timestamptz,
             etag = ${outcome.etag}, last_modified = ${outcome.lastModified}, calendar_name = ${outcome.calendarName},
             event_count = ${outcome.eventCount}, busy_count = ${outcome.busyCount},
             warnings = ${JSON.stringify(outcome.warnings)}::jsonb
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- the slot engine ---------------------------------------------------------------------------------------------------

  /**
   * The busy intervals of every active feed that was read successfully within `staleDays`, overlapping the range. A feed that has not been
   * read for that long contributes nothing: stale busy time that nobody can see would block slots for no reason anyone can find.
   */
  async busyBetween(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    staleDays: number,
  ): Promise<Array<{ start: Date; end: Date }>> {
    const res = await tx.execute(sql`
      SELECT b.starts_at, b.ends_at FROM calendar_ics_busy b
        JOIN calendar_ics_feeds f ON f.org_id = b.org_id AND f.id = b.feed_id
       WHERE b.org_id = ${orgId} AND f.is_active
         AND f.last_success_at > now() - (${staleDays} || ' days')::interval
         AND b.ends_at > ${from.toISOString()}::timestamptz AND b.starts_at < ${to.toISOString()}::timestamptz
       ORDER BY b.starts_at ASC`);
    return (res.rows as Raw[]).map((r) => ({ start: d(r.starts_at)!, end: d(r.ends_at)! }));
  }
}
