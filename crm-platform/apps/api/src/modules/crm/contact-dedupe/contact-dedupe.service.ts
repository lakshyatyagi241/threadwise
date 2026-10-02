import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  phoneKey,
  type DedupeContactsInput,
  type DedupePreview,
  type DedupeResult,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';

const { contacts } = schema;

const SCAN_BATCH = 5000;
const PREVIEW_SETS = 100;
/** Tables whose rows are merged by hand below, so the generic re-point skips them. */
const HANDLED_TABLES = new Set(['contact_group_members', 'contact_tags', 'contact_identities']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

interface DuplicateSet {
  phone: string;
  survivorId: number;
  duplicateIds: number[];
}

/** Columns the survivor takes from a duplicate when it has none of its own. */
const FILLABLE = [
  'name',
  'firstName',
  'lastName',
  'middleName',
  'title',
  'email',
  'language',
  'address',
  'countryCode',
  'imageUrl',
  'message',
  'status',
  'source',
  'companyId',
  'ownerId',
  'faxNumber',
] as const;

/**
 * Remove duplicates (TW-CON-025), as a merge.
 *
 * Duplicates are contacts sharing a canonical phone (the same function create and import use,
 * so the three can no longer disagree about what a duplicate is). The OLDEST contact survives
 * (Reference's import updated the newest while its cleanup kept the oldest). Nothing is simply
 * dropped: the survivor absorbs the others' groups, tags, attribute values, empty fields,
 * notes, files, activities, deals, conversations and everything else that pointed at them
 * (Reference deleted the losers and left their history dangling).
 */
@Injectable()
export class ContactDedupeService {
  private readonly logger = new Logger(ContactDedupeService.name);
  /** (table, column) pairs of every composite FK into contacts; the schema does not change at runtime. */
  private referencing?: Array<{ table: string; column: string }>;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  /** Merging reaches across owners, so it needs the grant for every contact, not just "own". */
  private assertScopeAll(): void {
    const ctx = RequestContextStore.require();
    const grant = this.rbac.can(ctx.grants!, 'record.contacts.merge');
    if (!grant.allowed || grant.scope !== 'all') {
      throw new AppError(
        ERROR_CODES.CON_MERGE_SCOPE_REQUIRED,
        'Removing duplicates needs permission to merge every contact in the workspace.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async preview(): Promise<DedupePreview> {
    this.assertScopeAll();
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const sets = await this.findSets(tx, ctx.orgId);
      const shown = sets.slice(0, PREVIEW_SETS);
      const ids = shown.flatMap((s) => [s.survivorId, ...s.duplicateIds]);
      const uuidById = await this.uuidsOf(tx, ctx.orgId, ids);
      return {
        totalSets: sets.length,
        totalDuplicates: sets.reduce((n, s) => n + s.duplicateIds.length, 0),
        sets: shown.map((s) => ({
          phone: s.phone,
          survivorId: uuidById.get(s.survivorId)!,
          duplicateIds: s.duplicateIds.map((id) => uuidById.get(id)!),
        })),
      };
    });
  }

  async run(input: DedupeContactsInput): Promise<DedupeResult> {
    this.assertScopeAll();
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const sets = await this.findSets(tx, ctx.orgId);
      const todo = sets.slice(0, input.maxSets);
      let removed = 0;
      let merged = 0;
      for (const set of todo) {
        try {
          // A savepoint per set: one that cannot be merged (a row another request just deleted)
          // is skipped, it does not undo the sets already merged.
          await tx.transaction((sp) => this.mergeSet(sp, ctx.orgId, set));
          merged += 1;
          removed += set.duplicateIds.length;
        } catch (err) {
          this.logger.warn({ err, phone: set.phone }, 'could not merge a duplicate set; skipped');
        }
      }
      return { mergedSets: merged, removed, remainingSets: sets.length - merged };
    });
  }

  // --- finding -----------------------------------------------------------------------------

  /**
   * Walks the book in id order, 5,000 rows at a time, grouping by canonical phone. Only (id,
   * created_at, phone, country_code) are held, never whole rows.
   */
  private async findSets(tx: Tx, orgId: number): Promise<DuplicateSet[]> {
    const byKey = new Map<string, Array<{ id: number; createdAt: number }>>();
    let last = 0;
    for (;;) {
      const rows = await tx
        .select({
          id: contacts.id,
          phone: contacts.phone,
          countryCode: contacts.countryCode,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), gt(contacts.id, last)))
        .orderBy(asc(contacts.id))
        .limit(SCAN_BATCH);
      if (rows.length === 0) break;
      for (const r of rows) {
        const key = phoneKey(r.phone, r.countryCode);
        if (!key) continue; // no number: never a duplicate of anything
        const list = byKey.get(key);
        const entry = { id: r.id, createdAt: r.createdAt.getTime() };
        if (list) list.push(entry);
        else byKey.set(key, [entry]);
      }
      last = rows[rows.length - 1]!.id;
      if (rows.length < SCAN_BATCH) break;
    }

    const sets: DuplicateSet[] = [];
    for (const [phone, list] of byKey) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
      sets.push({
        phone,
        survivorId: list[0]!.id,
        duplicateIds: list.slice(1).map((e) => e.id),
      });
    }
    return sets.sort((a, b) => a.survivorId - b.survivorId);
  }

  private async uuidsOf(tx: Tx, orgId: number, ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: contacts.id, uuid: contacts.uuid })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.id, ids)));
    return new Map(rows.map((r) => [r.id, r.uuid]));
  }

  // --- merging -----------------------------------------------------------------------------

  private async mergeSet(tx: Tx, orgId: number, set: DuplicateSet): Promise<void> {
    const { survivorId, duplicateIds } = set;
    const all = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.id, [survivorId, ...duplicateIds])));
    const survivor = all.find((c) => c.id === survivorId);
    if (!survivor) throw new Error('survivor vanished');
    // oldest first: when two duplicates both have a value, the older one's is kept
    const losers = all
      .filter((c) => c.id !== survivorId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
    if (losers.length === 0) return;
    const loserIds = losers.map((l) => l.id);

    // 1. fields: the survivor keeps what it has, takes what it lacks
    const patch: Record<string, unknown> = {};
    const survivorRec = survivor as unknown as Record<string, unknown>;
    for (const col of FILLABLE) {
      const have = survivorRec[col];
      if (have !== null && have !== undefined && have !== '') continue;
      for (const l of losers) {
        const v = (l as unknown as Record<string, unknown>)[col];
        if (v !== null && v !== undefined && v !== '') {
          patch[col] = v;
          break;
        }
      }
    }
    // attribute values: every duplicate's keys, the survivor's own value wins on a clash
    const mergedData: Record<string, unknown> = {};
    for (const l of [...losers].reverse()) Object.assign(mergedData, l.data ?? {});
    Object.assign(mergedData, survivor.data ?? {});
    if (JSON.stringify(mergedData) !== JSON.stringify(survivor.data ?? {})) patch.data = mergedData;
    // an opt-out is never forgotten by a merge
    if (!survivor.isUnsubscribed && losers.some((l) => l.isUnsubscribed)) {
      patch.isUnsubscribed = true;
      patch.unsubscribedAt =
        losers.map((l) => l.unsubscribedAt).find((d): d is Date => d !== null) ?? new Date();
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(contacts)
        .set(patch)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.id, survivorId)));
    }

    const losersIn = sql.join(
      loserIds.map((id) => sql`${id}`),
      sql`, `,
    );

    // 2. groups and tags: union, never drop
    await tx.execute(sql`
      INSERT INTO contact_group_members (org_id, contact_id, group_id)
      SELECT ${orgId}::bigint, ${survivorId}::bigint, group_id FROM contact_group_members
      WHERE org_id = ${orgId} AND contact_id IN (${losersIn})
      ON CONFLICT (org_id, contact_id, group_id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO contact_tags (org_id, contact_id, tag_id, created_by, created_at)
      SELECT ${orgId}::bigint, ${survivorId}::bigint, tag_id, created_by, created_at FROM contact_tags
      WHERE org_id = ${orgId} AND contact_id IN (${losersIn})
      ON CONFLICT (org_id, contact_id, tag_id) DO NOTHING
    `);

    // 3. the survivor answers to every number and email the duplicates had
    await tx.execute(sql`
      UPDATE contact_identities SET contact_id = ${survivorId}, is_primary = false
      WHERE org_id = ${orgId} AND contact_id IN (${losersIn})
    `);

    // 4. everything else that pointed at a duplicate points at the survivor
    for (const ref of await this.referencingColumns(tx)) {
      if (HANDLED_TABLES.has(ref.table)) continue;
      try {
        await tx.transaction((sp) =>
          sp.execute(sql`
            UPDATE ${sql.raw(`"${ref.table}"`)} SET ${sql.raw(`"${ref.column}"`)} = ${survivorId}
            WHERE org_id = ${orgId} AND ${sql.raw(`"${ref.column}"`)} IN (${losersIn})
          `),
        );
      } catch (err) {
        // A unique key the survivor already satisfies (one flow subscription per contact...):
        // that row stays and goes with the duplicate, which is the right outcome for it.
        this.logger.debug({ err, table: ref.table }, 'left rows on the duplicate');
      }
    }

    // 5. the trail, written before the rows are gone
    const survivorUuid = survivor.uuid;
    await this.audit.record(tx, {
      module: 'contacts',
      recordId: survivorId,
      action: 'merge',
      delta: { mergedFrom: { old: null, new: losers.map((l) => l.uuid) } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'contacts',
      aggregateId: survivorId,
      eventType: 'contact.merged',
      payload: { uuid: survivorUuid, mergedUuids: losers.map((l) => l.uuid), phone: set.phone },
    });
    for (const l of losers) {
      await this.audit.record(tx, {
        module: 'contacts',
        recordId: l.id,
        action: 'delete',
        delta: { mergedInto: { old: null, new: survivorUuid } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'contacts',
        aggregateId: l.id,
        eventType: 'contact.deleted',
        payload: { uuid: l.uuid, displayId: l.displayId, mergedInto: survivorUuid },
      });
    }

    // 6. and only now do the duplicates go
    await tx.delete(contacts).where(and(eq(contacts.orgId, orgId), inArray(contacts.id, loserIds)));
  }

  /** Every (table, column) with a composite (org_id, column) foreign key into contacts. */
  private async referencingColumns(tx: Tx): Promise<Array<{ table: string; column: string }>> {
    if (this.referencing) return this.referencing;
    const res = await tx.execute(sql`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[2]
      WHERE c.contype = 'f' AND c.confrelid = 'contacts'::regclass
        AND array_length(c.conkey, 1) = 2
        AND (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) = 'org_id'
    `);
    this.referencing = (res.rows as Array<{ tbl: string; col: string }>)
      .map((r) => ({ table: r.tbl.replace(/^public\./, ''), column: r.col }))
      .filter((r) => IDENT.test(r.table) && IDENT.test(r.column) && r.table !== 'contacts');
    return this.referencing;
  }
}
