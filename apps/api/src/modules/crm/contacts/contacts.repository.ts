import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import type { RecordScope } from '@crm/contracts';
import { decodeCursor } from '../../../common/pagination/cursor';

const { companies, contacts, teamMembers, users } = schema;

export interface ContactRow {
  id: number;
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
  leadScore: number | null;
  whatsappSubscriptionStatus: string | null;
  smsSubscriptionStatus: string | null;
  emailSubscriptionStatus: string | null;
  emailConfirmed: boolean;
  faxNumber: string | null;
  lastActivityAt: Date | null;
  data: Record<string, unknown>;
  isArchived: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListContactsFilter {
  limit: number;
  cursor?: string;
  order: 'asc' | 'desc';
  q?: string;
  ownerId?: number;
  lifecycleStage?: string;
  includeArchived: boolean;
  /** Row visibility from the caller's RBAC grant. */
  scope: RecordScope;
  /** The caller — needed to resolve 'own' and 'team' scopes. */
  actorUserId: number | null;
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
      leadScore: contacts.leadScore,
      whatsappSubscriptionStatus: contacts.whatsappSubscriptionStatus,
      smsSubscriptionStatus: contacts.smsSubscriptionStatus,
      emailSubscriptionStatus: contacts.emailSubscriptionStatus,
      emailConfirmed: contacts.emailConfirmed,
      faxNumber: contacts.faxNumber,
      lastActivityAt: contacts.lastActivityAt,
      data: contacts.data,
      isArchived: contacts.isArchived,
      rowVersion: contacts.rowVersion,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    };
  }

  /** Select + joins, without a WHERE — each caller adds its own. */
  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contacts)
      .leftJoin(users, and(eq(users.orgId, contacts.orgId), eq(users.id, contacts.ownerId)))
      .leftJoin(
        companies,
        and(eq(companies.orgId, contacts.orgId), eq(companies.id, contacts.companyId)),
      );
  }

  /** Returns `limit + 1` rows; the caller turns the extra one into `hasMore`. */
  async list(tx: Tx, orgId: number, filter: ListContactsFilter): Promise<ContactRow[]> {
    const conditions: SQL[] = [eq(contacts.orgId, orgId)];

    if (!filter.includeArchived) {
      conditions.push(eq(contacts.isArchived, false));
    }
    if (filter.ownerId !== undefined) {
      conditions.push(eq(contacts.ownerId, filter.ownerId));
    }
    if (filter.lifecycleStage) {
      conditions.push(eq(contacts.lifecycleStage, filter.lifecycleStage));
    }

    if (filter.q) {
      const pattern = `%${filter.q}%`;
      const match = or(
        ilike(contacts.name, pattern),
        ilike(sql`${contacts.email}::text`, pattern),
        ilike(contacts.phone, pattern),
      );
      if (match) conditions.push(match);
    }

    // Record scope. 'all' adds nothing; 'own' and 'team' narrow it. A caller
    // with no user id (should not happen on this route) collapses to a
    // predicate that matches nothing rather than to "everything".
    if (filter.scope === 'own') {
      conditions.push(filter.actorUserId ? eq(contacts.ownerId, filter.actorUserId) : sql`false`);
    } else if (filter.scope === 'team' && filter.actorUserId) {
      conditions.push(sql`
        ${contacts.ownerId} IN (
          SELECT tm2.user_id
          FROM ${teamMembers} tm1
          JOIN ${teamMembers} tm2
            ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
          WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${filter.actorUserId}
        )
      `);
    } else if (filter.scope === 'team') {
      conditions.push(sql`false`);
    }

    // Keyset boundary over the (created_at, id) tuple. Row-value comparison so
    // the planner can use the composite index directly.
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        filter.order === 'desc'
          ? or(
              lt(contacts.createdAt, cursor.createdAt),
              and(eq(contacts.createdAt, cursor.createdAt), lt(contacts.id, cursor.id)),
            )!
          : or(
              gt(contacts.createdAt, cursor.createdAt),
              and(eq(contacts.createdAt, cursor.createdAt), gt(contacts.id, cursor.id)),
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

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contacts.orgId, orgId), eq(contacts.uuid, uuid)),
    );
    return rows[0] as ContactRow | undefined;
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
      leadScore?: number | null;
      whatsappSubscriptionStatus?: string | null;
      smsSubscriptionStatus?: string | null;
      emailSubscriptionStatus?: string | null;
      emailConfirmed?: boolean;
      faxNumber?: string | null;
      data: Record<string, unknown>;
      displayId: string;
      createdBy: number | null;
      submittedByAgentId?: number | null;
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
        leadScore: values.leadScore ?? null,
        whatsappSubscriptionStatus: values.whatsappSubscriptionStatus ?? null,
        smsSubscriptionStatus: values.smsSubscriptionStatus ?? null,
        emailSubscriptionStatus: values.emailSubscriptionStatus ?? null,
        emailConfirmed: values.emailConfirmed ?? false,
        faxNumber: values.faxNumber ?? null,
        data: values.data,
        displayId: values.displayId,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
        submittedByAgentId: values.submittedByAgentId ?? null,
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

  /** Lightweight rows for pickers/typeaheads — never the full record. */
  async selectData(
    tx: Tx,
    orgId: number,
    filter: { q?: string; limit: number },
  ): Promise<
    Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
  > {
    const conditions: SQL[] = [eq(contacts.orgId, orgId), eq(contacts.isArchived, false)];
    if (filter.q) {
      const pattern = `%${filter.q}%`;
      const match = or(
        ilike(contacts.name, pattern),
        ilike(sql`${contacts.email}::text`, pattern),
        ilike(contacts.phone, pattern),
      );
      if (match) conditions.push(match);
    }

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
  ): Promise<Array<{ id: string; fullName: string; email: string }>> {
    const rows = await tx
      .select({ id: users.uuid, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.status, 'active')))
      .orderBy(asc(users.fullName));
    return rows as Array<{ id: string; fullName: string; email: string }>;
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
