import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ApiLibraryMethod, ApiLibraryPayloadType } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

type Raw = Record<string, unknown>;

/** One header as stored: the value of a secret header is encrypted. */
export interface StoredApiHeader {
  key: string;
  value: string;
  secret: boolean;
}

/** One saved API as the SQL returns it. Header values of secret headers are still encrypted here. */
export interface ApiRow {
  id: number;
  uuid: string;
  name: string;
  method: ApiLibraryMethod;
  url: string;
  payloadType: ApiLibraryPayloadType;
  variables: Array<{ name: string; source: string; defaultValue: string }>;
  headers: StoredApiHeader[];
  body: Record<string, unknown> | unknown[] | null;
  functionCode: string | null;
  mappingConfig: Array<{ path: string; contactProperty: string; defaultValue: string }>;
  responseVariables: string[];
  createdBy: number | null;
  createdByUuid: string | null;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

const toRow = (r: Raw): ApiRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  method: r.method as ApiLibraryMethod,
  url: r.url as string,
  payloadType: r.payload_type as ApiLibraryPayloadType,
  variables: (r.variables ?? []) as ApiRow['variables'],
  headers: (r.headers ?? []) as StoredApiHeader[],
  body: (r.body ?? null) as ApiRow['body'],
  functionCode: (r.function_code ?? null) as string | null,
  mappingConfig: (r.mapping_config ?? []) as ApiRow['mappingConfig'],
  responseVariables: (r.response_variables ?? []) as string[],
  createdBy: r.created_by === null || r.created_by === undefined ? null : Number(r.created_by),
  createdByUuid: (r.created_by_uuid ?? null) as string | null,
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const SELECT = sql`
  SELECT a.*, to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         u.uuid AS created_by_uuid
  FROM api_library_apis a
  LEFT JOIN users u ON u.org_id = a.org_id AND u.id = a.created_by`;

export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface NewApi {
  name: string;
  method: ApiLibraryMethod;
  url: string;
  payloadType: ApiLibraryPayloadType;
  variables: ApiRow['variables'];
  headers: StoredApiHeader[];
  body: ApiRow['body'];
  functionCode: string | null;
  mappingConfig: ApiRow['mappingConfig'];
  responseVariables: string[];
  createdBy: number | null;
}

/** A flow that has a node calling the API. */
export interface UsageRow {
  uuid: string;
  name: string;
  published: boolean;
  nodeCount: number;
}

/** Rows of `api_library_apis` (RLS keeps every query inside the caller's workspace). */
@Injectable()
export class ApiLibraryRepository {
  /** The WHERE of the list, without the cursor, so a page's rows and the total count the same rows. */
  private listWhere(orgId: number, f: { search?: string; method?: ApiLibraryMethod }): SQL[] {
    const where: SQL[] = [sql`a.org_id = ${orgId}`];
    if (f.method) where.push(sql`a.method = ${f.method}`);
    if (f.search) {
      const like = `%${escapeLike(f.search)}%`;
      where.push(sql`(a.name ILIKE ${like} OR a.url ILIKE ${like})`);
    }
    return where;
  }

  /**
   * One page of the list. Cursor mode (`cursor` or nothing): keyset after the cursor, one extra row to answer `hasMore`. Page mode
   * (`offset` given): exactly `limit` rows from that offset, in the same order (created_at, id), so pages do not overlap.
   */
  async list(
    tx: Tx,
    orgId: number,
    f: {
      search?: string;
      method?: ApiLibraryMethod;
      cursor?: string;
      offset?: number;
      limit: number;
      order: 'asc' | 'desc';
    },
  ): Promise<ApiRow[]> {
    const where = this.listWhere(orgId, f);
    const desc = f.order === 'desc';
    if (f.offset === undefined && f.cursor) {
      const c = decodeCursor(f.cursor);
      const at = c.createdAtIso ?? c.createdAt.toISOString();
      where.push(
        desc
          ? sql`(a.created_at, a.id) < (${at}::timestamptz, ${c.id})`
          : sql`(a.created_at, a.id) > (${at}::timestamptz, ${c.id})`,
      );
    }
    const paged = f.offset !== undefined;
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(where, sql` AND `)}
      ORDER BY ${desc ? sql`a.created_at DESC, a.id DESC` : sql`a.created_at ASC, a.id ASC`}
      LIMIT ${paged ? f.limit : f.limit + 1}${paged ? sql` OFFSET ${f.offset}` : sql``}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** How many APIs match the same filters as `list` (every page). */
  async countMatching(
    tx: Tx,
    orgId: number,
    f: { search?: string; method?: ApiLibraryMethod },
  ): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM api_library_apis a WHERE ${sql.join(this.listWhere(orgId, f), sql` AND `)}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Every API's picker fields, name order. A workspace holds at most MAX_APIS, so no paging. */
  async all(tx: Tx, orgId: number): Promise<ApiRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE a.org_id = ${orgId} ORDER BY lower(a.name), a.id LIMIT 500`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM api_library_apis WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Serialises creation per workspace: the cap check and the insert must not interleave. */
  async lockForCreate(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`api_library:${orgId}`}))`);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ApiRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE a.org_id = ${orgId} AND a.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async nameTaken(tx: Tx, orgId: number, name: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM api_library_apis WHERE org_id = ${orgId} AND lower(name) = lower(${name})`,
    );
    return res.rows.length > 0;
  }

  async insert(tx: Tx, orgId: number, a: NewApi): Promise<ApiRow> {
    const res = await tx.execute(sql`
      INSERT INTO api_library_apis
        (org_id, name, method, url, payload_type, variables, headers, body, function_code, mapping_config, response_variables, created_by)
      VALUES (${orgId}, ${a.name}, ${a.method}, ${a.url}, ${a.payloadType}, ${JSON.stringify(a.variables)}::jsonb,
              ${JSON.stringify(a.headers)}::jsonb, ${a.body === null ? null : JSON.stringify(a.body)}::jsonb, ${a.functionCode},
              ${JSON.stringify(a.mappingConfig)}::jsonb, ${JSON.stringify(a.responseVariables)}::jsonb, ${a.createdBy})
      RETURNING uuid`);
    const uuid = (res.rows[0] as { uuid: string }).uuid;
    return (await this.findByUuid(tx, orgId, uuid))!;
  }

  /** The whole definition at once, guarded by the row version (undefined = someone else saved first). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    a: Omit<NewApi, 'name' | 'createdBy'>,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE api_library_apis SET method = ${a.method}, url = ${a.url}, payload_type = ${a.payloadType},
        variables = ${JSON.stringify(a.variables)}::jsonb, headers = ${JSON.stringify(a.headers)}::jsonb,
        body = ${a.body === null ? null : JSON.stringify(a.body)}::jsonb, function_code = ${a.functionCode},
        mapping_config = ${JSON.stringify(a.mappingConfig)}::jsonb, response_variables = ${JSON.stringify(a.responseVariables)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING 1`);
    return res.rows.length > 0;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM api_library_apis WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * The flows with at least one node that calls the API. A flow's graph is `flow_data.flowNodes[]` with `{ type: 'api_library',
   * data: { apiId } }`; containment on the jsonb finds them without reading every graph into the application.
   */
  async flowsUsing(tx: Tx, orgId: number, apiUuid: string): Promise<UsageRow[]> {
    const probe = JSON.stringify({
      flowNodes: [{ type: 'api_library', data: { apiId: apiUuid } }],
    });
    const res = await tx.execute(sql`
      SELECT f.uuid, f.flow_name AS name, (f.is_published AND f.is_active) AS published,
             (SELECT count(*)::int FROM jsonb_array_elements(f.flow_data -> 'flowNodes') n
               WHERE n ->> 'type' = 'api_library' AND n -> 'data' ->> 'apiId' = ${apiUuid}) AS node_count
      FROM flows f
      WHERE f.org_id = ${orgId} AND jsonb_typeof(f.flow_data -> 'flowNodes') = 'array' AND f.flow_data @> ${probe}::jsonb
      ORDER BY lower(f.flow_name), f.id LIMIT 200`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      name: (r.name as string | null) ?? '',
      published: r.published === true,
      nodeCount: Number(r.node_count),
    }));
  }
}
