import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { ERROR_CODES, type ContactSort, type RecordScope } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor } from '../../../common/pagination/cursor';
import { NO_STAGE_FLAGS, type StageFlags } from './contact-stage';
import type { StatusScopeOption } from './contact-status-stage';
import type { PropertyDef } from './contact-property-values';
import type { RequiredRule } from './required-properties';
import {
  contactConditions,
  contactScopeCondition,
  whereOf,
  type ResolvedContactFilter,
} from './contact-conditions';

const {
  companies,
  contacts,
  fieldDependencies,
  fieldOptions,
  fields,
  statusOptions,
  teamMembers,
  users,
} = schema;

export interface ContactRow {
  /** Only on a list ordered by a column: the lower-cased value it was ordered by (null = blank). */
  sortKey?: string | null;
  id: number;
  /** created_at at microsecond precision (keyset cursor). */
  createdAtIso?: string;
  uuid: string;
  displayId: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyId: number | null;
  companyUuid: string | null;
  ownerId: number | null;
  ownerUuid: string | null;
  lifecycleState: 'draft' | 'active' | 'archived' | 'deleted';
  lifecycleStage: string;
  lifecycleStageDate: Date | null;
  previousLifecycleStage: string | null;
  previousLifecycleStageDate: Date | null;
  status: string | null;
  lostReason: string | null;
  otherLostReason: string | null;
  wonAt: Date | null;
  lostAt: Date | null;
  leadScore: number | null;
  leadScoreSource: string | null;
  leadScoreReasons: string[] | null;
  leadScoredAt: Date | null;
  leadScoreModel: string | null;
  whatsappSubscriptionStatus: string | null;
  smsSubscriptionStatus: string | null;
  emailSubscriptionStatus: string | null;
  emailConfirmed: boolean;
  faxNumber: string | null;
  /** ISO day (`YYYY-MM-DD`) or null. Built-in personal property (BL-217). */
  dateOfBirth: string | null;
  /** Flagged as a minor (BL-190), read from the privacy flags in the same statement. */
  isMinor: boolean;
  lastActivityAt: Date | null;
  /** BL-290: null = contacted; set = uncontacted since then. */
  uncontactedSince: Date | null;
  data: Record<string, unknown>;
  /** BL-193: the contact's own IANA time zone and who set it (staff | import | api); both null when none is stored. */
  timezone: string | null;
  timezoneSource: string | null;
  source: string | null;
  isUnsubscribed: boolean;
  isArchived: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The text a sort column orders by: a real column, or a value kept in the contact's custom fields. */
function sortExpression(sort: Exclude<ContactSort, 'createdAt'>): SQL {
  switch (sort) {
    case 'name':
      return sql`${contacts.name}`;
    case 'phone':
      return sql`${contacts.phone}`;
    case 'email':
      return sql`${contacts.email}`;
    case 'stage':
      return sql`${contacts.lifecycleStage}`;
    case 'status':
      return sql`${contacts.status}`;
    case 'language':
    case 'memo':
      return sql`${contacts.data} ->> ${sort}`;
    default:
      return sql`${contacts.data} ->> ${sort.slice('attr:'.length)}`;
  }
}

/** Cursor of a sorted page: the last row's sort value (null = blank) and id. */
export function encodeSortCursor(key: string | null, id: number): string {
  return Buffer.from(JSON.stringify({ k: key, i: id }), 'utf8').toString('base64url');
}

function decodeSortCursor(raw: string): { key: string | null; id: number } {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      k: unknown;
      i: unknown;
    };
    if ((v.k !== null && typeof v.k !== 'string') || !Number.isSafeInteger(v.i))
      throw new Error('bad');
    return { key: v.k as string | null, id: v.i as number };
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
}

export interface ListContactsFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  /** Column to order by; `createdAt` keeps the (created_at, id) keyset. */
  sort?: ContactSort;
  filter: ResolvedContactFilter;
  /** Row visibility from the caller's RBAC grant. */
  scope: RecordScope;
  /** The caller — needed to resolve 'own' and 'team' scopes. */
  actorUserId: number | null;
}

/** A group or tag chip on a contact row. */
export interface ContactChip {
  contactId: number;
  uuid: string;
  name: string;
  color: string | null;
}

/**
 * Data access for contacts.
 *
 * Every method takes a `tx` that already carries the tenant GUCs, so none of
 * these queries writes `org_id = ?` for isolation — RLS does that. The
 * explicit `orgId` predicates that do appear are there for the *planner*: they
 * let Postgres use the (org_id, ...) composite indexes instead of relying on
 * the policy expression alone.
 */
@Injectable()
export class ContactsRepository {
  private selection() {
    return {
      id: contacts.id,
      uuid: contacts.uuid,
      // Full-precision created_at for the keyset cursor (a JS Date drops the microseconds).
      createdAtIso: sql<string>`to_char(${contacts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      displayId: contacts.displayId,
      name: contacts.name,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      companyId: contacts.companyId,
      companyUuid: companies.uuid,
      ownerId: contacts.ownerId,
      ownerUuid: users.uuid,
      lifecycleState: contacts.lifecycleState,
      lifecycleStage: contacts.lifecycleStage,
      lifecycleStageDate: contacts.lifecycleStageDate,
      previousLifecycleStage: contacts.previousLifecycleStage,
      previousLifecycleStageDate: contacts.previousLifecycleStageDate,
      status: contacts.status,
      lostReason: contacts.lostReason,
      otherLostReason: contacts.otherLostReason,
      wonAt: contacts.wonAt,
      lostAt: contacts.lostAt,
      leadScore: contacts.leadScore,
      leadScoreSource: contacts.leadScoreSource,
      leadScoreReasons: contacts.leadScoreReasons,
      leadScoredAt: contacts.leadScoredAt,
      leadScoreModel: contacts.leadScoreModel,
      whatsappSubscriptionStatus: contacts.whatsappSubscriptionStatus,
      smsSubscriptionStatus: contacts.smsSubscriptionStatus,
      emailSubscriptionStatus: contacts.emailSubscriptionStatus,
      emailConfirmed: contacts.emailConfirmed,
      faxNumber: contacts.faxNumber,
      dateOfBirth: contacts.dateOfBirth,
      isMinor: sql<boolean>`EXISTS (SELECT 1 FROM contact_privacy_flags pf WHERE pf.org_id = ${contacts.orgId} AND pf.contact_id = ${contacts.id} AND pf.is_minor)`,
      lastActivityAt: contacts.lastActivityAt,
      uncontactedSince: contacts.uncontactedSince,
      data: contacts.data,
      timezone: contacts.timezone,
      timezoneSource: contacts.timezoneSource,
      source: contacts.source,
      isUnsubscribed: contacts.isUnsubscribed,
      isArchived: contacts.isArchived,
      rowVersion: contacts.rowVersion,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    };
  }

  /** See contactScopeCondition; kept here so existing callers read the same. */
  private scopeCondition(
    orgId: number,
    scope: RecordScope,
    actorUserId: number | null,
  ): SQL | undefined {
    return contactScopeCondition(orgId, scope, actorUserId);
  }

  /** Select + joins, without a WHERE — each caller adds its own. */
  private baseQuery(tx: Tx, extra: Record<string, SQL> = {}) {
    return tx
      .select({ ...this.selection(), ...extra })
      .from(contacts)
      .leftJoin(users, and(eq(users.orgId, contacts.orgId), eq(users.id, contacts.ownerId)))
      .leftJoin(
        companies,
        and(eq(companies.orgId, contacts.orgId), eq(companies.id, contacts.companyId)),
      );
  }

  /** Returns `limit + 1` rows; the caller turns the extra one into `hasMore`. */
  async list(tx: Tx, orgId: number, filter: ListContactsFilter): Promise<ContactRow[]> {
    const conditions = contactConditions(
      orgId,
      filter.filter,
      this.scopeCondition(orgId, filter.scope, filter.actorUserId),
    );

    if (filter.sort && filter.sort !== 'createdAt') {
      return this.listSorted(tx, conditions, filter, filter.sort);
    }

    // Keyset boundary over the (created_at, id) tuple. Row-value comparison so
    // the planner can use the composite index directly.
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      // Compare against the microsecond-precision instant, not the millisecond Date.
      const bound = sql`${cursor.createdAtIso ?? cursor.createdAt.toISOString()}::timestamptz`;
      conditions.push(
        filter.order === 'desc'
          ? or(
              sql`${contacts.createdAt} < ${bound}`,
              and(sql`${contacts.createdAt} = ${bound}`, lt(contacts.id, cursor.id)),
            )!
          : or(
              sql`${contacts.createdAt} > ${bound}`,
              and(sql`${contacts.createdAt} = ${bound}`, gt(contacts.id, cursor.id)),
            )!,
      );
    }

    const orderBy =
      filter.order === 'desc'
        ? [desc(contacts.createdAt), desc(contacts.id)]
        : [asc(contacts.createdAt), asc(contacts.id)];

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(filter.limit + 1);

    return rows as ContactRow[];
  }

  /**
   * A list ordered by one column. Keyset like the default list, over (blank, value, id): the value is the lower-cased
   * column (an empty one counts as blank and sorts last in both directions), the id breaks ties.
   */
  private async listSorted(
    tx: Tx,
    conditions: SQL[],
    filter: ListContactsFilter,
    sort: Exclude<ContactSort, 'createdAt'>,
  ): Promise<ContactRow[]> {
    const key = sql`nullif(lower(btrim(${sortExpression(sort)})), '')`;
    const dir = filter.order === 'desc' ? sql`DESC` : sql`ASC`;
    if (filter.cursor) {
      const c = decodeSortCursor(filter.cursor);
      const idAfter =
        filter.order === 'desc' ? sql`${contacts.id} < ${c.id}` : sql`${contacts.id} > ${c.id}`;
      const keyAfter = filter.order === 'desc' ? sql`${key} < ${c.key}` : sql`${key} > ${c.key}`;
      conditions.push(
        c.key === null
          ? sql`(${key} IS NULL AND ${idAfter})`
          : sql`(${key} IS NULL OR ${keyAfter} OR (${key} = ${c.key} AND ${idAfter}))`,
      );
    }
    const rows = await this.baseQuery(tx, { sortKey: sql<string | null>`${key}` })
      .where(and(...conditions))
      .orderBy(sql`(${key} IS NULL) ASC`, sql`${key} ${dir}`, sql`${contacts.id} ${dir}`)
      .limit(filter.limit + 1);
    return rows as ContactRow[];
  }

  /** How many contacts match a filter ("Showing 1-50 of N"). */
  async count(
    tx: Tx,
    orgId: number,
    filter: ResolvedContactFilter,
    scope: RecordScope,
    actorUserId: number | null,
  ): Promise<number> {
    const where = whereOf(
      contactConditions(orgId, filter, this.scopeCondition(orgId, scope, actorUserId)),
    );
    const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM ${contacts} WHERE ${where}`);
    return Number((rows.rows[0] as { n: number }).n);
  }

  /**
   * The tiles and sidebar badges, in one pass: workspace-wide (a filter would defeat the
   * point), but still inside the caller's record scope and, like the list, without archived rows.
   */
  async stats(
    tx: Tx,
    orgId: number,
    scope: RecordScope,
    actorUserId: number | null,
  ): Promise<{
    total: number;
    subscribed: number;
    unsubscribed: number;
    noGroup: number;
    imported: number;
    uncontacted: number;
    groups: number;
  }> {
    const where = whereOf(
      contactConditions(
        orgId,
        { includeArchived: false, tagMode: 'any' },
        this.scopeCondition(orgId, scope, actorUserId),
      ),
    );
    const rows = await tx.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE NOT ${contacts.isUnsubscribed})::int AS subscribed,
             count(*) FILTER (WHERE ${contacts.isUnsubscribed})::int AS unsubscribed,
             count(*) FILTER (WHERE ${contacts.importJobId} IS NOT NULL)::int AS imported,
             count(*) FILTER (WHERE ${contacts.uncontactedSince} IS NOT NULL)::int AS uncontacted,
             count(*) FILTER (WHERE NOT EXISTS (
               SELECT 1 FROM contact_group_members m
               WHERE m.org_id = ${orgId} AND m.contact_id = ${contacts.id}
             ))::int AS no_group
      FROM ${contacts} WHERE ${where}
    `);
    const r = rows.rows[0] as {
      total: number;
      subscribed: number;
      unsubscribed: number;
      imported: number;
      uncontacted: number;
      no_group: number;
    };
    const g = await tx.execute(
      sql`SELECT count(*)::int AS n FROM contact_groups WHERE org_id = ${orgId}`,
    );
    return {
      total: Number(r.total),
      subscribed: Number(r.subscribed),
      unsubscribed: Number(r.unsubscribed),
      noGroup: Number(r.no_group),
      imported: Number(r.imported),
      uncontacted: Number(r.uncontacted),
      groups: Number((g.rows[0] as { n: number }).n),
    };
  }

  /** Group chips for a page of contacts, one query. */
  async groupChips(tx: Tx, orgId: number, contactIds: number[]): Promise<ContactChip[]> {
    if (contactIds.length === 0) return [];
    const rows = await tx.execute(sql`
      SELECT m.contact_id AS "contactId", g.uuid, g.name, g.color
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      WHERE m.org_id = ${orgId}
        AND m.contact_id IN (${sql.join(
          contactIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      ORDER BY lower(g.name)
    `);
    return rows.rows.map((r) => ({
      ...(r as unknown as ContactChip),
      contactId: Number((r as { contactId: number }).contactId),
    }));
  }

  /** Tag chips for a page of contacts, one query. */
  async tagChips(tx: Tx, orgId: number, contactIds: number[]): Promise<ContactChip[]> {
    if (contactIds.length === 0) return [];
    const rows = await tx.execute(sql`
      SELECT ct.contact_id AS "contactId", t.uuid, t.name::text AS name, t.color
      FROM contact_tags ct
      JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
      WHERE ct.org_id = ${orgId}
        AND ct.contact_id IN (${sql.join(
          contactIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      ORDER BY lower(t.name::text)
    `);
    return rows.rows.map((r) => ({
      ...(r as unknown as ContactChip),
      contactId: Number((r as { contactId: number }).contactId),
    }));
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contacts.orgId, orgId), eq(contacts.uuid, uuid)),
    );
    return rows[0] as ContactRow | undefined;
  }

  /**
   * Locks the contact row for the rest of the transaction. A delete takes it before erasing the history, so a new conversation
   * cannot link to the contact in between and keep its messages after the contact is gone.
   */
  async lockById(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`SELECT 1 FROM contacts WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`);
  }

  /** uuid -> internal id for every uuid that exists in the workspace, in one query. Unknown uuids are simply absent. */
  async idsByUuid(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    if (uuids.length === 0) return new Map();
    const rows = await tx
      .select({ uuid: contacts.uuid, id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.uuid, uuids)));
    return new Map(rows.map((r) => [r.uuid, r.id]));
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contacts.orgId, orgId), eq(contacts.id, id)),
    );
    return rows[0] as ContactRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      companyId?: number | null;
      ownerId?: number | null;
      lifecycleStage?: string;
      status?: string | null;
      lostReason?: string | null;
      otherLostReason?: string | null;
      wonAt?: Date | null;
      lostAt?: Date | null;
      leadScore?: number | null;
      whatsappSubscriptionStatus?: string | null;
      smsSubscriptionStatus?: string | null;
      emailSubscriptionStatus?: string | null;
      emailConfirmed?: boolean;
      faxNumber?: string | null;
      dateOfBirth?: string | null;
      source?: string | null;
      timezone?: string | null;
      timezoneSource?: string | null;
      isUnsubscribed?: boolean;
      unsubscribedAt?: Date | null;
      data: Record<string, unknown>;
      displayId: string;
      createdBy: number | null;
      submittedByAgentId?: number | null;
      /** A contact keyed by a channel's own id (no phone: Telegram, Facebook, Instagram, the website widget). */
      channel?: string | null;
      channelUid?: string | null;
      message?: string | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contacts)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        name: values.name ?? null,
        firstName: values.firstName ?? null,
        lastName: values.lastName ?? null,
        email: values.email ?? null,
        phone: values.phone ?? null,
        companyId: values.companyId ?? null,
        ownerId: values.ownerId ?? null,
        lifecycleStage: values.lifecycleStage ?? 'new',
        lifecycleStageDate: sql`now()`,
        status: values.status ?? null,
        lostReason: values.lostReason ?? null,
        otherLostReason: values.otherLostReason ?? null,
        wonAt: values.wonAt ?? null,
        lostAt: values.lostAt ?? null,
        leadScore: values.leadScore ?? null,
        // A score given with the contact was typed by a person (or imported): the AI scorer never overwrites it.
        leadScoreSource: values.leadScore == null ? null : 'manual',
        whatsappSubscriptionStatus: values.whatsappSubscriptionStatus ?? null,
        smsSubscriptionStatus: values.smsSubscriptionStatus ?? null,
        emailSubscriptionStatus: values.emailSubscriptionStatus ?? null,
        emailConfirmed: values.emailConfirmed ?? false,
        faxNumber: values.faxNumber ?? null,
        dateOfBirth: values.dateOfBirth ?? null,
        source: values.source ?? null,
        timezone: values.timezone ?? null,
        timezoneSource: values.timezone ? (values.timezoneSource ?? 'staff') : null,
        isUnsubscribed: values.isUnsubscribed ?? false,
        unsubscribedAt: values.unsubscribedAt ?? null,
        data: values.data,
        displayId: values.displayId,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
        submittedByAgentId: values.submittedByAgentId ?? null,
        channel: values.channel ?? null,
        channelUid: values.channelUid ?? null,
        message: values.message ?? null,
      })
      .returning({ id: contacts.id, uuid: contacts.uuid });

    return row!;
  }

  /**
   * Optimistic update.
   *
   * The `row_version` predicate is the lock. Zero rows affected means somebody
   * else committed first — the caller turns that into 409 rather than silently
   * overwriting the other person's edit.
   *
   * row_version itself is not set here: the touch_row() trigger increments it.
   */
  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(contacts)
      .set(values)
      .where(
        and(
          eq(contacts.orgId, orgId),
          eq(contacts.id, id),
          eq(contacts.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contacts.id });

    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, id)))
      .returning({ id: contacts.id });
    return result.length > 0;
  }

  /** Resolves an external uuid to an internal id for a related table. */
  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.uuid, uuid)));
    return rows[0]?.id;
  }

  /** The internal id of an ACTIVE member of this org (a bulk reassignment must not hand records to a disabled login). */
  async resolveActiveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.uuid, uuid), eq(users.status, 'active')));
    return rows[0]?.id;
  }

  /** Batch reverse lookup — id -> uuid, for resolving a page of audit actor ids in one query. */
  async resolveUserUuids(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: users.id, uuid: users.uuid })
      .from(users)
      .where(and(eq(users.orgId, orgId), inArray(users.id, ids)));
    return new Map(rows.map((r) => [r.id, r.uuid]));
  }

  async resolveCompanyId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const rows = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.orgId, orgId), eq(companies.uuid, uuid)));
    return rows[0]?.id;
  }

  /**
   * Identity-first dedup lookup.
   *
   * contact_identities is unique on (org_id, kind, value), so this either hits
   * exactly one contact or none — no ambiguity, no "pick the first match".
   */
  /** The workspace's default option of a contact group (the stage a new contact starts in), if one is marked. */
  async defaultOptionValue(
    tx: Tx,
    orgId: number,
    optionGroup: string,
  ): Promise<string | undefined> {
    const rows = await tx
      .select({ value: statusOptions.value })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          eq(statusOptions.optionGroup, optionGroup),
          eq(statusOptions.isDefault, true),
          eq(statusOptions.isActive, true),
        ),
      )
      .limit(1);
    return rows[0]?.value;
  }

  /**
   * What the admin flagged on a lifecycle stage. A value with no option row (a stage that was deleted, a free-text
   * stage from an import) carries no flags.
   */
  async stageFlags(tx: Tx, orgId: number, value: string): Promise<StageFlags> {
    const rows = await tx
      .select({ isWon: statusOptions.isWon, isLost: statusOptions.isLost })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          eq(statusOptions.optionGroup, 'lifecycle_stage'),
          eq(statusOptions.value, value),
        ),
      )
      .limit(1);
    return rows[0] ?? NO_STAGE_FLAGS;
  }

  /**
   * Every status option of the contact status groups with the stage it is scoped to, plus the label of every lifecycle
   * stage (for error messages). One small read per write that touches the stage or the status.
   */
  async statusContext(
    tx: Tx,
    orgId: number,
  ): Promise<{ scope: StatusScopeOption[]; stageLabels: Map<string, string> }> {
    const stage = alias(statusOptions, 'scope_stage');
    const rows = await tx
      .select({
        value: statusOptions.value,
        label: statusOptions.label,
        isDefault: statusOptions.isDefault,
        isActive: statusOptions.isActive,
        stageValue: stage.value,
        stageLabel: stage.label,
      })
      .from(statusOptions)
      .leftJoin(
        stage,
        and(eq(stage.orgId, statusOptions.orgId), eq(stage.id, statusOptions.stageOptionId)),
      )
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          inArray(statusOptions.optionGroup, ['status', 'contact_status']),
        ),
      )
      .orderBy(asc(statusOptions.position), asc(statusOptions.id));
    const stages = await tx
      .select({ value: statusOptions.value, label: statusOptions.label })
      .from(statusOptions)
      .where(
        and(
          eq(statusOptions.orgId, orgId),
          eq(statusOptions.moduleKey, 'contacts'),
          eq(statusOptions.optionGroup, 'lifecycle_stage'),
        ),
      );
    return {
      scope: rows,
      stageLabels: new Map(stages.map((s) => [s.value, s.label])),
    };
  }

  /**
   * The contact properties the registry marks required that a write can be held to: active, visible, user-settable
   * (not system fields, which have rules of their own, and not computed ones), with the conditions that make each
   * apply. Checkboxes are left out: an unticked box is an answer, as on the contact form.
   */
  async requiredRules(tx: Tx, orgId: number): Promise<RequiredRule[]> {
    const required = await tx
      .select({ id: fields.id, key: fields.key, label: fields.label })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, 'contacts'),
          eq(fields.isRequired, true),
          eq(fields.isActive, true),
          eq(fields.isSystem, false),
          eq(fields.isHidden, false),
          eq(fields.isReadOnly, false),
          sql`${fields.fieldType} NOT IN ('formula', 'checkbox', 'boolean')`,
        ),
      )
      .orderBy(asc(fields.position), asc(fields.id));
    if (required.length === 0) return [];

    const parent = alias(fields, 'dep_parent');
    const deps = await tx
      .select({
        fieldId: fieldDependencies.fieldId,
        parentKey: parent.key,
        value: fieldDependencies.dependsOnValue,
        optionValue: fieldOptions.value,
      })
      .from(fieldDependencies)
      .innerJoin(
        parent,
        and(
          eq(parent.orgId, fieldDependencies.orgId),
          eq(parent.id, fieldDependencies.dependsOnFieldId),
        ),
      )
      .leftJoin(
        fieldOptions,
        and(
          eq(fieldOptions.orgId, fieldDependencies.orgId),
          eq(fieldOptions.id, fieldDependencies.dependsOnOptionId),
        ),
      )
      .where(
        and(
          eq(fieldDependencies.orgId, orgId),
          inArray(
            fieldDependencies.fieldId,
            required.map((r) => r.id),
          ),
        ),
      );

    return required.map((r) => ({
      key: r.key,
      label: r.label,
      conditions: deps
        .filter((d) => d.fieldId === r.id)
        .map((d) => ({ parentKey: d.parentKey, wanted: d.value ?? d.optionValue ?? null })),
    }));
  }

  /** Which of `keys` are contact properties the workspace defined (any state): the rest are free-form keys. */
  async definedPropertyKeys(tx: Tx, orgId: number, keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await tx
      .select({ key: fields.key })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, 'contacts'),
          inArray(fields.key, [...keys]),
        ),
      );
    return new Set(rows.map((r) => r.key));
  }

  /**
   * The custom properties among `keys` that a bulk edit may set: active, not a system property, not hidden, not read-only,
   * not a formula. Keys missing from the answer are not editable.
   */
  async editableProperties(
    tx: Tx,
    orgId: number,
    keys: readonly string[],
  ): Promise<Map<string, PropertyDef>> {
    if (keys.length === 0) return new Map();
    const rows = await tx
      .select({ id: fields.id, key: fields.key, label: fields.label, fieldType: fields.fieldType })
      .from(fields)
      .where(
        and(
          eq(fields.orgId, orgId),
          eq(fields.moduleKey, 'contacts'),
          inArray(fields.key, [...keys]),
          eq(fields.isActive, true),
          eq(fields.isSystem, false),
          eq(fields.isHidden, false),
          eq(fields.isReadOnly, false),
          sql`${fields.fieldType} <> 'formula'`,
        ),
      );
    if (rows.length === 0) return new Map();
    const options = await tx
      .select({ fieldId: fieldOptions.fieldId, value: fieldOptions.value })
      .from(fieldOptions)
      .where(
        and(
          eq(fieldOptions.orgId, orgId),
          eq(fieldOptions.isHidden, false),
          inArray(
            fieldOptions.fieldId,
            rows.map((r) => r.id),
          ),
        ),
      );
    return new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          label: r.label,
          fieldType: r.fieldType,
          options: options.filter((o) => o.fieldId === r.id).map((o) => o.value),
        },
      ]),
    );
  }

  async findByIdentity(
    tx: Tx,
    orgId: number,
    kind: 'email' | 'phone',
    value: string,
  ): Promise<number | undefined> {
    const result = await tx.execute(sql`
      SELECT contact_id FROM contact_identities
      WHERE org_id = ${orgId} AND kind = ${kind} AND value = ${value}
      LIMIT 1
    `);
    return (result.rows[0] as { contact_id: number } | undefined)?.contact_id;
  }

  /**
   * The contact behind each (kind, value) identity, in one query per 2000 identities. Only an identity whose contact still exists counts,
   * the same test the single lookup plus `uuidOf` makes. Keyed `kind|value`; an identity nobody holds is absent.
   */
  async contactsByIdentities(
    tx: Tx,
    orgId: number,
    wanted: ReadonlyArray<{ kind: 'email' | 'phone'; value: string }>,
  ): Promise<Map<string, { id: number; uuid: string }>> {
    const out = new Map<string, { id: number; uuid: string }>();
    const unique = [...new Map(wanted.map((w) => [`${w.kind}|${w.value}`, w])).values()];
    for (let i = 0; i < unique.length; i += 2000) {
      const chunk = unique.slice(i, i + 2000);
      const res = await tx.execute(sql`
        SELECT ci.kind, ci.value, c.id, c.uuid
        FROM contact_identities ci
        JOIN contacts c ON c.org_id = ci.org_id AND c.id = ci.contact_id
        WHERE ci.org_id = ${orgId}
          AND (ci.kind, ci.value) IN (${sql.join(
            chunk.map((w) => sql`(${w.kind}, ${w.value})`),
            sql`, `,
          )})
        ORDER BY ci.id`);
      for (const r of res.rows as Array<{ kind: string; value: string; id: number | string; uuid: string }>) {
        const key = `${r.kind}|${r.value}`;
        if (!out.has(key)) out.set(key, { id: Number(r.id), uuid: r.uuid });
      }
    }
    return out;
  }

  async addIdentity(
    tx: Tx,
    orgId: number,
    contactId: number,
    kind: 'email' | 'phone',
    value: string,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary)
      VALUES (${orgId}, ${contactId}, ${kind}, ${value}, true)
      ON CONFLICT (org_id, kind, value) DO NOTHING
    `);
  }

  /**
   * Drops the identity key a contact no longer holds (its old phone or email after an edit or a clear). Without this
   * the key keeps pointing at the contact, so a later create with that number or address is answered with this
   * contact instead of making a new one, and an import would update the wrong person.
   */
  async removeIdentity(
    tx: Tx,
    orgId: number,
    contactId: number,
    kind: 'email' | 'phone',
    value: string,
  ): Promise<void> {
    await tx.execute(sql`
      DELETE FROM contact_identities
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND kind = ${kind} AND value = ${value}
    `);
  }

  /** Lightweight rows for pickers/typeaheads — never the full record. */
  async selectData(
    tx: Tx,
    orgId: number,
    filter: { q?: string; limit: number; scope: RecordScope; actorUserId: number | null },
  ): Promise<
    Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
  > {
    // The same word-by-word search as the list, so a picker finds what the list finds.
    const conditions = contactConditions(
      orgId,
      { q: filter.q, includeArchived: false, tagMode: 'any' },
      this.scopeCondition(orgId, filter.scope, filter.actorUserId),
    );

    const rows = await tx
      .select({
        id: contacts.uuid,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
      })
      .from(contacts)
      .where(and(...conditions))
      .orderBy(asc(contacts.name))
      .limit(filter.limit);
    return rows;
  }

  /** Bulk-edit write — no optimistic-lock check (the contract has no rowVersion field for this path). */
  async updateFieldsById(
    tx: Tx,
    orgId: number,
    id: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(contacts)
      .set(values)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, id)))
      .returning({ id: contacts.id });
    return result.length > 0;
  }

  /** Active staff users this org can assign a contact to. */
  async listAssignable(
    tx: Tx,
    orgId: number,
    scope: RecordScope,
    actorUserId: number | null,
  ): Promise<Array<{ id: string; fullName: string; email: string; canAssign: boolean }>> {
    // Mirrors assertOwnerWithinScope: all = anyone; team = me or someone who shares a team with me; own = me.
    const canAssign =
      scope === 'all'
        ? sql<boolean>`true`
        : !actorUserId
          ? sql<boolean>`false`
          : scope === 'own'
            ? sql<boolean>`${users.id} = ${actorUserId}`
            : sql<boolean>`(${users.id} = ${actorUserId} OR EXISTS (
                SELECT 1 FROM ${teamMembers} tm1
                JOIN ${teamMembers} tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
                WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${users.id}
              ))`;
    const rows = await tx
      .select({ id: users.uuid, fullName: users.fullName, email: users.email, canAssign })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.status, 'active')))
      .orderBy(asc(users.fullName));
    return rows as Array<{ id: string; fullName: string; email: string; canAssign: boolean }>;
  }

  /** Called by contact-notes/activities/meetings on write — backs the list "Last Activity" column. */
  async bumpLastActivity(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx
      .update(contacts)
      .set({ lastActivityAt: sql`now()` })
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, id)));
  }

  /** Resolves a contact's external uuid to its internal id — for sub-resource modules (notes, files, ...). */
  async resolveContactId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const rows = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.uuid, uuid)));
    return rows[0]?.id;
  }

  /**
   * Same as resolveContactId, plus the owner — sub-resource modules need
   * this to enforce the caller's own/team record scope against the parent
   * contact (see contact-scope.ts), not just to resolve the FK.
   */
  async resolveContactRef(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; ownerId: number | null } | undefined> {
    const rows = await tx
      .select({ id: contacts.id, ownerId: contacts.ownerId })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.uuid, uuid)));
    return rows[0];
  }

  /** True if `ownerId` is on any team `actorUserId` also belongs to — the 'team' record-scope check. */
  async isOwnerInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    ownerId: number,
  ): Promise<boolean> {
    const rows = await tx.execute(sql`
      SELECT 1
      FROM ${teamMembers} tm1
      JOIN ${teamMembers} tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${ownerId}
      LIMIT 1
    `);
    return rows.rows.length > 0;
  }
}
