import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  IMPORT_REJECTS_MAX,
  contactImportOptionsSchema,
  type ContactImportOptions,
  type ImportRejectReason,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { DisplayIdService } from '../../../kernel/identifiers/display-id.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { ContactGroupsRepository } from '../contact-groups/contact-groups.repository';
import { ContactQuotaService } from '../contacts/contact-quota.service';
import {
  ContactConsentService,
  ContactPrivacyService,
  MinorDetectionService,
  intakeEvidence,
} from '../../contact-consent';
import { TagsService } from '../tags/tags.service';
import { ContactImportRepository, type ImportJobRow } from './contact-import.repository';
import { parseCsv, type Delimiter } from './csv-parser';
import { extractRow, resolveMapping, type ParsedRow, type ResolvedMapping } from './import-rows';
import { ContactTouchService } from '../lead-handling/contact-touch.service';

const { contacts, contactGroupMembers, contactTags } = schema;

/** Rows per transaction: big enough to be fast, small enough that progress is visible and a retry loses little. */
const BATCH = 500;
const MAX_NEW_GROUPS = 2000;

interface Reject {
  row: number;
  reason: string;
  values?: Record<string, string>;
}

interface Counters {
  created: number;
  updated: number;
  invalid: number;
  duplicatesInFile: number;
  limitExceeded: number;
}

/** What one distinct phone number in a batch turns into. */
interface Op {
  kind: 'create' | 'update';
  contactId?: number;
  row: ParsedRow;
  groups: Set<string>;
  tags: Set<string>;
}

interface RunState {
  counters: Counters;
  rejects: Reject[];
  /** E.164 -> contact id, for every number this run has created or matched. */
  fileMap: Map<string, number>;
  /** New contacts the plan still allows; null = unlimited. */
  remaining: number | null;
  groupIds: Map<string, number>;
  tagIds: Map<string, number>;
  knobGroupId?: number;
  knobTagIds: number[];
}

const lower = (s: string) => s.toLowerCase();

/**
 * The CSV import (TW-CON-027..031), the same code for the inline path and the background job.
 *
 * What it keeps from Reference: a row is a contact keyed by its phone number, the same number again
 * updates instead of duplicating, groups named in the file are created on demand, "apply to
 * every contact" knobs. What it fixes (see "Port decisions" in the inventory): the key is the
 * ONE canonical phone the rest of the product uses, the oldest duplicate is the one updated,
 * group and tag knobs reach updated rows too, tags are really applied, rows are validated and the
 * rejected ones reported with a reason, the plan's contact cap is counted per new contact, and
 * every outcome has its own counter.
 *
 * Work is committed in batches of 500 rows. The job row records how far it got, so a retry resumes
 * where the last attempt stopped instead of starting over.
 */
@Injectable()
export class ContactImportEngine {
  private readonly logger = new Logger(ContactImportEngine.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: ContactImportRepository,
    private readonly groupsRepo: ContactGroupsRepository,
    private readonly tags: TagsService,
    private readonly quota: ContactQuotaService,
    private readonly displayIds: DisplayIdService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly consent: ContactConsentService,
    private readonly privacy: ContactPrivacyService,
    private readonly minors: MinorDetectionService,
    private readonly touch: ContactTouchService,
  ) {}

  /** Runs (or resumes) an import job to the end. Needs a request context (the processor sets one). */
  async run(orgId: number, userId: number | null, jobId: number): Promise<void> {
    const tenant = { orgId, userId };
    const job = await this.db.txAs(tenant, (tx) => this.jobs.findById(tx, orgId, jobId));
    if (!job || job.status === 'completed' || job.sourceCsv === null) return;

    await this.db.txAs(tenant, (tx) =>
      this.jobs.update(tx, orgId, jobId, {
        status: 'running',
        startedAt: job.startedAt ?? new Date(),
        error: null,
      }),
    );

    try {
      await this.process(orgId, userId, job);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      this.logger.error({ err, jobId, orgId }, 'contact import failed');
      await this.db.txAs(tenant, (tx) =>
        this.jobs.update(tx, orgId, jobId, {
          status: 'failed',
          error: message.slice(0, 500),
          finishedAt: new Date(),
        }),
      );
      throw err;
    }
  }

  private async process(orgId: number, userId: number | null, job: ImportJobRow): Promise<void> {
    const tenant = { orgId, userId };
    const options = contactImportOptionsSchema.parse(job.options);
    const parsed = parseCsv(job.sourceCsv!, options.delimiter as Delimiter | undefined);
    const header = parsed.records[0]?.cells ?? [];
    const mapping = resolveMapping(header, options.mapping);
    const data = parsed.records.slice(1);

    const state = await this.db.txAs(tenant, (tx) =>
      this.prepare(tx, orgId, userId, job, data, mapping, header, options),
    );

    for (let start = job.processedRows; start < data.length; start += BATCH) {
      const slice = data.slice(start, start + BATCH);
      await this.db.txAs(tenant, async (tx) => {
        await this.processBatch(tx, orgId, userId, job, slice, state, mapping, header, options);
        await this.jobs.update(tx, orgId, job.id, {
          processedRows: start + slice.length,
          createdCount: state.counters.created,
          updatedCount: state.counters.updated,
          invalidCount: state.counters.invalid,
          duplicatesInFile: state.counters.duplicatesInFile,
          limitExceeded: state.counters.limitExceeded,
          rejects: state.rejects,
        });
      });
    }

    await this.db.txAs(tenant, async (tx) => {
      await this.jobs.update(tx, orgId, job.id, {
        status: 'completed',
        processedRows: data.length,
        finishedAt: new Date(),
        sourceCsv: null,
        rejects: state.rejects,
      });
      await this.audit.record(tx, {
        module: 'contact_import_jobs',
        recordId: job.id,
        action: 'update',
        delta: {
          status: { old: 'running', new: 'completed' },
          created: { old: null, new: state.counters.created },
          updated: { old: null, new: state.counters.updated },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'contact_import_jobs',
        aggregateId: job.id,
        eventType: 'contact.import_completed',
        payload: { uuid: job.uuid, ...state.counters, totalRows: data.length },
      });
    });
  }

  /**
   * Everything a run needs from the database before its first row: the knob group and tags, every
   * group and tag the file names (created when missing), the plan's remaining room, and the
   * counters to resume from.
   */
  private async prepare(
    tx: Tx,
    orgId: number,
    userId: number | null,
    job: ImportJobRow,
    data: Array<{ line: number; cells: string[] }>,
    mapping: ResolvedMapping,
    header: string[],
    options: ContactImportOptions,
  ): Promise<RunState> {
    const groupNames = new Map<string, string>();
    const tagNames = new Map<string, string>();
    for (const rec of data) {
      const r = extractRow(rec, mapping, header, {
        defaultCountryCode: options.defaultCountryCode,
      });
      if (!r.ok) continue;
      for (const g of r.row.groups) groupNames.set(lower(g), g);
      for (const t of r.row.tags) tagNames.set(lower(t), t);
    }
    if (groupNames.size > MAX_NEW_GROUPS) {
      throw new AppError(
        ERROR_CODES.CON_IMPORT_FILE_INVALID,
        `The file names ${groupNames.size} different groups; the limit is ${MAX_NEW_GROUPS}. Is the group column right?`,
      );
    }

    // What already exists, read once for the whole file: one query for the groups and one for the tags, not one per distinct name.
    const knownGroups = await this.groupsRepo.findByNames(tx, orgId, [...groupNames.values()]);
    const knownTags = await this.tags.findManyByNames(tx, orgId, [...tagNames.values()]);

    const groupIds = new Map<string, number>();
    for (const [key, name] of groupNames) {
      let group = knownGroups.get(lower(name.trim()));
      if (!group) {
        const created = await this.groupsRepo.insertIfAbsent(tx, orgId, {
          name,
          createdBy: userId,
        });
        if (created) {
          await this.audit.record(tx, {
            module: 'contact_groups',
            recordId: created.id,
            action: 'insert',
          });
          await this.outbox.emit(tx, {
            aggregateModule: 'contact_groups',
            aggregateId: created.id,
            eventType: 'contact_group.created',
            payload: { uuid: created.uuid, name, via: 'import' },
          });
          groupIds.set(key, created.id);
          continue;
        }
        group = await this.groupsRepo.findByName(tx, orgId, name);
      }
      groupIds.set(key, group!.id);
    }

    const tagIds = new Map<string, number>();
    for (const [key, name] of tagNames) {
      const known = knownTags.get(lower(name.trim()));
      if (known) {
        tagIds.set(key, known.id);
        continue;
      }
      // Permission to create tags was checked when the import was accepted; a worker has no
      // grants. The plan's tag limit is checked here, as everywhere.
      const { row } = await this.tags.findOrCreateByName(tx, orgId, name, {
        enforcePermission: false,
      });
      tagIds.set(key, row.id);
    }

    let knobGroupId: number | undefined;
    if (options.groupId) {
      const g = await this.groupsRepo.resolveIds(tx, orgId, [options.groupId]);
      knobGroupId = g.get(options.groupId);
      if (knobGroupId === undefined) throw AppError.notFound('Contact group', options.groupId);
    }
    const knobTagIds: number[] = [];
    if (options.tagIds?.length) {
      const rows = await tx
        .select({ id: schema.tags.id, uuid: schema.tags.uuid })
        .from(schema.tags)
        .where(and(eq(schema.tags.orgId, orgId), inArray(schema.tags.uuid, options.tagIds)));
      if (rows.length !== new Set(options.tagIds).size) throw AppError.notFound('Tag');
      knobTagIds.push(...rows.map((r) => r.id));
    }

    const usage = await this.quota.usage(tx, orgId);
    return {
      counters: {
        created: job.createdCount,
        updated: job.updatedCount,
        invalid: job.invalidCount,
        duplicatesInFile: job.duplicatesInFile,
        limitExceeded: job.limitExceeded,
      },
      rejects: [...job.rejects],
      fileMap: new Map(),
      remaining: usage.remaining,
      groupIds,
      tagIds,
      knobGroupId,
      knobTagIds,
    };
  }

  /** Existing contacts by canonical phone: through the identity table, else the stored number. Oldest wins. */
  /** Of these contact ids, the ones under a legal hold (one statement per chunk; nothing is read when the workspace has no hold at all). */
  async heldAmong(tx: Tx, orgId: number, ids: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    if (ids.length === 0) return out;
    const any = await tx.execute(sql`SELECT org_has_active_legal_hold(${orgId}::bigint) AS held`);
    if ((any.rows[0] as { held: boolean }).held !== true) return out;
    for (let i = 0; i < ids.length; i += 5000) {
      const res = await tx.execute(sql`
        SELECT c AS id FROM unnest(${`{${ids.slice(i, i + 5000).join(',')}}`}::bigint[]) AS c
         WHERE is_subject_held(${orgId}::bigint, 'contact', c)`);
      for (const r of res.rows as Array<{ id: number | string }>) out.add(Number(r.id));
    }
    return out;
  }

  async findExisting(tx: Tx, orgId: number, keys: string[]): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    for (let i = 0; i < keys.length; i += 2000) {
      const chunk = keys.slice(i, i + 2000);
      const list = sql.join(
        chunk.map((k) => sql`${k}`),
        sql`, `,
      );
      const res = await tx.execute(sql`
        SELECT value AS key, contact_id AS id FROM contact_identities
          WHERE org_id = ${orgId} AND kind = 'phone' AND value IN (${list})
        UNION ALL
        SELECT normalized_phone AS key, id FROM contacts
          WHERE org_id = ${orgId} AND normalized_phone IN (${list})
      `);
      for (const r of res.rows as Array<{ key: string; id: number }>) {
        const id = Number(r.id);
        const prev = found.get(r.key);
        if (prev === undefined || id < prev) found.set(r.key, id);
      }
    }
    return found;
  }

  private async processBatch(
    tx: Tx,
    orgId: number,
    userId: number | null,
    job: ImportJobRow,
    slice: Array<{ line: number; cells: string[] }>,
    state: RunState,
    mapping: ResolvedMapping,
    header: string[],
    options: ContactImportOptions,
  ): Promise<void> {
    const reject = (row: number, reason: ImportRejectReason, values?: Record<string, string>) => {
      state.counters.invalid += reason === 'plan_limit_reached' ? 0 : 1;
      if (reason === 'plan_limit_reached') state.counters.limitExceeded += 1;
      if (state.rejects.length < IMPORT_REJECTS_MAX) state.rejects.push({ row, reason, values });
    };

    // 1. validate
    const valid: ParsedRow[] = [];
    for (const rec of slice) {
      const r = extractRow(rec, mapping, header, {
        defaultCountryCode: options.defaultCountryCode,
      });
      if (r.ok) valid.push(r.row);
      else reject(r.line, r.reason, r.values);
    }
    if (valid.length === 0) return;

    // 2. who already exists
    const keys = [...new Set(valid.map((r) => r.phone))].filter((k) => !state.fileMap.has(k));
    const existing = await this.findExisting(tx, orgId, keys);
    // An import that would overwrite a person under a legal hold (BL-295) skips that row: evidence is not rewritten by a spreadsheet.
    const held = await this.heldAmong(tx, orgId, [...new Set(existing.values())]);

    // A repeated number is merged, not lost, but it is listed in the report so the person sees what was folded in.
    const cellsByLine = new Map(slice.map((rec) => [rec.line, rec.cells]));
    const noteDuplicate = (line: number) => {
      // At most half the report goes to merged duplicates, so a file full of them cannot hide the real errors.
      if (
        state.rejects.length >= IMPORT_REJECTS_MAX ||
        state.counters.duplicatesInFile > IMPORT_REJECTS_MAX / 2
      )
        return;
      const cells = cellsByLine.get(line) ?? [];
      state.rejects.push({
        row: line,
        reason: 'duplicate_in_file',
        values: Object.fromEntries(
          header
            .slice(0, 20)
            .map((h, i) => [h || `column_${i + 1}`, (cells[i] ?? '').slice(0, 200)]),
        ),
      });
    };

    // 3. one operation per distinct number in the batch; a later row for the same number
    //    refines the earlier one (its non-empty cells win)
    const ops = new Map<string, Op>();
    for (const row of valid) {
      const seen = ops.get(row.phone);
      if (seen) {
        state.counters.duplicatesInFile += 1;
        noteDuplicate(row.line);
        seen.row = mergeRows(seen.row, row);
        row.groups.forEach((g) => seen.groups.add(g));
        row.tags.forEach((t) => seen.tags.add(t));
        continue;
      }
      const knownId = state.fileMap.get(row.phone) ?? existing.get(row.phone);
      if (knownId !== undefined && held.has(knownId)) {
        reject(row.line, 'legal_hold');
        continue;
      }
      if (knownId !== undefined) {
        if (state.fileMap.has(row.phone)) {
          state.counters.duplicatesInFile += 1;
          noteDuplicate(row.line);
        } else state.counters.updated += 1;
        ops.set(row.phone, {
          kind: 'update',
          contactId: knownId,
          row,
          groups: new Set(row.groups),
          tags: new Set(row.tags),
        });
        continue;
      }
      if (state.remaining !== null && state.remaining <= 0) {
        reject(row.line, 'plan_limit_reached');
        continue;
      }
      if (state.remaining !== null) state.remaining -= 1;
      ops.set(row.phone, {
        kind: 'create',
        row,
        groups: new Set(row.groups),
        tags: new Set(row.tags),
      });
    }

    // 4. create
    const creates = [...ops.values()].filter((o) => o.kind === 'create');
    if (creates.length > 0) {
      const values = [];
      for (const o of creates) {
        values.push({
          orgId,
          uuid: sql`gen_random_uuid()`,
          displayId: await this.displayIds.next(tx, orgId, 'contacts', 'CON'),
          name: o.row.name,
          firstName: o.row.firstName ?? null,
          lastName: o.row.lastName ?? null,
          email: o.row.email ?? null,
          phone: o.row.phone,
          countryCode: o.row.countryCode ?? null,
          language: o.row.language ?? null,
          title: o.row.title ?? null,
          address: o.row.address ?? null,
          dateOfBirth: o.row.dateOfBirth ?? null,
          message: o.row.memo ?? null,
          status: o.row.status ?? options.status ?? null,
          // "import" when nothing says otherwise, so the Imported filter and the source column agree
          source: o.row.source ?? options.source ?? 'import',
          timezone: o.row.timezone ?? null,
          timezoneSource: o.row.timezone ? 'import' : null,
          importJobId: job.id,
          ownerId: userId,
          createdBy: userId,
          updatedBy: userId,
        });
      }
      const inserted = await tx
        .insert(contacts)
        .values(values)
        .returning({ id: contacts.id, uuid: contacts.uuid, phone: contacts.phone });
      for (const row of inserted) {
        const op = ops.get(row.phone!)!;
        op.contactId = row.id;
        state.fileMap.set(row.phone!, row.id);
      }
      state.counters.created += inserted.length;

      // identities, so create, import and dedupe find these contacts by the same key
      const identityRows = creates.flatMap((o) => [
        sql`(${orgId}, ${o.contactId}, 'phone', ${o.row.phone}, true)`,
        ...(o.row.email ? [sql`(${orgId}, ${o.contactId}, 'email', ${o.row.email}, true)`] : []),
      ]);
      await this.addIdentities(tx, identityRows);
      // Start uncontacted when the workspace says imported contacts do (BL-290). Off by default: no write.
      await this.touch.markNewMany(
        tx,
        orgId,
        inserted.map((r) => r.id),
        'import',
      );

      if (options.triggerAutomations) {
        for (const row of inserted) {
          await this.outbox.emit(tx, {
            aggregateModule: 'contacts',
            aggregateId: row.id,
            eventType: 'contact.created',
            payload: { uuid: row.uuid, phone: row.phone, via: 'import' },
          });
        }
      }
    }

    // 5. update: only what the file provided, never the phone, status or source
    for (const o of ops.values()) {
      if (o.kind !== 'update' || o.contactId === undefined) continue;
      state.fileMap.set(o.row.phone, o.contactId);
      const patch: Record<string, unknown> = { name: o.row.name, updatedBy: userId };
      if (o.row.firstName) patch.firstName = o.row.firstName;
      if (o.row.lastName) patch.lastName = o.row.lastName;
      if (o.row.email) patch.email = o.row.email;
      if (o.row.countryCode) patch.countryCode = o.row.countryCode;
      if (o.row.language) patch.language = o.row.language;
      if (o.row.title) patch.title = o.row.title;
      if (o.row.address) patch.address = o.row.address;
      if (o.row.memo) patch.message = o.row.memo;
      // A zone in the file fills a contact that has none (or one an earlier import set); it never replaces a zone a person or the API chose.
      if (o.row.timezone) {
        patch.timezone = sql`CASE WHEN ${contacts.timezone} IS NULL OR ${contacts.timezoneSource} = 'import' THEN ${o.row.timezone} ELSE ${contacts.timezone} END`;
        patch.timezoneSource = sql`CASE WHEN ${contacts.timezone} IS NULL OR ${contacts.timezoneSource} = 'import' THEN 'import' ELSE ${contacts.timezoneSource} END`;
      }
      // The importer's date replaces the stored one: a file is a person's deliberate correction (the sweep reads the new date).
      if (o.row.dateOfBirth) patch.dateOfBirth = o.row.dateOfBirth;
      await tx
        .update(contacts)
        .set(patch)
        .where(and(eq(contacts.orgId, orgId), eq(contacts.id, o.contactId)));
      await this.addIdentities(tx, [
        sql`(${orgId}, ${o.contactId}, 'phone', ${o.row.phone}, true)`,
        ...(o.row.email ? [sql`(${orgId}, ${o.contactId}, 'email', ${o.row.email}, true)`] : []),
      ]);
    }

    // 5a. age (BL-190): a date of birth brings the minor flag in line with it (source `dob`); a yes in the minor column flags the contact
    //     (source `import`, the file as evidence). A no, a blank and a word nobody knows change nothing, and a file never clears a flag.
    for (const o of ops.values()) {
      if (o.contactId === undefined) continue;
      if (o.row.dateOfBirth) {
        await this.minors.evaluateInTx(tx, orgId, o.contactId, new Date(), { dobChanged: true });
      }
      if (o.row.minor) {
        await this.privacy.changeInTx(tx, orgId, {
          contactId: o.contactId,
          kind: 'minor',
          value: true,
          source: 'import',
          evidence: { fileName: job.fileName, reference: job.uuid },
          actorUserId: userId,
          idempotencyKey: `import:${job.uuid}:${o.contactId}:minor`,
        });
      }
    }

    // 5b. consent: the importer confirmed they have it, so contacts of the batch get ledger grants (never over an opt-out). The proof is
    //     the file name and job, the time, the importer's confirmation, and the notice wording and version the importer stated for the
    //     file (BL-170). Per channel (privacy spec 4.3.2):
    //       whatsapp  every contact, or with a consent column mapped only the rows that say yes (as before);
    //       sms       only with an SMS consent column mapped, only the rows that say yes;
    //       email     only with an email consent column mapped, only the rows that say yes AND carry an address.
    //     A no, a blank and an unknown word record nothing; a file never grants a channel it has no column for (except WhatsApp).
    if (options.consentConfirmed) {
      const evidence = intakeEvidence(
        { text: options.consentNoticeText, version: options.consentNoticeVersion },
        { fileName: job.fileName, reference: job.uuid },
      );
      const note = options.consentNoticeText?.trim()
        ? 'The person importing confirmed consent for this file, under the notice they stated'
        : 'The person importing confirmed consent for this file';
      for (const o of ops.values()) {
        if (o.contactId === undefined) continue;
        for (const ch of importChannelsOf(o.row)) {
          await this.consent.recordInTx(tx, orgId, {
            contactId: o.contactId,
            channel: ch,
            action: 'granted',
            source: 'import',
            evidence,
            actorUserId: userId,
            note,
            // The WhatsApp key is the one this import always used, so a retried job writes nothing twice.
            idempotencyKey:
              ch === 'whatsapp'
                ? `import:${job.uuid}:${o.contactId}`
                : `import:${job.uuid}:${o.contactId}:${ch}`,
            respectWithdrawn: true,
          });
        }
      }
    }

    // 6. groups and tags: the file's own plus the knobs, for new and updated contacts alike
    const members: Array<{ orgId: number; contactId: number; groupId: number }> = [];
    const tagged: Array<{
      orgId: number;
      contactId: number;
      tagId: number;
      createdBy: number | null;
    }> = [];
    for (const o of ops.values()) {
      if (o.contactId === undefined) continue;
      const groupIds = new Set<number>();
      o.groups.forEach((g) => groupIds.add(state.groupIds.get(lower(g))!));
      if (state.knobGroupId !== undefined) groupIds.add(state.knobGroupId);
      groupIds.forEach((groupId) => members.push({ orgId, contactId: o.contactId!, groupId }));

      const tagIds = new Set<number>(state.knobTagIds);
      o.tags.forEach((t) => tagIds.add(state.tagIds.get(lower(t))!));
      tagIds.forEach((tagId) =>
        tagged.push({ orgId, contactId: o.contactId!, tagId, createdBy: userId }),
      );
    }
    const addedMembers: Array<{ contactId: number; targetId: number }> = [];
    for (let i = 0; i < members.length; i += 1000) {
      const added = await tx
        .insert(contactGroupMembers)
        .values(members.slice(i, i + 1000))
        .onConflictDoNothing()
        .returning({
          contactId: contactGroupMembers.contactId,
          groupId: contactGroupMembers.groupId,
        });
      addedMembers.push(...added.map((r) => ({ contactId: r.contactId, targetId: r.groupId })));
    }
    const addedTags: Array<{ contactId: number; targetId: number }> = [];
    for (let i = 0; i < tagged.length; i += 1000) {
      const added = await tx
        .insert(contactTags)
        .values(tagged.slice(i, i + 1000))
        .onConflictDoNothing()
        .returning({ contactId: contactTags.contactId, tagId: contactTags.tagId });
      addedTags.push(...added.map((r) => ({ contactId: r.contactId, targetId: r.tagId })));
    }
    if (options.triggerAutomations) {
      await this.emitMembershipEvents(tx, orgId, addedMembers, 'group');
      await this.emitMembershipEvents(tx, orgId, addedTags, 'tag');
    }
  }

  /** `contact.group_added` / `contact.tag_added` per new membership, for flows. Only when the import asked for automations. */
  private async emitMembershipEvents(
    tx: Tx,
    orgId: number,
    rows: Array<{ contactId: number; targetId: number }>,
    kind: 'group' | 'tag',
  ): Promise<void> {
    if (rows.length === 0) return;
    const contactIds = [...new Set(rows.map((r) => r.contactId))];
    const targetIds = [...new Set(rows.map((r) => r.targetId))];
    const contactUuids = new Map(
      (
        await tx
          .select({ id: contacts.id, uuid: contacts.uuid })
          .from(contacts)
          .where(and(eq(contacts.orgId, orgId), inArray(contacts.id, contactIds)))
      ).map((r) => [r.id, r.uuid]),
    );
    const targetUuids = new Map(
      kind === 'group'
        ? (
            await tx
              .select({ id: schema.contactGroups.id, uuid: schema.contactGroups.uuid })
              .from(schema.contactGroups)
              .where(
                and(
                  eq(schema.contactGroups.orgId, orgId),
                  inArray(schema.contactGroups.id, targetIds),
                ),
              )
          ).map((r) => [r.id, r.uuid] as const)
        : (
            await tx
              .select({ id: schema.tags.id, uuid: schema.tags.uuid })
              .from(schema.tags)
              .where(and(eq(schema.tags.orgId, orgId), inArray(schema.tags.id, targetIds)))
          ).map((r) => [r.id, r.uuid] as const),
    );
    for (const r of rows) {
      await this.outbox.emit(tx, {
        aggregateModule: 'contacts',
        aggregateId: r.contactId,
        eventType: kind === 'group' ? 'contact.group_added' : 'contact.tag_added',
        payload: {
          uuid: contactUuids.get(r.contactId),
          [kind === 'group' ? 'groupId' : 'tagId']: targetUuids.get(r.targetId),
          via: 'import',
        },
      });
    }
  }

  private async addIdentities(tx: Tx, rows: ReturnType<typeof sql>[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.execute(sql`
      INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary)
      VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT (org_id, kind, value) DO NOTHING
    `);
  }
}

/**
 * The channels a confirmed import grants for one row (BL-170). WhatsApp keeps its meaning: no consent column means the importer's
 * confirmation covers every contact; a column means only a yes. SMS and email are granted only from their own column, and email also
 * needs the row to carry an address.
 */
export function importChannelsOf(
  row: Pick<
    ParsedRow,
    | 'consent'
    | 'consentColumn'
    | 'consentSms'
    | 'consentEmail'
    | 'consentSmsColumn'
    | 'consentEmailColumn'
    | 'email'
  >,
): Array<'whatsapp' | 'sms' | 'email'> {
  const out: Array<'whatsapp' | 'sms' | 'email'> = [];
  if (!row.consentColumn || row.consent === 'granted') out.push('whatsapp');
  if (row.consentSmsColumn && row.consentSms === 'granted') out.push('sms');
  if (row.consentEmailColumn && row.consentEmail === 'granted' && row.email) out.push('email');
  return out;
}

/** The later row's non-empty cells win; groups and tags are unioned by the caller. */
function mergeRows(a: ParsedRow, b: ParsedRow): ParsedRow {
  const out: ParsedRow = { ...a };
  for (const key of [
    'name',
    'firstName',
    'lastName',
    'email',
    'countryCode',
    'language',
    'title',
    'address',
    'memo',
    'status',
    'source',
    'dateOfBirth',
  ] as const) {
    if (b[key]) (out as unknown as Record<string, unknown>)[key] = b[key];
  }
  if (b.minor) out.minor = true;
  // A later row for the same number refines the answer, except with a blank cell.
  if (b.consent) out.consent = b.consent;
  if (b.consentSms) out.consentSms = b.consentSms;
  if (b.consentEmail) out.consentEmail = b.consentEmail;
  return out;
}
