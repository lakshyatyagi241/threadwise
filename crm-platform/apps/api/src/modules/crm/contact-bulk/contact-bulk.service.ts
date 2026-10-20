import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { and, eq, sql } from 'drizzle-orm';
import {
  BULK_FILTER_MAX,
  EXPORT_KEEP_DAYS,
  EXPORT_MAX_ROWS,
  ERROR_CODES,
  canonicalizePhone,
  type BulkDeleteContactsInput,
  type ExportHistoryQuery,
  type ExportHistoryResponse,
  type BulkGroupContactsInput,
  type BulkOwnerContactsInput,
  type BulkSelectionResult,
  type BulkSetUncontactedInput,
  type BulkTagContactsInput,
  type ExportContactsInput,
  type RecordScope,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { PersonalDataErasureService } from '../../privacy';
import { ContactGroupsRepository } from '../contact-groups/contact-groups.repository';
import { assertOwnerWithinScope } from '../owner-scope';
import { contactConditions, contactScopeCondition, whereOf } from '../contacts/contact-conditions';
import { resolveContactFilter } from '../contacts/contact-filter.resolver';
import { ContactsRepository } from '../contacts/contacts.repository';
import { TagsRepository } from '../tags/tags.repository';
import { TagsService } from '../tags/tags.service';
import { ContactTouchService } from '../lead-handling/contact-touch.service';
import { ContactBulkRepository, type ActorMeta } from './contact-bulk.repository';
import { UTF8_BOM, csvLine, guardFormula } from './csv-writer';

const { fields, contactExports } = schema;

/** Failures listed in a response; the real number is `failedCount`. */
const FAILED_LIST_MAX = 100;
const DELETE_BATCH = 500;
const EXPORT_BATCH = 2000;

// The whole export file is compressed once and read back whole. Synchronous zlib holds the event loop for the full call (about 14 ms
// per MB to compress on the benchmark machine, tools/event-loop-audit/measure-zlib.mjs); the async form does the same work on the
// libuv pool and returns the same bytes.
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type Selection = {
  ids?: string[];
  filter?: BulkDeleteContactsInput['filter'];
  excludeIds?: string[];
};

interface Resolved {
  /** Undefined when the selection matches nothing (a stale group, owner or tag in the filter). */
  where: ReturnType<typeof whereOf> | undefined;
  idsMode: boolean;
  matched: number;
  /** Ids mode: which of the requested uuids exist inside the caller's record scope. */
  foundUuids: string[];
  requested: string[];
}

/**
 * Bulk actions on contacts (TW-CON-019..024).
 *
 * Every action takes the same selection: explicit ids, or "everything matching this filter"
 * (minus the rows un-ticked after choosing it). Reference's bar said "T selected" for all six
 * actions and only the two group ones honoured it; Export, Tag, Untag and Delete worked on the
 * ticked page rows alone. Here the selection is resolved once, by the same filter code the list
 * uses and inside the caller's record scope, and each action runs set-based over it.
 */
@Injectable()
export class ContactBulkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactBulkRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly groupsRepo: ContactGroupsRepository,
    private readonly tagsRepo: TagsRepository,
    private readonly tags: TagsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly erasure: PersonalDataErasureService,
    private readonly touch: ContactTouchService,
    private readonly rbac: RbacService,
  ) {}

  private meta(): ActorMeta {
    const ctx = RequestContextStore.require();
    return { actorId: ctx.actorId, actorType: ctx.actorType, requestId: ctx.requestId };
  }

  /**
   * Turns a selection into one WHERE. Throws CON_SELECTION_TOO_LARGE for a filter that matches
   * more than BULK_FILTER_MAX contacts, so a runaway "all matching" cannot hold a transaction
   * open for an hour; the message asks for a narrower filter.
   */
  private async resolve(
    tx: Tx,
    sel: Selection,
    scope: RecordScope,
    opts: {
      maxMatched: number;
      tooLargeCode?:
        typeof ERROR_CODES.CON_SELECTION_TOO_LARGE | typeof ERROR_CODES.CON_EXPORT_TOO_LARGE;
    },
  ): Promise<Resolved> {
    const ctx = RequestContextStore.require();
    const idsMode = sel.ids !== undefined;
    const requested = sel.ids ?? [];

    const resolution = await resolveContactFilter(
      tx,
      ctx.orgId,
      idsMode ? { includeArchived: true } : (sel.filter ?? {}),
      { uuids: sel.ids, excludeUuids: sel.excludeIds },
    );
    if (resolution.empty) {
      return { where: undefined, idsMode, matched: 0, foundUuids: [], requested };
    }
    const where = whereOf(
      contactConditions(
        ctx.orgId,
        resolution.filter,
        contactScopeCondition(ctx.orgId, scope, ctx.userId),
      ),
    );

    const matched = await this.repo.count(tx, where);
    if (matched > opts.maxMatched) {
      throw new AppError(
        opts.tooLargeCode ?? ERROR_CODES.CON_SELECTION_TOO_LARGE,
        `${matched} contacts match; at most ${opts.maxMatched} can be ${opts.tooLargeCode ? 'exported' : 'changed'} at once. Narrow the filter.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const foundUuids = idsMode ? await this.repo.uuids(tx, where, matched) : [];
    return { where, idsMode, matched, foundUuids, requested };
  }

  private result(r: Resolved, changed: number): BulkSelectionResult {
    // Ids that resolve to nothing in this org or this scope: reported, never an error for the batch.
    const found = new Set(r.foundUuids);
    const missing = r.idsMode ? r.requested.filter((id) => !found.has(id)) : [];
    return {
      matched: r.matched,
      changed,
      succeeded: r.idsMode ? r.foundUuids : [],
      failed: missing.slice(0, FAILED_LIST_MAX).map((id) => ({
        id,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Contact not found',
      })),
      failedCount: missing.length,
    };
  }

  // --- groups ------------------------------------------------------------------------------

  async group(input: BulkGroupContactsInput, scope: RecordScope): Promise<BulkSelectionResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const group = await this.groupsRepo.findByUuid(tx, ctx.orgId, input.groupId);
      if (!group) throw AppError.notFound('Contact group', input.groupId);

      const r = await this.resolve(tx, input, scope, { maxMatched: BULK_FILTER_MAX });
      let changed = 0;
      if (r.where && r.matched > 0) {
        const target = { id: group.id, uuid: group.uuid };
        changed =
          input.action === 'add'
            ? await this.repo.addToGroup(tx, ctx.orgId, r.where, target, this.meta())
            : await this.repo.removeFromGroup(tx, ctx.orgId, r.where, target, this.meta());
      }

      if (changed > 0) {
        await this.audit.record(tx, {
          module: 'contact_groups',
          recordId: group.id,
          action: 'update',
          delta: {
            members: {
              old: group.memberCount,
              new: group.memberCount + (input.action === 'add' ? changed : -changed),
            },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'contact_groups',
          aggregateId: group.id,
          eventType: 'contact_group.members_changed',
          payload: {
            uuid: group.uuid,
            action: input.action,
            changed,
            selection: r.idsMode ? 'ids' : 'filter',
          },
        });
      }
      return this.result(r, changed);
    });
  }

  // --- owner -------------------------------------------------------------------------------

  /**
   * Reassigns a selection (ids, or everything a filter matches) to one person or to nobody. The selection is
   * resolved inside the caller's `update` record scope, so a member limited to their own contacts can only move their
   * own, and the target is held to the same scope as a single edit (`assertOwnerWithinScope`: own = myself, team =
   * myself or a teammate, all = any active member). One audit row and one `contact.updated` event per contact changed.
   */
  async setOwner(input: BulkOwnerContactsInput, scope: RecordScope): Promise<BulkSelectionResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let owner: { id: number | null; uuid: string | null } = { id: null, uuid: null };
      if (input.ownerId) {
        const id = await this.contactsRepo.resolveActiveUserId(tx, ctx.orgId, input.ownerId);
        if (id === undefined) throw AppError.notFound('User', input.ownerId);
        owner = { id, uuid: input.ownerId };
      }
      if (ctx.grants) {
        await assertOwnerWithinScope({
          scope,
          actorUserId: ctx.userId,
          nextOwnerId: owner.id,
          inActorTeam: (id, below) =>
            this.contactsRepo.isOwnerInActorTeam(tx, ctx.orgId, ctx.userId!, id, below),
          path: 'ownerId',
        });
      }

      const r = await this.resolve(tx, input, scope, { maxMatched: BULK_FILTER_MAX });
      const changed =
        r.where && r.matched > 0
          ? await this.repo.setOwner(
              tx,
              ctx.orgId,
              r.where,
              owner,
              this.meta(),
              owner.id !== null && (await this.touch.marksOnReassign(tx, ctx.orgId)),
            )
          : 0;
      return this.result(r, changed);
    });
  }

  // --- uncontacted -------------------------------------------------------------------------

  /** Marks a selection as uncontacted or as contacted by hand (BL-290), inside the caller's update record scope. */
  async setUncontacted(
    input: BulkSetUncontactedInput,
    scope: RecordScope,
  ): Promise<BulkSelectionResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const r = await this.resolve(tx, input, scope, { maxMatched: BULK_FILTER_MAX });
      const changed =
        r.where && r.matched > 0
          ? await this.repo.setUncontacted(tx, ctx.orgId, r.where, input.uncontacted, this.meta())
          : 0;
      return this.result(r, changed);
    });
  }

  // --- tags --------------------------------------------------------------------------------

  async tag(input: BulkTagContactsInput, scope: RecordScope): Promise<BulkSelectionResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tag = await this.resolveTag(tx, ctx.orgId, input);

      const r = await this.resolve(tx, input, scope, { maxMatched: BULK_FILTER_MAX });
      let changed = 0;
      if (r.where && r.matched > 0) {
        const target = { id: tag.id, uuid: tag.uuid };
        changed =
          input.action === 'add'
            ? await this.repo.addTag(tx, ctx.orgId, r.where, target, this.meta())
            : await this.repo.removeTag(tx, ctx.orgId, r.where, target, this.meta());
      }

      if (changed > 0) {
        await this.audit.record(tx, {
          module: 'tags',
          recordId: tag.id,
          action: 'update',
          delta: {
            contacts: { old: null, new: `${input.action === 'add' ? '+' : '-'}${changed}` },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'tags',
          aggregateId: tag.id,
          eventType: 'tag.contacts_changed',
          payload: {
            uuid: tag.uuid,
            action: input.action,
            changed,
            selection: r.idsMode ? 'ids' : 'filter',
          },
        });
      }
      return this.result(r, changed);
    });
  }

  /**
   * By id when it names a tag in this org, else by name. Adding with an unknown name creates the
   * tag (permission and plan limit enforced by TagsService); removing never does.
   */
  private async resolveTag(tx: Tx, orgId: number, input: BulkTagContactsInput) {
    if (input.tagId) {
      const byId = await this.tagsRepo.findByUuid(tx, orgId, input.tagId);
      if (byId) return byId;
    }
    if (input.name) {
      if (input.action === 'add') {
        return (
          await this.tags.findOrCreateByName(tx, orgId, input.name, { enforcePermission: true })
        ).row;
      }
      const byName = await this.tagsRepo.findByName(tx, orgId, input.name);
      if (byName) return byName;
    }
    throw new AppError(
      ERROR_CODES.CON_TAG_REQUIRED,
      input.action === 'add' ? 'Pick a tag or type a new name.' : 'No such tag to remove.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  // --- delete ------------------------------------------------------------------------------

  /**
   * Hard delete, 500 at a time inside one transaction. Unknown ids and ids outside the caller's
   * scope are reported in `failed`, not a reason to refuse the rest (Reference answered 422 and
   * deleted nothing if ANY id was stale, and echoed the requested ids as if all were deleted).
   *
   * Each batch first runs the shared erasure pipeline over its contacts (conversations, messages, media, files, call logs): with
   * `eraseHistory` (default) they are removed, without it they are kept without the people's identity.
   */
  async delete(input: BulkDeleteContactsInput, scope: RecordScope): Promise<BulkSelectionResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const r = await this.resolve(tx, input, scope, { maxMatched: BULK_FILTER_MAX });
      let changed = 0;
      if (r.where) {
        const mode = input.eraseHistory === false ? 'anonymise' : 'delete';
        for (;;) {
          // The batch is locked and the delete takes these exact ids, so the history erased is the history of the rows deleted.
          const ids = await this.repo.nextIds(tx, r.where, DELETE_BATCH);
          if (ids.length === 0) break;
          await this.erasure.eraseContactHistory(tx, ctx.orgId, ids, mode);
          const n = await this.repo.deleteIds(tx, ctx.orgId, ids, this.meta());
          changed += n;
          if (ids.length < DELETE_BATCH) break;
        }
      }
      return this.result(r, changed);
    });
  }

  // --- export ------------------------------------------------------------------------------

  /**
   * The last exports of contacts, newest first, from the audit trail (who, when, how many rows, by ids or by filter), each with
   * its saved file while that is still kept. A file is offered to the person who made it and to anyone whose export scope is
   * "all" (a narrower scope must not read what a wider one exported).
   */
  async exportHistory(
    query: ExportHistoryQuery,
    scope: RecordScope,
  ): Promise<ExportHistoryResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT a.at, u.full_name AS by_name, a.delta,
               e.uuid AS file_id, e.byte_size AS file_bytes, e.expires_at, e.created_by AS file_owner
        FROM audit_log a
        LEFT JOIN users u ON a.actor_type = 'user' AND u.org_id = a.org_id AND u.id = a.actor_id
        LEFT JOIN contact_exports e ON e.org_id = a.org_id AND e.expires_at > now()
          AND e.uuid::text = a.delta -> 'exportId' ->> 'new'
        WHERE a.org_id = ${ctx.orgId} AND a.module = 'contacts' AND a.action = 'export'
        ORDER BY a.at DESC LIMIT ${query.limit}`);
      const data = (
        res.rows as Array<{
          at: string;
          by_name: string | null;
          delta: unknown;
          file_id: string | null;
          file_bytes: number | null;
          expires_at: string | null;
          file_owner: number | string | null;
        }>
      ).map((r) => {
        const d = (r.delta ?? {}) as { rows?: { new?: unknown }; selection?: { new?: unknown } };
        const mayDownload =
          r.file_id !== null &&
          (scope === 'all' || (r.file_owner !== null && Number(r.file_owner) === ctx.userId));
        return {
          at: new Date(r.at).toISOString(),
          by: r.by_name,
          rows: Number(d.rows?.new ?? 0),
          selection: d.selection?.new === 'ids' ? ('ids' as const) : ('filter' as const),
          fileId: mayDownload ? r.file_id : null,
          fileBytes: mayDownload && r.file_bytes !== null ? Number(r.file_bytes) : null,
          expiresAt: mayDownload && r.expires_at ? new Date(r.expires_at).toISOString() : null,
        };
      });
      return { data };
    });
  }

  /** A saved export's CSV (gunzipped), for the person who made it or an exporter with scope "all". Audited. */
  async downloadExport(
    fileId: string,
    scope: RecordScope,
  ): Promise<{ csv: Buffer; fileName: string }> {
    const ctx = RequestContextStore.require();
    const found = await this.db.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contactExports)
        .where(
          and(
            eq(contactExports.orgId, ctx.orgId),
            eq(contactExports.uuid, fileId),
            sql`${contactExports.expiresAt} > now()`,
          ),
        )
        .limit(1);
      // A file the caller may not read is "not found", the same answer as one that expired or never existed.
      if (!row || !(scope === 'all' || row.createdBy === ctx.userId)) {
        throw AppError.notFound('Export', fileId);
      }
      await this.audit.record(tx, {
        module: 'contacts',
        recordId: 0,
        action: 'read',
        delta: { exportId: { old: null, new: fileId }, rows: { old: null, new: row.rowCount } },
      });
      return { csvGz: row.csvGz, fileName: row.fileName };
    });
    // Outside the transaction: inflating a large file must not keep a connection checked out.
    return { csv: await gunzipAsync(found.csvGz), fileName: found.fileName };
  }

  /**
   * The CSV of a selection (TW-CON-021, 022), streamed in batches of 2,000 newest first.
   * One audit row records the export (who pulled how many contacts' personal data).
   *
   * Columns round-trip through the importer: E.164 phone, groups and tags by name, memo,
   * status, source, plus the workspace's active attributes. Free-text cells get the
   * formula-injection guard; numbers and dates do not (Reference guarded every cell, so its own
   * "+91..." numbers were exported as "'+91...").
   */
  async export(
    input: ExportContactsInput,
    scope: RecordScope,
  ): Promise<{ stream: Readable; rows: number; fileName: string }> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const exportId = randomUUID();

    // Restricted processing (docs/specs/legal-hold.md 3.2): a held contact is exported only to a user who may manage data requests.
    const legalExport = this.rbac.can(ctx.grants ?? new Map(), 'privacy.requests.manage').allowed;

    const prepared = await this.db.tx(async (tx) => {
      const r = await this.resolve(tx, input, scope, {
        maxMatched: EXPORT_MAX_ROWS,
        tooLargeCode: ERROR_CODES.CON_EXPORT_TOO_LARGE,
      });
      const attributes = await tx
        .select({ key: fields.key, label: fields.label })
        .from(fields)
        .where(
          and(
            eq(fields.orgId, orgId),
            eq(fields.moduleKey, 'contacts'),
            eq(fields.isActive, true),
            eq(fields.isSystem, false),
          ),
        )
        .orderBy(fields.position, fields.id);

      await this.audit.record(tx, {
        module: 'contacts',
        recordId: 0,
        action: 'export',
        delta: {
          exportId: { old: null, new: exportId },
          rows: { old: null, new: r.matched },
          selection: { old: null, new: r.idsMode ? 'ids' : 'filter' },
          // People under a legal hold (BL-295) are left out of an export unless the caller is an authorised legal user.
          ...(legalExport ? {} : { legalHoldExcluded: { old: null, new: true } }),
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'contacts',
        aggregateId: 0,
        eventType: 'contact.exported',
        payload: { rows: r.matched, selection: r.idsMode ? 'ids' : 'filter' },
      });
      return { r, attributes };
    });

    const { r, attributes } = prepared;
    const header = [
      'name',
      'first_name',
      'last_name',
      'phone',
      'country_code',
      'email',
      'groups',
      'tags',
      'language',
      'title',
      'address',
      'memo',
      'status',
      'source',
      'unsubscribed',
      'created_at',
      'owner_email',
      'timezone',
      ...attributes.map((a) => `attr:${a.key}`),
    ];

    const resolved = r;
    const db = this.db;
    const contactsRepo = this.contactsRepo;
    const repo = this.repo;
    const userId = ctx.userId;
    const rowsMatched = r.matched;
    // The file is kept (gzipped) once the whole CSV has been produced; a download that is cut off keeps nothing.
    const keep: Buffer[] = [];
    // `where` is built from immutable SQL chunks, so later batches (each in a short transaction
    // of their own, so a big export never pins one) reuse it unchanged.
    const conditions = resolved.where ? [resolved.where] : [];
    if (!legalExport)
      conditions.push(sql`NOT is_subject_held(contacts.org_id, 'contact', contacts.id)`);

    async function* produce(): AsyncGenerator<string> {
      yield (input.bom ? UTF8_BOM : '') + csvLine(header);
      if (!resolved.where) return;
      let after: { createdAt: Date; id: number } | undefined;
      for (;;) {
        const batch = await db.txAs({ orgId, userId }, async (tx) => {
          const rows = await repo.exportBatch(tx, conditions, after, EXPORT_BATCH);
          const ids = rows.map((x) => x.id);
          const groupChips = await contactsRepo.groupChips(tx, orgId, ids);
          const tagChips = await contactsRepo.tagChips(tx, orgId, ids);
          return { rows, groupChips, tagChips };
        });
        if (batch.rows.length === 0) return;
        for (const row of batch.rows) {
          const groups = batch.groupChips.filter((c) => c.contactId === row.id).map((c) => c.name);
          const tagNames = batch.tagChips.filter((c) => c.contactId === row.id).map((c) => c.name);
          const phone =
            canonicalizePhone({ number: row.phone, countryCode: row.countryCode })?.e164 ??
            row.phone;
          yield csvLine([
            guardFormula(row.name ?? ''),
            guardFormula(row.firstName ?? ''),
            guardFormula(row.lastName ?? ''),
            phone ?? '',
            row.countryCode ?? '',
            guardFormula(row.email ?? ''),
            guardFormula(groups.join(', ')),
            guardFormula(tagNames.join(', ')),
            guardFormula(row.language ?? ''),
            guardFormula(row.title ?? ''),
            guardFormula(row.address ?? ''),
            guardFormula(row.message ?? ''),
            guardFormula(row.status ?? ''),
            guardFormula(row.source ?? ''),
            row.isUnsubscribed ? 'true' : 'false',
            row.createdAt.toISOString(),
            guardFormula(row.ownerEmail ?? ''),
            row.timezone ?? '',
            ...attributes.map((a) => {
              const v = row.data?.[a.key];
              return guardFormula(v === null || v === undefined ? '' : String(v));
            }),
          ]);
        }
        const last = batch.rows[batch.rows.length - 1]!;
        after = { createdAt: last.createdAt, id: last.id };
        if (batch.rows.length < EXPORT_BATCH) return;
      }
    }

    const save = async () => {
      const gz = await gzipAsync(Buffer.concat(keep));
      await db.txAs({ orgId, userId }, async (tx) => {
        // Expired files of this workspace go with the next export; there is no separate sweep.
        await tx.delete(contactExports).where(
          and(
            eq(contactExports.orgId, orgId),
            sql`${contactExports.expiresAt} <= now()`,
            // A generated file may be evidence: kept while the workspace is under a workspace-wide legal hold (BL-295).
            sql`NOT is_subject_held(${contactExports.orgId}, 'contact', NULL)`,
          ),
        );
        await tx.insert(contactExports).values({
          orgId,
          uuid: exportId,
          createdBy: userId ?? null,
          fileName: 'contacts-export.csv',
          rowCount: rowsMatched,
          byteSize: gz.length,
          csvGz: gz,
          expiresAt: new Date(Date.now() + EXPORT_KEEP_DAYS * 86_400_000),
        });
      });
    };

    async function* lines(): AsyncGenerator<string> {
      for await (const chunk of produce()) {
        keep.push(Buffer.from(chunk, 'utf8'));
        yield chunk;
      }
      try {
        await save();
      } catch {
        // The person still gets their file; only the re-download is lost.
      }
    }

    return {
      stream: Readable.from(lines()),
      rows: r.matched,
      fileName: 'contacts-export.csv',
    };
  }
}
