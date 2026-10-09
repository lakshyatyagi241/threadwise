import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  API_LIBRARY_LOG_RETENTION_DAYS,
  type ApiLibraryErrorKind,
  type ApiLibraryLogSource,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';
import { escapeLike } from './api-library.repository';

type Raw = Record<string, unknown>;

/** A total above this reads as this (a page-mode count never scans more rows than that). */
export const LOG_COUNT_CAP = 100_000;

export interface LogRow {
  id: number;
  uuid: string;
  apiUuid: string | null;
  apiName: string;
  source: ApiLibraryLogSource;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  errorKind: ApiLibraryErrorKind | null;
  error: string | null;
  responseHeaders: Record<string, string | string[]>;
  responseBody: string | null;
  responseTruncated: boolean;
  userUuid: string | null;
  contactUuid: string | null;
  flowUuid: string | null;
  flowRunUuid: string | null;
  flowNodeId: string | null;
  createdAtIso: string;
  createdAt: Date;
}

export interface NewLog {
  apiUuid: string | null;
  apiName: string;
  source: ApiLibraryLogSource;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  errorKind: ApiLibraryErrorKind | null;
  error: string | null;
  responseHeaders: Record<string, string | string[]>;
  responseBody: string | null;
  responseTruncated: boolean;
  userId: number | null;
  contactUuid: string | null;
  flowId: number | null;
  flowRunUuid: string | null;
  flowNodeId: string | null;
}

export interface LogFilter {
  apiUuid?: string;
  status?: 'success' | 'failed';
  statusCode?: number;
  source?: ApiLibraryLogSource;
  from?: string;
  to?: string;
  search?: string;
  cursor?: string;
  /** Page mode: rows to skip. Present means offset pagination and `cursor` is ignored. */
  offset?: number;
  limit: number;
  order: 'asc' | 'desc';
}

const toLog = (r: Raw): LogRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  apiUuid: (r.api_uuid ?? null) as string | null,
  apiName: r.api_name as string,
  source: r.source as ApiLibraryLogSource,
  method: r.method as string,
  url: r.url as string,
  requestHeaders: (r.request_headers ?? {}) as Record<string, string>,
  requestBody: (r.request_body ?? null) as string | null,
  statusCode: r.status_code === null || r.status_code === undefined ? null : Number(r.status_code),
  ok: r.ok === true,
  durationMs: Number(r.duration_ms),
  errorKind: (r.error_kind ?? null) as ApiLibraryErrorKind | null,
  error: (r.error ?? null) as string | null,
  responseHeaders: (r.response_headers ?? {}) as Record<string, string | string[]>,
  responseBody: (r.response_body ?? null) as string | null,
  responseTruncated: r.response_truncated === true,
  userUuid: (r.user_uuid ?? null) as string | null,
  contactUuid: (r.contact_uuid ?? null) as string | null,
  flowUuid: (r.flow_uuid ?? null) as string | null,
  flowRunUuid: (r.flow_run_uuid ?? null) as string | null,
  flowNodeId: (r.flow_node_id ?? null) as string | null,
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
});

const SELECT = sql`
  SELECT l.*, to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         u.uuid AS user_uuid, f.uuid AS flow_uuid
  FROM api_library_logs l
  LEFT JOIN users u ON u.org_id = l.org_id AND u.id = l.user_id
  LEFT JOIN flows f ON f.org_id = l.org_id AND f.id = l.flow_id`;

/** Rows of `api_library_logs`: a partitioned stream, so every read carries a time bound or a tenant+recency index. */
@Injectable()
export class ApiLibraryLogsRepository {
  async insert(tx: Tx, orgId: number, l: NewLog): Promise<string> {
    const res = await tx.execute(sql`
      INSERT INTO api_library_logs
        (org_id, api_uuid, api_name, source, method, url, request_headers, request_body, status_code, ok, duration_ms, error_kind, error,
         response_headers, response_body, response_truncated, user_id, contact_uuid, flow_id, flow_run_uuid, flow_node_id)
      VALUES (${orgId}, ${l.apiUuid}::uuid, ${l.apiName}, ${l.source}, ${l.method}, ${l.url}, ${JSON.stringify(l.requestHeaders)}::jsonb,
              ${l.requestBody}, ${l.statusCode}, ${l.ok}, ${l.durationMs}, ${l.errorKind}, ${l.error}, ${JSON.stringify(l.responseHeaders)}::jsonb,
              ${l.responseBody}, ${l.responseTruncated}, ${l.userId}, ${l.contactUuid}::uuid, ${l.flowId}, ${l.flowRunUuid}::uuid, ${l.flowNodeId})
      RETURNING uuid`);
    return (res.rows[0] as { uuid: string }).uuid;
  }

  /**
   * The WHERE shared by a page and its total. In page mode a log with no lower time bound gets one: the retention window (the daily
   * sweep deletes older rows anyway, so nothing visible is lost), which lets Postgres prune the monthly partitions of the count and of
   * the OFFSET scan instead of walking all of them.
   */
  private where(orgId: number, f: LogFilter, paged: boolean): SQL[] {
    const where: SQL[] = [sql`l.org_id = ${orgId}`];
    if (f.apiUuid) where.push(sql`l.api_uuid = ${f.apiUuid}::uuid`);
    if (f.status === 'success') where.push(sql`l.ok`);
    if (f.status === 'failed') where.push(sql`NOT l.ok`);
    if (f.statusCode !== undefined) where.push(sql`l.status_code = ${f.statusCode}`);
    if (f.source) where.push(sql`l.source = ${f.source}`);
    if (f.from) where.push(sql`l.created_at >= ${f.from}::timestamptz`);
    else if (paged)
      where.push(
        sql`l.created_at >= now() - make_interval(days => ${API_LIBRARY_LOG_RETENTION_DAYS + 1})`,
      );
    if (f.to) where.push(sql`l.created_at <= ${f.to}::timestamptz`);
    if (f.search) {
      const like = `%${escapeLike(f.search)}%`;
      where.push(sql`(l.url ILIKE ${like} OR l.api_name ILIKE ${like} OR l.error ILIKE ${like})`);
    }
    return where;
  }

  async list(tx: Tx, orgId: number, f: LogFilter): Promise<LogRow[]> {
    const paged = f.offset !== undefined;
    const where = this.where(orgId, f, paged);
    const desc = f.order === 'desc';
    if (!paged && f.cursor) {
      const c = decodeCursor(f.cursor);
      const at = c.createdAtIso ?? c.createdAt.toISOString();
      where.push(
        desc
          ? sql`(l.created_at, l.id) < (${at}::timestamptz, ${c.id})`
          : sql`(l.created_at, l.id) > (${at}::timestamptz, ${c.id})`,
      );
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${desc ? sql`l.created_at DESC, l.id DESC` : sql`l.created_at ASC, l.id ASC`}
      LIMIT ${paged ? f.limit : f.limit + 1}${paged ? sql` OFFSET ${f.offset}` : sql``}`);
    return (res.rows as Raw[]).map(toLog);
  }

  /** Rows matching the same filters as a page-mode `list`, counted up to LOG_COUNT_CAP (work stays bounded on a busy workspace). */
  async countMatching(tx: Tx, orgId: number, f: LogFilter): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM api_library_logs l WHERE ${sql.join(this.where(orgId, f, true), sql` AND `)} LIMIT ${LOG_COUNT_CAP}
      ) c`);
    return Number((res.rows[0] as { n: number }).n);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<LogRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE l.org_id = ${orgId} AND l.uuid = ${uuid}::uuid LIMIT 1`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toLog(r) : undefined;
  }
}
