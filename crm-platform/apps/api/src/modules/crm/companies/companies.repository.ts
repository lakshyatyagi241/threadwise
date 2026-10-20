import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  CompanySort,
  CompanySortDir,
  FieldType,
  RecordScope,
  SegmentFieldKind,
  SegmentOperator,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { propertyPredicate, type PropertySort } from '../property-predicates';
import {
  companyDomainSpellings,
  companySortId,
  decodeCompanyCursor,
  decodeIdCursor,
  escapeLike,
  type CursorKeyType,
} from './company-rules';
import type { CompanyPropertyDef } from './company-properties';
import { isTeamPeer, scopeOwnerCondition } from '../../../kernel/rbac/scope';

/** One company as the SQL returns it, with the owner and the creator already joined (names and uuids, never ids on the wire). */
export interface CompanyRow {
  id: number;
  uuid: string;
  displayId: string | null;
  name: string;
  /** The keyset key of the name order (lower-cased name). */
  nameKey: string;
  /** The keyset key of the created order, with microseconds. */
  createdAtIso: string;
  /** The keyset key of a property order (the sort expression as text); null in any other order. */
  sortKey: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  sizeRange: string | null;
  address: string | null;
  notes: string | null;
  /** The values of the workspace's company properties (the `data` column), by property key. */
  data: Record<string, unknown>;
  ownerId: number | null;
  ownerUuid: string | null;
  ownerName: string | null;
  createdById: number | null;
  createdByUuid: string | null;
  createdByName: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Linked contacts and deals of one company, as counted in the database. */
export interface CompanyCounts {
  contacts: number;
  deals: Array<{ status: string; currency: string; n: number; total: bigint }>;
}

/** The columns a PATCH may set, by their SQL names. */
export interface CompanyPatch {
  name?: string;
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
  industry?: string | null;
  size_range?: string | null;
  address?: string | null;
  notes?: string | null;
  /** The whole object to store (the caller merged it). */
  data?: Record<string, unknown>;
  owner_id?: number | null;
}

/** One condition on a company property, already checked against the registry (the kind decides the SQL). */
export interface ResolvedPropertyFilter {
  key: string;
  kind: SegmentFieldKind;
  operator: SegmentOperator;
  value?: unknown;
}

/** A filter with every uuid already resolved to the internal id the SQL needs. */
export interface CompanyFilter {
  q?: string;
  ownerId?: number;
  unassigned?: boolean;
  industry?: string;
  hasOpenDeals?: boolean;
  props?: ResolvedPropertyFilter[];
}

export interface CompanyListInput {
  filter: CompanyFilter;
  scope?: SQL;
  sort: CompanySort;
  /** The order of a `property` sort: how to compute its key. */
  property?: { key: string; sort: PropertySort };
  /** Defaults to newest first for `created`, ascending for the others. */
  dir?: CompanySortDir;
  cursor?: string;
  limit: number;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

const toRow = (r: Raw): CompanyRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  displayId: s(r.display_id),
  name: r.name as string,
  nameKey: r.name_key as string,
  createdAtIso: r.created_at_iso as string,
  sortKey: s(r.sort_key),
  website: s(r.domain),
  email: s(r.email),
  phone: s(r.phone),
  industry: s(r.industry),
  sizeRange: s(r.size_range),
  address: s(r.address),
  notes: s(r.notes),
  data:
    r.data && typeof r.data === 'object' && !Array.isArray(r.data)
      ? (r.data as Record<string, unknown>)
      : {},
  ownerId: n(r.owner_id),
  ownerUuid: s(r.owner_uuid),
  ownerName: s(r.owner_name),
  createdById: n(r.created_by),
  createdByUuid: s(r.created_by_uuid),
  createdByName: s(r.created_by_name),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** The shape of a company row; `sortKey` is the extra column of a property order (the key the cursor carries), `null` otherwise. */
const selectWith = (sortKey: SQL = sql`NULL::text`) => sql`
  SELECT c.id, c.uuid, c.display_id, c.name, lower(c.name) AS name_key,
         to_char(c.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         ${sortKey} AS sort_key,
         c.domain, c.email::text AS email, c.phone, c.industry, c.size_range, c.address, c.notes, c.data,
         c.owner_id, ou.uuid AS owner_uuid, ou.full_name AS owner_name,
         c.created_by, cu.uuid AS created_by_uuid, cu.full_name AS created_by_name,
         c.row_version, c.created_at, c.updated_at
  FROM companies c
  LEFT JOIN users ou ON ou.org_id = c.org_id AND ou.id = c.owner_id
  LEFT JOIN users cu ON cu.org_id = c.org_id AND cu.id = c.created_by
`;
const SELECT = selectWith();

/**
 * The record scope of a company is a condition on the PEOPLE of the company: `own` is "owned by me or created by me" (so the person
 * who hands a company to a colleague keeps sight of it), `team` adds everyone who shares a team with me, `all` adds nothing.
 */
export function companyScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  return scopeOwnerCondition({ orgId, userId: actorUserId }, scope, [
    sql`c.owner_id`,
    sql`c.created_by`,
  ]);
}

/** Contacts and deals are counted by their own columns; an archived contact is not a contact of the list (nor of the count). */
const OPEN_DEAL = sql`EXISTS (SELECT 1 FROM deals d WHERE d.org_id = c.org_id AND d.company_id = c.id AND d.status = 'open')`;

function filterConds(orgId: number, f: CompanyFilter, scope?: SQL): SQL[] {
  const conds: SQL[] = [sql`c.org_id = ${orgId}`];
  if (scope) conds.push(scope);
  if (f.q) conds.push(sql`c.name ILIKE ${`%${escapeLike(f.q)}%`}`);
  if (f.ownerId !== undefined) conds.push(sql`c.owner_id = ${f.ownerId}`);
  if (f.unassigned) conds.push(sql`c.owner_id IS NULL`);
  if (f.industry) conds.push(sql`lower(c.industry) = lower(${f.industry})`);
  if (f.hasOpenDeals) conds.push(OPEN_DEAL);
  // Conditions on company properties go through the predicates contacts and segments use (property-predicates.ts).
  for (const p of f.props ?? []) {
    const predicate = propertyPredicate(sql`c.data`, p.key, p.kind, p.operator, p.value);
    if (predicate) conds.push(predicate);
  }
  return conds;
}

const where = (conds: SQL[]) => sql.join(conds, sql` AND `);

const idList = (ids: number[]) =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/** Data access for companies. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class CompaniesRepository {
  async list(tx: Tx, orgId: number, input: CompanyListInput): Promise<CompanyRow[]> {
    const conds = filterConds(orgId, input.filter, input.scope);
    const dir = input.dir ?? (input.sort === 'created' ? 'desc' : 'asc');
    // The sort key as SQL, the type it is cast to when the cursor's key is bound back, and the id the cursor is checked against.
    let keyExpr: SQL;
    let keyType: CursorKeyType;
    const sortId = companySortId(input.sort, input.property?.key, dir);
    if (input.sort === 'property' && input.property) {
      keyExpr = input.property.sort.expr;
      keyType = input.property.sort.type;
    } else if (input.sort === 'name') {
      keyExpr = sql`lower(c.name)`;
      keyType = 'text';
    } else {
      keyExpr = sql`c.created_at`;
      keyType = 'created';
    }
    if (input.cursor) {
      const c = decodeCompanyCursor(input.cursor, sortId, keyType);
      const cast = keyType === 'text' ? 'text' : keyType === 'created' ? 'timestamptz' : keyType;
      const op = sql.raw(dir === 'asc' ? '>' : '<');
      conds.push(sql`(${keyExpr}, c.id) ${op} (${c.key}::${sql.raw(cast)}, ${c.id})`);
    }
    const way = sql.raw(dir === 'asc' ? 'ASC' : 'DESC');
    const select = input.sort === 'property' ? selectWith(sql`(${keyExpr})::text`) : SELECT;
    const res = await tx.execute(
      sql`${select} WHERE ${where(conds)} ORDER BY ${keyExpr} ${way}, c.id ${way} LIMIT ${input.limit + 1}`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  /** The three tiles of the list, inside the same filter: how many, how many with an open deal, what they won (per currency). */
  async stats(
    tx: Tx,
    orgId: number,
    filter: CompanyFilter,
    scope: SQL | undefined,
  ): Promise<{
    total: number;
    withOpenDeals: number;
    won: Array<{ currency: string; total: bigint }>;
  }> {
    const conds = where(filterConds(orgId, filter, scope));
    const counts = await tx.execute(sql`
      SELECT count(*)::int AS total, (count(*) FILTER (WHERE ${OPEN_DEAL}))::int AS with_open
      FROM companies c WHERE ${conds}
    `);
    const won = await tx.execute(sql`
      SELECT d.currency, sum(d.value_minor)::text AS total
      FROM deals d JOIN companies c ON c.org_id = d.org_id AND c.id = d.company_id
      WHERE ${conds} AND d.status = 'won'
      GROUP BY d.currency
    `);
    const r = counts.rows[0] as { total: number; with_open: number };
    return {
      total: Number(r.total),
      withOpenDeals: Number(r.with_open),
      won: (won.rows as Array<{ currency: string; total: string }>).map((w) => ({
        currency: w.currency,
        total: BigInt(w.total),
      })),
    };
  }

  /** Contacts and deals per company for a page of companies, in two queries. */
  async counts(
    tx: Tx,
    orgId: number,
    companyIds: number[],
    want: { contacts: boolean; deals: boolean },
  ): Promise<Map<number, CompanyCounts>> {
    const out = new Map<number, CompanyCounts>(
      companyIds.map((id) => [id, { contacts: 0, deals: [] }]),
    );
    if (companyIds.length === 0) return out;
    if (want.contacts) {
      const res = await tx.execute(sql`
        SELECT company_id, count(*)::int AS n FROM contacts
        WHERE org_id = ${orgId} AND company_id IN (${idList(companyIds)}) AND is_archived = false
        GROUP BY company_id
      `);
      for (const r of res.rows as Array<{ company_id: number | string; n: number }>) {
        const entry = out.get(Number(r.company_id));
        if (entry) entry.contacts = Number(r.n);
      }
    }
    if (want.deals) {
      const res = await tx.execute(sql`
        SELECT company_id, status, currency, count(*)::int AS n, sum(value_minor)::text AS total
        FROM deals
        WHERE org_id = ${orgId} AND company_id IN (${idList(companyIds)})
        GROUP BY company_id, status, currency
      `);
      for (const r of res.rows as Array<{
        company_id: number | string;
        status: string;
        currency: string;
        n: number;
        total: string;
      }>) {
        out.get(Number(r.company_id))?.deals.push({
          status: r.status,
          currency: r.currency,
          n: Number(r.n),
          total: BigInt(r.total),
        });
      }
    }
    return out;
  }

  /** The distinct industries typed so far (case-insensitive), inside the caller's scope: the options of the industry filter. */
  async industries(tx: Tx, orgId: number, scope: SQL | undefined): Promise<string[]> {
    const conds: SQL[] = [sql`c.org_id = ${orgId}`, sql`c.industry IS NOT NULL`];
    if (scope) conds.push(scope);
    const res = await tx.execute(sql`
      SELECT DISTINCT ON (lower(c.industry)) c.industry
      FROM companies c WHERE ${where(conds)}
      ORDER BY lower(c.industry), c.industry
      LIMIT 200
    `);
    return (res.rows as Array<{ industry: string }>).map((r) => r.industry);
  }

  /** Picker rows, newest first (Reference's order), by a substring of the name. */
  async selectData(
    tx: Tx,
    orgId: number,
    input: { q?: string; limit: number; scope?: SQL },
  ): Promise<Array<{ uuid: string; name: string; industry: string | null }>> {
    const res = await tx.execute(sql`
      SELECT c.uuid, c.name, c.industry FROM companies c
      WHERE ${where(filterConds(orgId, { q: input.q }, input.scope))}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${input.limit}
    `);
    return (res.rows as Array<{ uuid: string; name: string; industry: string | null }>).map(
      (r) => ({
        uuid: r.uuid,
        name: r.name,
        industry: r.industry,
      }),
    );
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<CompanyRow | undefined> {
    // FOR UPDATE cannot lock the outer-joined side, so lock the company row alone and read the joined shape after.
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM companies WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${SELECT} WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<CompanyRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      domain: string | null;
      email: string | null;
      phone: string | null;
      industry: string | null;
      sizeRange: string | null;
      address: string | null;
      notes: string | null;
      data: Record<string, unknown>;
      ownerId: number | null;
      createdBy: number | null;
      displayId: string;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO companies (org_id, name, domain, email, phone, industry, size_range, address, notes, data, owner_id, created_by, display_id)
      VALUES (${orgId}, ${v.name}, ${v.domain}, ${v.email}, ${v.phone}, ${v.industry}, ${v.sizeRange}, ${v.address}, ${v.notes},
              ${JSON.stringify(v.data)}::jsonb, ${v.ownerId}, ${v.createdBy}, ${v.displayId})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /**
   * The company a public form's submission belongs to: by website first (every common spelling of the host, so the lookup uses the
   * (org_id, lower(domain)) index), else by exact name, case-insensitive. The oldest match wins, so a duplicate nobody merged is not a
   * coin flip.
   */
  async findByDomainOrName(
    tx: Tx,
    orgId: number,
    q: { host?: string | null; name?: string | null },
    /** Only companies inside this condition (a caller's record scope): the CSV import must not touch what its owner may not edit. */
    scope?: SQL,
  ): Promise<CompanyRow | undefined> {
    const inScope = scope ? sql` AND ${scope}` : sql``;
    if (q.host) {
      const spellings = sql.join(
        companyDomainSpellings(q.host).map((h) => sql`${h}`),
        sql`, `,
      );
      const res = await tx.execute(
        sql`${SELECT} WHERE c.org_id = ${orgId} AND lower(c.domain) IN (${spellings})${inScope} ORDER BY c.id LIMIT 1`,
      );
      const r = (res.rows as Raw[])[0];
      if (r) return toRow(r);
    }
    if (q.name) {
      const res = await tx.execute(
        sql`${SELECT} WHERE c.org_id = ${orgId} AND lower(c.name) = lower(${q.name})${inScope} ORDER BY c.id LIMIT 1`,
      );
      const r = (res.rows as Raw[])[0];
      if (r) return toRow(r);
    }
    return undefined;
  }

  /**
   * Fills what a company does not have yet and never overwrites what a person typed: a value only goes in where the column is empty.
   * Locks the row for the read-modify-write. Returns the names of the properties that changed (empty when nothing was blank).
   */
  async fillBlanks(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      domain?: string | null;
      email?: string | null;
      phone?: string | null;
      industry?: string | null;
      sizeRange?: string | null;
      address?: string | null;
      notes?: string | null;
      custom?: Record<string, unknown>;
    },
  ): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT domain, email::text AS email, phone, industry, size_range, address, notes, data
      FROM companies WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE
    `);
    const cur = (res.rows as Raw[])[0];
    if (!cur) return [];
    const blank = (x: unknown): boolean => x === null || x === undefined || String(x).trim() === '';
    const sets: SQL[] = [];
    const changed: string[] = [];
    const take = (key: string, column: string, have: unknown, want: string | null | undefined) => {
      if (want && blank(have)) {
        sets.push(sql`${sql.raw(column)} = ${want}`);
        changed.push(key);
      }
    };
    take('website', 'domain', cur.domain, v.domain);
    take('email', 'email', cur.email, v.email);
    take('phone', 'phone', cur.phone, v.phone);
    take('industry', 'industry', cur.industry, v.industry);
    take('sizeRange', 'size_range', cur.size_range, v.sizeRange);
    take('address', 'address', cur.address, v.address);
    take('notes', 'notes', cur.notes, v.notes);
    const data = { ...((cur.data as Record<string, unknown> | null) ?? {}) };
    let dataChanged = false;
    for (const [key, value] of Object.entries(v.custom ?? {})) {
      if (blank(data[key]) && value !== undefined && value !== null && String(value) !== '') {
        data[key] = value;
        dataChanged = true;
        changed.push(`custom.${key}`);
      }
    }
    if (dataChanged) sets.push(sql`data = ${JSON.stringify(data)}::jsonb`);
    if (sets.length === 0) return [];
    await tx.execute(
      sql`UPDATE companies SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return changed;
  }

  /** The optimistic lock is the `row_version` in the WHERE: zero rows back means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: CompanyPatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    for (const [col, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(
        col === 'data'
          ? sql`data = ${JSON.stringify(value)}::jsonb`
          : sql`${sql.raw(col)} = ${value}`,
      );
    }
    if (sets.length === 0) return true;
    const res = await tx.execute(sql`
      UPDATE companies SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  /**
   * Contacts, deals, tasks, projects, proposals, invoices and payments that point at the company are unlinked by their foreign keys
   * (ON DELETE SET NULL), never deleted: Reference unlinked contacts and deals by hand and left everything else dangling.
   */
  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM companies WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  // --- contacts of a company ---------------------------------------------------------------------------------------------------

  /** Newest first by id (Reference's order). `scope` is the caller's contact scope: a contact they may not see is not listed. */
  async contactsOf(
    tx: Tx,
    orgId: number,
    companyId: number,
    input: { cursor?: string; limit: number; scope?: SQL },
  ): Promise<
    Array<{
      id: number;
      uuid: string;
      name: string | null;
      phone: string | null;
      email: string | null;
    }>
  > {
    const conds: SQL[] = [
      sql`contacts.org_id = ${orgId}`,
      sql`contacts.company_id = ${companyId}`,
      sql`contacts.is_archived = false`,
    ];
    if (input.scope) conds.push(input.scope);
    if (input.cursor) conds.push(sql`contacts.id < ${decodeIdCursor(input.cursor)}`);
    const res = await tx.execute(sql`
      SELECT contacts.id, contacts.uuid, contacts.name, contacts.phone, contacts.email::text AS email
      FROM contacts WHERE ${where(conds)}
      ORDER BY contacts.id DESC LIMIT ${input.limit + 1}
    `);
    return (
      res.rows as Array<{
        id: number | string;
        uuid: string;
        name: string | null;
        phone: string | null;
        email: string | null;
      }>
    ).map((r) => ({ ...r, id: Number(r.id) }));
  }

  /** The company a contact belongs to, for the unlink check. */
  async contactCompany(
    tx: Tx,
    orgId: number,
    contactUuid: string,
  ): Promise<{ id: number; companyId: number | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, company_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${contactUuid}::uuid`,
    );
    const r = res.rows[0] as
      { id: number | string; company_id: number | string | null } | undefined;
    return r ? { id: Number(r.id), companyId: n(r.company_id) } : undefined;
  }

  /** The uuid of the company a contact moves away from, for the contact's audit row. */
  async companyUuid(tx: Tx, orgId: number, companyId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM companies WHERE org_id = ${orgId} AND id = ${companyId}`,
    );
    return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
  }

  // --- references ----------------------------------------------------------------------------------------------------------------

  /** An ACTIVE member of this workspace by uuid: the only kind of user a company can be owned by. */
  async resolveActiveUser(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'active'`,
    );
    const r = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return r ? { id: Number(r.id), name: r.full_name } : undefined;
  }

  /**
   * The active members a spreadsheet cell names as an owner: by email, or by full name (case-insensitive). More than one row means the
   * name is ambiguous, and the caller refuses it instead of guessing.
   */
  async activeUsersByLogin(
    tx: Tx,
    orgId: number,
    login: string,
  ): Promise<Array<{ id: number; uuid: string; name: string }>> {
    const res = await tx.execute(sql`
      SELECT id, uuid, full_name FROM users
      WHERE org_id = ${orgId} AND status = 'active'
        AND (lower(email::text) = lower(${login}) OR lower(full_name) = lower(${login}))
      LIMIT 2
    `);
    return (res.rows as Array<{ id: number | string; uuid: string; full_name: string }>).map(
      (r) => ({ id: Number(r.id), uuid: r.uuid, name: r.full_name }),
    );
  }

  /** Any user (active or not) by uuid, for filters: an ex-member's companies are still filterable. */
  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** uuid -> name for the people and contacts an activity page mentions. */
  async userNames(
    tx: Tx,
    orgId: number,
    ids: number[],
    uuids: string[],
  ): Promise<{
    byId: Map<number, { uuid: string; name: string }>;
    byUuid: Map<string, string>;
  }> {
    const byId = new Map<number, { uuid: string; name: string }>();
    const byUuid = new Map<string, string>();
    const parts: SQL[] = [];
    if (ids.length > 0) parts.push(sql`id IN (${idList(ids)})`);
    if (uuids.length > 0)
      parts.push(
        sql`uuid IN (${sql.join(
          uuids.map((u) => sql`${u}::uuid`),
          sql`, `,
        )})`,
      );
    if (parts.length === 0) return { byId, byUuid };
    const res = await tx.execute(
      sql`SELECT id, uuid, full_name FROM users WHERE org_id = ${orgId} AND (${sql.join(parts, sql` OR `)})`,
    );
    for (const r of res.rows as Array<{ id: number | string; uuid: string; full_name: string }>) {
      byId.set(Number(r.id), { uuid: r.uuid, name: r.full_name });
      byUuid.set(r.uuid, r.full_name);
    }
    return { byId, byUuid };
  }

  async contactNames(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (uuids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT uuid, name FROM contacts
      WHERE org_id = ${orgId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})
    `);
    for (const r of res.rows as Array<{ uuid: string; name: string | null }>)
      out.set(r.uuid, r.name);
    return out;
  }

  /**
   * The workspace's company properties (the field registry, module `companies`) with their pickable options and their "show only when"
   * conditions, in registry order, inactive ones included (the write rules decide what each state allows).
   */
  async propertyDefs(tx: Tx, orgId: number): Promise<CompanyPropertyDef[]> {
    const rows = (
      await tx.execute(sql`
        SELECT id, key, label, field_type, is_required, is_hidden, is_read_only, is_active, is_system, is_masked
        FROM fields WHERE org_id = ${orgId} AND module_key = 'companies' ORDER BY position, id
      `)
    ).rows as Raw[];
    if (rows.length === 0) return [];
    const optionRows = (
      await tx.execute(sql`
        SELECT o.field_id, o.value FROM field_options o
        JOIN fields f ON f.org_id = o.org_id AND f.id = o.field_id
        WHERE o.org_id = ${orgId} AND f.module_key = 'companies' AND NOT o.is_hidden
      `)
    ).rows as Raw[];
    const depRows = (
      await tx.execute(sql`
        SELECT d.field_id, p.key AS parent_key, d.depends_on_value, po.value AS option_value
        FROM field_dependencies d
        JOIN fields f ON f.org_id = d.org_id AND f.id = d.field_id
        JOIN fields p ON p.org_id = d.org_id AND p.id = d.depends_on_field_id
        LEFT JOIN field_options po ON po.org_id = d.org_id AND po.id = d.depends_on_option_id
        WHERE d.org_id = ${orgId} AND f.module_key = 'companies'
      `)
    ).rows as Raw[];
    return rows.map((r) => ({
      key: r.key as string,
      label: r.label as string,
      fieldType: r.field_type as FieldType,
      isRequired: r.is_required === true,
      isHidden: r.is_hidden === true,
      isReadOnly: r.is_read_only === true,
      isActive: r.is_active === true,
      isSystem: r.is_system === true,
      isMasked: r.is_masked === true,
      options: optionRows
        .filter((o) => Number(o.field_id) === Number(r.id))
        .map((o) => o.value as string),
      conditions: depRows
        .filter((d) => Number(d.field_id) === Number(r.id))
        .map((d) => ({
          parentKey: d.parent_key as string,
          wanted: s(d.depends_on_value) ?? s(d.option_value),
        })),
    }));
  }

  /** True if `userId` is on a team `actorUserId` is also on: the 'team' record-scope check for one company. */
  async isInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    userId: number,
    /** `team_and_below`: a person in a team under one of the actor's teams counts too. */
    below = false,
  ): Promise<boolean> {
    return isTeamPeer(tx, orgId, actorUserId, userId, below);
  }
}
