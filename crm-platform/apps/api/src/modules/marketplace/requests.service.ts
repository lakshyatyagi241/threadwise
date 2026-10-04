import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CreateMarketRequestInput,
  type MarketRequest,
  type MarketRequestList,
  type MarketRequestListQuery,
  type MarketRequestResult,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { decodeKeyset, encodeKeyset, likePattern, requestNameKey } from './marketplace-rules';
import { iso } from './sql-helpers';

type Raw = Record<string, unknown>;

const COLUMNS = sql.raw(
  `r.id, r.uuid, r.name, r.kind, r.category_slug, r.status, r.vote_count, r.created_at, r.created_at::text AS created_text`,
);

const toRequest = (r: Raw, hasVoted: boolean): MarketRequest => ({
  id: r.uuid as string,
  name: r.name as string,
  kind: r.kind as MarketRequest['kind'],
  categorySlug: (r.category_slug as string | null) ?? null,
  status: r.status as MarketRequest['status'],
  voteCount: Number(r.vote_count),
  hasVoted,
  createdAt: iso(r.created_at)!,
});

/**
 * "Request an integration" and its votes (spec 6.1, M-16), for the calling workspace. A request is one row per normalised name across
 * the platform, so asking for what someone else asked for is a vote on it; a workspace counts once per request. The vote count is kept by
 * a database trigger (a workspace cannot update the platform's row), so it is the same number the operator's report shows. The note a
 * workspace writes sits on its own vote row and is read only by the operator.
 */
@Injectable()
export class RequestsService {
  constructor(private readonly db: DatabaseService) {}

  async create(input: CreateMarketRequestInput): Promise<MarketRequestResult> {
    const ctx = RequestContextStore.require();
    const key = requestNameKey(input.name);
    if (key.length < 2) {
      throw AppError.validation('Give the name of the app or service', [
        { path: 'name', message: 'Too short' },
      ]);
    }
    return this.db.tx(async (tx) => {
      let created = false;
      let found = await this.byKey(tx, input.kind, key);
      if (!found) {
        const ins = await tx.execute(sql`
          INSERT INTO market_requests (name, name_key, kind, category_slug, website, created_by_org_id)
          VALUES (${input.name}, ${key}, ${input.kind}, ${input.categorySlug ?? null}, ${input.website ?? null}, ${ctx.orgId})
          ON CONFLICT (kind, name_key) DO NOTHING RETURNING id`);
        created = (ins.rows as Raw[]).length > 0;
        found = await this.byKey(tx, input.kind, key);
      }
      if (!found) throw this.notFound();
      await tx.execute(sql`
        INSERT INTO market_request_votes (org_id, request_id, user_id, note)
        VALUES (${ctx.orgId}, ${found.id}, ${ctx.userId}, ${input.note ?? null})
        ON CONFLICT (org_id, request_id) DO NOTHING`);
      return { request: await this.one(tx, ctx.orgId, found.uuid), created };
    });
  }

  async list(q: MarketRequestListQuery): Promise<MarketRequestList> {
    const { orgId } = RequestContextStore.require();
    const where: SQL[] = [sql`true`];
    if (q.q) where.push(sql`r.name ILIKE ${likePattern(q.q)}`);
    if (q.kind) where.push(sql`r.kind = ${q.kind}`);
    if (q.status) where.push(sql`r.status = ${q.status}`);
    const byVotes = q.sort === 'votes';
    if (q.cursor) {
      const k = decodeKeyset(q.cursor, 1);
      if (!k)
        throw AppError.validation('Invalid pagination cursor', [
          { path: 'cursor', message: 'malformed' },
        ]);
      where.push(
        byVotes
          ? sql`(r.vote_count, r.id) < (${k.keys[0]!}::int, ${k.id}::bigint)`
          : sql`(r.created_at, r.id) < (${k.keys[0]!}::timestamptz, ${k.id}::bigint)`,
      );
    }
    const rows = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLUMNS}, (v.id IS NOT NULL) AS has_voted
        FROM market_requests r
        LEFT JOIN market_request_votes v ON v.request_id = r.id AND v.org_id = ${orgId}
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY ${byVotes ? sql`r.vote_count DESC, r.id DESC` : sql`r.created_at DESC, r.id DESC`}
        LIMIT ${q.limit + 1}`);
      return res.rows as Raw[];
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map((r) => toRequest(r, Boolean(r.has_voted))),
      page: {
        nextCursor:
          hasMore && last
            ? encodeKeyset(
                [byVotes ? String(last.vote_count) : String(last.created_text)],
                Number(last.id),
              )
            : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  /** Adds this workspace's vote. Voting twice is the same as once. */
  async vote(uuid: string): Promise<MarketRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const r = await this.byUuid(tx, uuid);
      if (!r) throw this.notFound();
      await tx.execute(sql`
        INSERT INTO market_request_votes (org_id, request_id, user_id) VALUES (${ctx.orgId}, ${r.id}, ${ctx.userId})
        ON CONFLICT (org_id, request_id) DO NOTHING`);
      return this.one(tx, ctx.orgId, uuid);
    });
  }

  async unvote(uuid: string): Promise<MarketRequest> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const r = await this.byUuid(tx, uuid);
      if (!r) throw this.notFound();
      await tx.execute(
        sql`DELETE FROM market_request_votes WHERE org_id = ${ctx.orgId} AND request_id = ${r.id}`,
      );
      return this.one(tx, ctx.orgId, uuid);
    });
  }

  private async byKey(
    tx: Tx,
    kind: string,
    key: string,
  ): Promise<{ id: number; uuid: string } | null> {
    const res = await tx.execute(
      sql`SELECT id, uuid FROM market_requests WHERE kind = ${kind} AND name_key = ${key}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? { id: Number(r.id), uuid: r.uuid as string } : null;
  }

  private async byUuid(tx: Tx, uuid: string): Promise<{ id: number } | null> {
    const res = await tx.execute(sql`SELECT id FROM market_requests WHERE uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? { id: Number(r.id) } : null;
  }

  private async one(tx: Tx, orgId: number, uuid: string): Promise<MarketRequest> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, (v.id IS NOT NULL) AS has_voted
      FROM market_requests r LEFT JOIN market_request_votes v ON v.request_id = r.id AND v.org_id = ${orgId}
      WHERE r.uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    if (!r) throw this.notFound();
    return toRequest(r, Boolean(r.has_voted));
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);
  }
}
