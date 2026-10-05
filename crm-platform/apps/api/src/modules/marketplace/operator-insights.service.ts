import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type MarketOperatorRequest,
  type MarketOperatorRequestList,
  type MarketOperatorRequestListQuery,
  type MarketUsage,
  type UpdateMarketRequestInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { OperatorCatalogueStore } from './operator-catalogue.store';
import { decodeKeyset, encodeKeyset, likePattern } from './marketplace-rules';
import { iso } from './sql-helpers';

type Raw = Record<string, unknown>;

const toRequest = (r: Raw): MarketOperatorRequest => ({
  id: r.uuid as string,
  name: r.name as string,
  kind: r.kind as MarketOperatorRequest['kind'],
  categorySlug: (r.category_slug as string | null) ?? null,
  website: (r.website as string | null) ?? null,
  status: r.status as MarketOperatorRequest['status'],
  voteCount: Number(r.vote_count),
  notes: ((r.notes as string[] | null) ?? []).filter((n) => n !== null && n !== ''),
  firstWorkspace: r.org_uuid ? { id: r.org_uuid as string, name: r.org_name as string } : null,
  operatorNote: (r.operator_note as string | null) ?? null,
  createdAt: iso(r.created_at)!,
  rowVersion: Number(r.row_version),
});

const REQUEST_SELECT = sql.raw(`
  r.id, r.uuid, r.name, r.kind, r.category_slug, r.website, r.status, r.vote_count, r.operator_note, r.created_at, r.row_version,
  r.created_at::text AS created_text, o.uuid AS org_uuid, o.name AS org_name,
  ARRAY(SELECT v.note FROM market_request_votes v WHERE v.request_id = r.id AND v.note IS NOT NULL AND v.note <> ''
         ORDER BY v.created_at DESC LIMIT 5) AS notes`);

/**
 * The operator's demand report and usage numbers: the requests with their vote counts (the "most requested" list that drives the build
 * order), and per app how many workspaces have it installed, how many are healthy, and how many deliveries arrived or failed.
 */
@Injectable()
export class OperatorInsightsService {
  constructor(
    private readonly store: OperatorCatalogueStore,
    private readonly audit: AuthAuditService,
  ) {}

  async requests(q: MarketOperatorRequestListQuery): Promise<MarketOperatorRequestList> {
    const where: SQL[] = [sql`true`];
    if (q.status) where.push(sql`r.status = ${q.status}`);
    if (q.kind) where.push(sql`r.kind = ${q.kind}`);
    if (q.q) where.push(sql`r.name ILIKE ${likePattern(q.q)}`);
    if (q.cursor) {
      const k = decodeKeyset(q.cursor, 1);
      if (!k)
        throw AppError.validation('Invalid pagination cursor', [
          { path: 'cursor', message: 'malformed' },
        ]);
      where.push(sql`(r.vote_count, r.id) < (${k.keys[0]!}::int, ${k.id}::bigint)`);
    }
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${REQUEST_SELECT}
        FROM market_requests r LEFT JOIN organizations o ON o.id = r.created_by_org_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY r.vote_count DESC, r.id DESC LIMIT ${q.limit + 1}`);
      return res.rows as Raw[];
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map(toRequest),
      page: {
        nextCursor:
          hasMore && last ? encodeKeyset([String(last.vote_count)], Number(last.id)) : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  async updateRequest(
    uuid: string,
    input: UpdateMarketRequestInput,
  ): Promise<MarketOperatorRequest> {
    return this.store.tx(async (tx) => {
      const sets: SQL[] = [];
      if (input.status !== undefined) sets.push(sql`status = ${input.status}`);
      if (input.operatorNote !== undefined) sets.push(sql`operator_note = ${input.operatorNote}`);
      const found = await tx.execute(
        sql`SELECT id, row_version FROM market_requests WHERE uuid = ${uuid}::uuid`,
      );
      const cur = (found.rows as Raw[])[0];
      if (!cur)
        throw new AppError(ERROR_CODES.NOT_FOUND, 'Request not found', HttpStatus.NOT_FOUND);
      if (sets.length > 0) {
        const upd = await tx.execute(sql`
          UPDATE market_requests SET ${sql.join(sets, sql`, `)} WHERE id = ${Number(cur.id)} AND row_version = ${input.rowVersion} RETURNING id`);
        if ((upd.rows as Raw[]).length === 0) throw AppError.rowVersionConflict('Request');
        await this.audit.record(tx, {
          event: 'platform.market.request_updated',
          status: 'success',
          payload: { request: uuid, status: input.status },
        });
      }
      const res = await tx.execute(sql`
        SELECT ${REQUEST_SELECT} FROM market_requests r LEFT JOIN organizations o ON o.id = r.created_by_org_id WHERE r.uuid = ${uuid}::uuid`);
      return toRequest((res.rows as Raw[])[0]!);
    });
  }

  async usage(): Promise<MarketUsage> {
    const { apps, events } = await this.store.tx(async (tx) => ({
      apps: await this.store.usage(tx),
      events: await this.store.events(tx),
    }));
    const byApp = new Map(events.map((e) => [e.uuid as string, e]));
    const zero = { accepted: 0, duplicate: 0, rejected: 0, failed: 0 };
    return {
      data: apps.map((a) => {
        const e = byApp.get(a.uuid as string);
        return {
          appId: a.uuid as string,
          slug: a.slug as string,
          name: a.name as string,
          kind: a.kind as MarketUsage['data'][number]['kind'],
          status: a.status as MarketUsage['data'][number]['status'],
          installs: {
            active: Number(a.active),
            disabled: Number(a.disabled),
            killed: Number(a.killed),
            total: Number(a.total),
          },
          health: {
            healthy: Number(a.healthy),
            degraded: Number(a.degraded),
            error: Number(a.error),
            needsReauth: Number(a.needs_reauth),
            unknown: Number(a.unknown),
          },
          events: {
            last24h: e
              ? {
                  accepted: Number(e.a24),
                  duplicate: Number(e.d24),
                  rejected: Number(e.r24),
                  failed: Number(e.f24),
                }
              : zero,
            last7d: e
              ? {
                  accepted: Number(e.a7),
                  duplicate: Number(e.d7),
                  rejected: Number(e.r7),
                  failed: Number(e.f7),
                }
              : zero,
          },
        };
      }),
    };
  }
}
