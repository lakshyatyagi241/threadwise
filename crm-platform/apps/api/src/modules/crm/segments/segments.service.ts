import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  collectConditions,
  isCompanySegmentField,
  ERROR_CODES,
  SEGMENT_COUNT_TTL_MS,
  SEGMENT_PREVIEW_SAMPLE,
  SEGMENT_RULES_VERSION,
  contactFilterToRules,
  type CreateSegmentInput,
  type InvalidCondition,
  type ContactListResponse,
  type ListContactsQuery,
  type ListSegmentsQuery,
  type PageResponse,
  type PreviewSegmentInput,
  type RecordScope,
  type SegmentSharedWithInput,
  type SegmentCountResponse,
  type SegmentFromFiltersInput,
  type SegmentGroup,
  type SegmentPreviewResponse,
  type SegmentResponse,
  type SegmentUsageQuery,
  type SegmentUsageResponse,
  type UpdateSegmentInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { contactScopeCondition } from '../contacts/contact-conditions';
import { toContactResponse } from '../contacts/contacts.mapper';
import { ContactsRepository } from '../contacts/contacts.repository';
import { ContactsService } from '../contacts/contacts.service';
import {
  compileRules,
  collectRuleRefs,
  emptyRuleRefs,
  type CompiledRules,
} from './segment-compiler';
import { countWithTimeout, segmentContactsWhere, type CountResult } from './segment-count';
import { canSee, currentSegmentAccess, type SegmentAccess } from './segment-filter';
import { loadRuleContext } from './segment-rule-context';
import { PlanUsageService } from '../../plans-subscriptions-trials';
import { SegmentThrottle } from './segment-throttle';
import { segmentsUsing } from './segment-usage';
import { toSegmentResponse, type SegmentCountView, type SegmentShareView } from './segments.mapper';
import { SegmentsRepository, type SegmentRow } from './segments.repository';

export const SEGMENT_MODULE = 'segments';

const nameTaken = (name: string, existingId: string) =>
  new AppError(
    ERROR_CODES.SEG_NAME_TAKEN,
    `A segment named "${name}" already exists.`,
    HttpStatus.CONFLICT,
    existingId ? [{ path: 'existingId', message: existingId }] : undefined,
  );

const shareError = (
  code:
    | typeof ERROR_CODES.SEG_SHARE_EMPTY
    | typeof ERROR_CODES.SEG_SHARE_USER_NOT_FOUND
    | typeof ERROR_CODES.SEG_SHARE_TEAM_NOT_FOUND,
  message: string,
  details: Array<{ path: string; message: string }>,
) => new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);

interface ShareTargets {
  userIds: number[];
  teamIds: number[];
}

/** What a save changes on the people list (ids are internal; only counts leave this file). */
interface ShareChange {
  add: ShareTargets;
  remove: ShareTargets;
  usersBefore: number;
  teamsBefore: number;
  usersAfter: number;
  teamsAfter: number;
}

/**
 * Segments: saved rules that fill themselves.
 *
 * A group is a list a person fills; a segment is a rule, so membership is never written anywhere.
 * Every member question (count, list, export, tag, add to group, a broadcast audience) is the
 * rule compiled to SQL by the same predicates the contacts list uses and run against `contacts`.
 *
 * Two promises worth knowing:
 *  - A condition that points at something deleted (a tag, group, stage, status, user, property)
 *    never fails a request: it matches nothing and is reported as `invalidConditions`.
 *  - Nothing on a request path waits on a huge count: counts are cached for five minutes and run
 *    under a 3 second statement timeout, past which `countApproximate` is true.
 */
@Injectable()
export class SegmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SegmentsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly contacts: ContactsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly throttle: SegmentThrottle,
    private readonly planUsage: PlanUsageService,
  ) {}

  // --- reads -------------------------------------------------------------------------------

  async list(query: ListSegmentsQuery): Promise<PageResponse<SegmentResponse>> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(
        tx,
        ctx.orgId,
        { userId: access.userId, manageAll: access.manageAll },
        query,
      );
      const { items, page } = buildPage(rows, query.limit);

      // One lookup of everything the page's rules point at, then each is compiled only to learn which
      // conditions are broken. The count is whatever is cached: a list never counts.
      const rc = await this.ruleContextFor(tx, ctx.orgId, items);
      const shares = await this.repo.sharesFor(
        tx,
        ctx.orgId,
        items.filter((r) => r.visibility === 'specific').map((r) => r.id),
      );
      const data: SegmentResponse[] = [];
      for (const row of items) {
        const compiled = compileRules(ctx.orgId, row.rules as unknown as SegmentGroup, rc);
        data.push(
          toSegmentResponse(
            row,
            {
              memberCount: row.memberCountCache,
              countApproximate: false,
              memberCountAt: row.memberCountAt,
            },
            compiled.invalid,
            await this.canEdit(tx, ctx.orgId, row, 'update'),
            shares.get(row.id),
          ),
        );
      }
      return { data, page };
    });
  }

  async get(uuid: string): Promise<SegmentResponse> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    return this.db.tx(async (tx) => {
      const row = await this.requireVisible(tx, ctx.orgId, uuid, access);
      const compiled = await this.compile(tx, ctx.orgId, row);
      const view = await this.countView(tx, ctx.orgId, row, compiled, { store: true });
      await this.repo.markUsed(tx, ctx.orgId, row.id);
      return toSegmentResponse(
        row,
        view,
        compiled.invalid,
        await this.canEdit(tx, ctx.orgId, row, 'update'),
        await this.sharesOf(tx, ctx.orgId, row),
      );
    });
  }

  /** The contacts in a segment: GET /contacts with `segmentId`, after making sure the segment is visible (404 otherwise). */
  async members(
    uuid: string,
    query: ListContactsQuery,
    scope: RecordScope,
  ): Promise<ContactListResponse> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    await this.db.tx((tx) => this.requireVisible(tx, ctx.orgId, uuid, access));
    return this.contacts.list({ ...query, segmentId: uuid }, scope);
  }

  // --- writes ------------------------------------------------------------------------------

  async create(input: CreateSegmentInput): Promise<SegmentResponse> {
    const ctx = RequestContextStore.require();
    // The plan's `segments` cap (live count; also covers "save this filter as a segment", which calls create).
    await this.planUsage.assertCanAdd(ctx.orgId, 'segments');
    return this.db.tx(async (tx) => {
      const rules = input.rules as unknown as SegmentGroup;
      await this.assertRulesValid(tx, ctx.orgId, rules);

      const clash = await this.repo.findByName(tx, ctx.orgId, input.name);
      if (clash) throw nameTaken(input.name, clash.uuid);

      // Checked before the insert so a bad list never leaves a half-made segment behind the 422.
      const shares =
        input.visibility === 'specific'
          ? await this.resolveShares(tx, ctx.orgId, input.sharedWith)
          : undefined;
      if (input.visibility !== 'specific' && input.sharedWith) {
        const n = input.sharedWith.userIds.length + input.sharedWith.teamIds.length;
        if (n > 0) {
          throw AppError.validation(
            'People can only be chosen when the segment is shared with specific people.',
            [{ path: 'sharedWith', message: 'Set visibility to specific first.' }],
          );
        }
      }

      const created = await this.repo.insertIfAbsent(tx, ctx.orgId, {
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        visibility: input.visibility,
        ownerId: ctx.userId,
        rules: input.rules,
        rulesVersion: SEGMENT_RULES_VERSION,
      });
      if (!created) throw nameTaken(input.name, '');
      if (shares) await this.repo.addShares(tx, ctx.orgId, created.id, shares);

      await this.audit.record(tx, {
        module: SEGMENT_MODULE,
        recordId: created.id,
        action: 'insert',
        ...(shares
          ? {
              delta: {
                sharedUsers: { old: 0, new: shares.userIds.length },
                sharedTeams: { old: 0, new: shares.teamIds.length },
              },
            }
          : {}),
      });
      await this.outbox.emit(tx, {
        aggregateModule: SEGMENT_MODULE,
        aggregateId: created.id,
        eventType: 'segment.created',
        payload: {
          uuid: created.uuid,
          name: input.name,
          visibility: input.visibility,
          sharedUsers: shares?.userIds.length ?? 0,
          sharedTeams: shares?.teamIds.length ?? 0,
        },
      });

      return this.respondAfterWrite(tx, ctx.orgId, created.id);
    });
  }

  /** "Save this filter as a segment": the contacts list filter, converted to rules and saved like any other. */
  async createFromFilters(input: SegmentFromFiltersInput): Promise<SegmentResponse> {
    const rules = contactFilterToRules(input.filter);
    if (!rules) {
      throw AppError.validation('The filter has no conditions to save as a segment.', [
        { path: 'filter', message: 'Choose at least one filter first.' },
      ]);
    }
    return this.create({
      name: input.name,
      description: input.description,
      color: input.color,
      visibility: input.visibility,
      sharedWith: input.sharedWith,
      rules,
    });
  }

  async update(uuid: string, input: UpdateSegmentInput): Promise<SegmentResponse> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    return this.db.tx(async (tx) => {
      const existing = await this.requireVisible(tx, ctx.orgId, uuid, access);
      await this.assertCanEdit(tx, ctx.orgId, existing, 'update');

      const values: Parameters<SegmentsRepository['updateWithVersion']>[4] = {};
      if (input.name !== undefined && input.name !== existing.name) values.name = input.name;
      if (input.description !== undefined && (input.description ?? null) !== existing.description) {
        values.description = input.description ?? null;
      }
      if (input.color !== undefined && (input.color ?? null) !== existing.color) {
        values.color = input.color ?? null;
      }
      if (input.visibility !== undefined && input.visibility !== existing.visibility) {
        values.visibility = input.visibility;
      }
      const shareChange = await this.planShares(
        tx,
        ctx.orgId,
        existing,
        input.visibility ?? existing.visibility,
        input.sharedWith,
      );
      const sharesChanged =
        shareChange !== undefined &&
        shareChange.add.userIds.length +
          shareChange.add.teamIds.length +
          shareChange.remove.userIds.length +
          shareChange.remove.teamIds.length >
          0;
      if (sharesChanged) values.sharesChanged = true;
      const rulesChanged =
        input.rules !== undefined && JSON.stringify(input.rules) !== JSON.stringify(existing.rules);
      if (rulesChanged) {
        await this.assertRulesValid(tx, ctx.orgId, input.rules as unknown as SegmentGroup);
        values.rules = input.rules as unknown as Record<string, unknown>;
        values.rulesVersion = SEGMENT_RULES_VERSION;
        // The cached count belongs to the old rules.
        values.memberCountCache = null;
        values.memberCountAt = null;
      }

      if (values.name !== undefined && values.name.toLowerCase() !== existing.name.toLowerCase()) {
        const clash = await this.repo.findByName(tx, ctx.orgId, values.name);
        if (clash && clash.id !== existing.id) throw nameTaken(values.name, clash.uuid);
      }

      if (Object.keys(values).length === 0) {
        // Nothing to change: still the lock's job to say the caller was working from an old copy.
        if (input.rowVersion !== existing.rowVersion) throw AppError.rowVersionConflict('Segment');
        return this.respondAfterWrite(tx, ctx.orgId, existing.id);
      }

      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.updateWithVersion(sp, ctx.orgId, existing.id, input.rowVersion, values),
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw nameTaken(values.name ?? existing.name, '');
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Segment');
      if (sharesChanged) {
        await this.repo.removeShares(tx, ctx.orgId, existing.id, shareChange.remove);
        await this.repo.addShares(tx, ctx.orgId, existing.id, shareChange.add);
      }

      const after = (await this.repo.findById(tx, ctx.orgId, existing.id))!;
      await this.audit.record(tx, {
        module: SEGMENT_MODULE,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          {
            name: existing.name,
            description: existing.description,
            color: existing.color,
            visibility: existing.visibility,
            rules: existing.rules,
            ...(sharesChanged
              ? { sharedUsers: shareChange.usersBefore, sharedTeams: shareChange.teamsBefore }
              : {}),
          },
          {
            name: after.name,
            description: after.description,
            color: after.color,
            visibility: after.visibility,
            rules: after.rules,
            ...(sharesChanged
              ? { sharedUsers: shareChange.usersAfter, sharedTeams: shareChange.teamsAfter }
              : {}),
          },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: SEGMENT_MODULE,
        aggregateId: existing.id,
        eventType: 'segment.updated',
        payload: {
          uuid,
          name: after.name,
          visibility: after.visibility,
          rulesChanged,
          sharesChanged,
          ...(sharesChanged
            ? { sharedUsers: shareChange.usersAfter, sharedTeams: shareChange.teamsAfter }
            : {}),
        },
      });

      return this.respondAfterWrite(tx, ctx.orgId, existing.id);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    await this.db.tx(async (tx) => {
      const existing = await this.requireVisible(tx, ctx.orgId, uuid, access);
      await this.assertCanEdit(tx, ctx.orgId, existing, 'delete');

      await this.audit.record(tx, {
        module: SEGMENT_MODULE,
        recordId: existing.id,
        action: 'delete',
        delta: { name: { old: existing.name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: SEGMENT_MODULE,
        aggregateId: existing.id,
        eventType: 'segment.deleted',
        payload: { uuid, name: existing.name },
      });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  // --- counting and preview ----------------------------------------------------------------

  /** Rules in, count and the first ten contacts out. Nothing is saved. */
  async preview(input: PreviewSegmentInput, scope: RecordScope): Promise<SegmentPreviewResponse> {
    const ctx = RequestContextStore.require();
    // The sample is contact data: seeing segments is not enough.
    if (!this.rbac.can(ctx.grants!, 'record.contacts.read').allowed) {
      throw AppError.forbidden('record.contacts.read');
    }
    await this.throttle.check('preview', ctx.orgId, ctx.userId);
    return this.db.tx(async (tx) => {
      const rules = input.rules as unknown as SegmentGroup;
      this.assertCompanyFieldsReadable(rules);
      const rc = await loadRuleContext(tx, ctx.orgId, collectRuleRefs(rules));
      const compiled = compileRules(ctx.orgId, rules, rc);
      const scopeSql = contactScopeCondition(ctx.orgId, scope, ctx.userId);

      const counted = await countWithTimeout(
        tx,
        segmentContactsWhere(ctx.orgId, compiled.where, scopeSql),
      );
      const rows = await this.contactsRepo.list(tx, ctx.orgId, {
        limit: SEGMENT_PREVIEW_SAMPLE,
        order: 'desc',
        filter: { includeArchived: false, tagMode: 'any', segment: compiled.where },
        scope,
        actorUserId: ctx.userId,
      });
      return {
        count: counted.count,
        countApproximate: counted.approximate,
        // Segment preview is a different screen from Contacts list/detail and out of scope for
        // the contacts.phone.reveal gate added there — unmasked, as before, pending its own pass.
        sample: rows
          .slice(0, SEGMENT_PREVIEW_SAMPLE)
          .map((r) => toContactResponse(r, { canRevealPhone: true })),
        invalidConditions: compiled.invalid,
      };
    });
  }

  /** Forces a recount (rate limited) and stores it. */
  async refreshCount(uuid: string): Promise<SegmentCountResponse> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    await this.throttle.check('refresh', ctx.orgId, ctx.userId);
    return this.db.tx(async (tx) => {
      const row = await this.requireVisible(tx, ctx.orgId, uuid, access);
      const compiled = await this.compile(tx, ctx.orgId, row);
      const counted = await countWithTimeout(tx, segmentContactsWhere(ctx.orgId, compiled.where), {
        fallback: row.memberCountCache,
      });
      const storedAt = counted.approximate
        ? null
        : await this.repo.storeCount(tx, ctx.orgId, row.id, counted.count);
      await this.repo.markUsed(tx, ctx.orgId, row.id);
      return {
        memberCount: counted.count,
        countApproximate: counted.approximate,
        memberCountAt: (storedAt ?? row.memberCountAt ?? new Date()).toISOString(),
      };
    });
  }

  // --- for other domains (broadcasts, campaigns) -------------------------------------------

  /**
   * The contacts of a segment, a page at a time, for a domain that targets one (a broadcast, a
   * campaign). Cursor is the last contact id, so pages are stable while membership moves.
   *
   * Callers authorize their own use: this does not check who may see the segment (a broadcast runs
   * as a job long after the click) and does not apply consent, so a sender must still drop opted-out
   * contacts itself. Needs a request context for the tenant (`RequestContextStore.run` in a job).
   * Conditions pointing at deleted things match nothing; `invalidConditions` says so, and a sender
   * that must not send to a half-broken audience can refuse on it.
   */
  async resolveMembers(
    segmentUuid: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<{
    members: Array<{ id: number; uuid: string }>;
    nextCursor: string | null;
    invalidConditions: InvalidCondition[];
  }> {
    const ctx = RequestContextStore.require();
    const limit = Math.min(Math.max(Math.trunc(opts.limit), 1), 5000);
    const after = opts.cursor ? Number.parseInt(opts.cursor, 10) : 0;
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid cursor', HttpStatus.BAD_REQUEST);
    }
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, segmentUuid);
      if (!row) throw AppError.notFound('Segment', segmentUuid);
      const compiled = await this.compile(tx, ctx.orgId, row);
      const where = segmentContactsWhere(ctx.orgId, compiled.where);
      const res = await tx.execute(sql`
        SELECT contacts.id, contacts.uuid FROM contacts
        WHERE ${where} AND contacts.id > ${after}::bigint
        ORDER BY contacts.id LIMIT ${limit + 1}
      `);
      const rows = res.rows as Array<{ id: number | string; uuid: string }>;
      const page = rows.slice(0, limit).map((r) => ({ id: Number(r.id), uuid: r.uuid }));
      return {
        members: page,
        nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null,
        invalidConditions: compiled.invalid,
      };
    });
  }

  /**
   * The contact ids of the segments a sender picked, inside the caller's own transaction (a campaign or broadcast
   * builds its whole audience in one). Unlike `resolveMembers` this checks the caller may see each segment: a private
   * segment of someone else reads as not found. Each segment is cut at `cap` ids; consent is the caller's business.
   */
  async memberIdsIn(
    tx: Tx,
    orgId: number,
    segmentUuids: readonly string[],
    cap = 100_000,
  ): Promise<number[]> {
    if (segmentUuids.length === 0) return [];
    const access = currentSegmentAccess();
    const ids: number[] = [];
    for (const uuid of segmentUuids) {
      const row = await this.requireVisible(tx, orgId, uuid, access);
      const compiled = await this.compile(tx, orgId, row);
      const res = await tx.execute(sql`
        SELECT contacts.id FROM contacts
        WHERE ${segmentContactsWhere(orgId, compiled.where)}
        ORDER BY contacts.id LIMIT ${cap}
      `);
      for (const r of res.rows as Array<{ id: number | string }>) ids.push(Number(r.id));
      await this.repo.markUsed(tx, orgId, row.id);
    }
    return ids;
  }

  /**
   * Whether one contact is in a segment now, for the flow condition and the segment trigger. No access check (a flow runs as the
   * workspace, long after anyone clicked); a segment that is gone, or rules that point at deleted things, read as "not in it".
   */
  async containsContactFromFlow(
    orgId: number,
    segmentUuid: string,
    contactId: number,
  ): Promise<boolean> {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, segmentUuid);
      if (!row) return false;
      const compiled = await this.compile(tx, orgId, row);
      const res = await tx.execute(sql`
        SELECT 1 FROM contacts
        WHERE ${segmentContactsWhere(orgId, compiled.where)} AND contacts.id = ${contactId}::bigint
        LIMIT 1
      `);
      return res.rows.length > 0;
    });
  }

  /** The contact ids of a segment now (at most `cap`), for a scheduled flow; no access check, a gone segment is empty. */
  async memberIdsFromFlow(orgId: number, segmentUuid: string, cap: number): Promise<number[]> {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, segmentUuid);
      if (!row) return [];
      const compiled = await this.compile(tx, orgId, row);
      const res = await tx.execute(sql`
        SELECT contacts.id FROM contacts
        WHERE ${segmentContactsWhere(orgId, compiled.where)}
        ORDER BY contacts.id LIMIT ${cap}
      `);
      return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
    });
  }

  /** How many contacts are in a segment now, with the 3 second ceiling (see countWithTimeout). */
  async countMembers(
    segmentUuid: string,
  ): Promise<CountResult & { invalidConditions: InvalidCondition[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, segmentUuid);
      if (!row) throw AppError.notFound('Segment', segmentUuid);
      const compiled = await this.compile(tx, ctx.orgId, row);
      const counted = await countWithTimeout(tx, segmentContactsWhere(ctx.orgId, compiled.where), {
        fallback: row.memberCountCache,
      });
      if (!counted.approximate) await this.repo.storeCount(tx, ctx.orgId, row.id, counted.count);
      return { ...counted, invalidConditions: compiled.invalid };
    });
  }

  // --- usage -------------------------------------------------------------------------------

  /** The segments (visible to the caller) that point at a tag, group, stage, status, property or user. */
  async usage(query: SegmentUsageQuery): Promise<SegmentUsageResponse> {
    const ctx = RequestContextStore.require();
    const access = currentSegmentAccess();
    return this.db.tx(async (tx) => {
      const rows = segmentsUsing(await this.repo.listAll(tx, ctx.orgId), query.kind, query.ref);
      return {
        data: rows.filter((r) => canSee(r, access)).map((r) => ({ id: r.uuid, name: r.name })),
      };
    });
  }

  // --- internals ---------------------------------------------------------------------------

  async compile(tx: Tx, orgId: number, row: SegmentRow): Promise<CompiledRules> {
    const rules = row.rules as unknown as SegmentGroup;
    const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
    return compileRules(orgId, rules, rc);
  }

  private async ruleContextFor(tx: Tx, orgId: number, rows: SegmentRow[]) {
    const refs = emptyRuleRefs();
    for (const row of rows) collectRuleRefs(row.rules as unknown as SegmentGroup, refs);
    return loadRuleContext(tx, orgId, refs);
  }

  /**
   * A rule on a company property reads the company of every contact it matches: the caller must be able to read companies. Checked when
   * rules are saved or previewed (a segment already saved keeps working for the senders that use it).
   */
  private assertCompanyFieldsReadable(rules: SegmentGroup): void {
    const ctx = RequestContextStore.require();
    if (!ctx.grants) return;
    const usesCompany = collectConditions(rules).some(({ condition }) =>
      isCompanySegmentField(condition.field),
    );
    if (usesCompany && !this.rbac.can(ctx.grants, 'record.companies.read').allowed) {
      throw AppError.forbidden('record.companies.read');
    }
  }

  /** A save refuses rules that point at things that do not exist now (later deletions are only flagged). */
  private async assertRulesValid(tx: Tx, orgId: number, rules: SegmentGroup): Promise<void> {
    this.assertCompanyFieldsReadable(rules);
    const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
    const { invalid } = compileRules(orgId, rules, rc);
    if (invalid.length > 0) {
      throw new AppError(
        ERROR_CODES.SEG_RULES_INVALID,
        'Some conditions cannot be used: ' + invalid.map((i) => i.message).join(' '),
        HttpStatus.UNPROCESSABLE_ENTITY,
        invalid.map((i) => ({
          path: i.path ? `rules.${i.path}` : 'rules',
          message: i.message,
        })),
      );
    }
  }

  private async requireVisible(
    tx: Tx,
    orgId: number,
    uuid: string,
    access: SegmentAccess,
  ): Promise<SegmentRow> {
    const row = await this.repo.findByUuid(tx, orgId, uuid);
    // Not visible reads exactly like not existing: a private segment's existence is not shared.
    if (!row || !canSee(row, access)) throw AppError.notFound('Segment', uuid);
    return row;
  }

  /** `update` / `delete` scope: all = any segment, team = owned by someone on a shared team, own = mine. */
  private async canEdit(
    tx: Tx,
    orgId: number,
    row: SegmentRow,
    action: 'update' | 'delete',
  ): Promise<boolean> {
    const ctx = RequestContextStore.require();
    const grant = this.rbac.can(ctx.grants!, `record.segments.${action}`);
    if (!grant.allowed) return false;
    if (grant.scope === 'all') return true;
    if (row.ownerId === null || ctx.userId === null) return false;
    if (grant.scope === 'own') return row.ownerId === ctx.userId;
    return this.contactsRepo.isOwnerInActorTeam(tx, orgId, ctx.userId, row.ownerId);
  }

  private async assertCanEdit(
    tx: Tx,
    orgId: number,
    row: SegmentRow,
    action: 'update' | 'delete',
  ): Promise<void> {
    if (!(await this.canEdit(tx, orgId, row, action))) {
      throw AppError.forbidden(`record.segments.${action}`);
    }
  }

  /**
   * The count a caller sees. A caller who sees every contact gets the workspace-wide cached count
   * (refreshed here when older than the TTL); one with an own/team contact scope gets their own live
   * count, uncached, since the cache cannot hold one number per scope. No contacts.read: no count.
   */
  private async countView(
    tx: Tx,
    orgId: number,
    row: SegmentRow,
    compiled: CompiledRules,
    opts: { store: boolean },
  ): Promise<SegmentCountView> {
    const ctx = RequestContextStore.require();
    const contacts = this.rbac.can(ctx.grants!, 'record.contacts.read');
    if (!contacts.allowed)
      return { memberCount: null, countApproximate: false, memberCountAt: null };

    if (contacts.scope !== 'all') {
      const scoped = await countWithTimeout(
        tx,
        segmentContactsWhere(
          orgId,
          compiled.where,
          contactScopeCondition(orgId, contacts.scope, ctx.userId),
        ),
      );
      return {
        memberCount: scoped.count,
        countApproximate: scoped.approximate,
        memberCountAt: new Date(),
      };
    }

    const fresh =
      row.memberCountCache !== null &&
      row.memberCountAt !== null &&
      Date.now() - row.memberCountAt.getTime() < SEGMENT_COUNT_TTL_MS;
    if (fresh) {
      return {
        memberCount: row.memberCountCache,
        countApproximate: false,
        memberCountAt: row.memberCountAt,
      };
    }
    const counted = await countWithTimeout(tx, segmentContactsWhere(orgId, compiled.where), {
      fallback: row.memberCountCache,
    });
    const storedAt =
      !counted.approximate && opts.store
        ? await this.repo.storeCount(tx, orgId, row.id, counted.count)
        : null;
    return {
      memberCount: counted.count,
      countApproximate: counted.approximate,
      memberCountAt: counted.approximate ? row.memberCountAt : (storedAt ?? new Date()),
    };
  }

  /** The response of a write: counts the new rules once (so a fresh segment shows its size) and returns the row. */
  private async respondAfterWrite(tx: Tx, orgId: number, id: number): Promise<SegmentResponse> {
    const row = (await this.repo.findById(tx, orgId, id))!;
    const compiled = await this.compile(tx, orgId, row);
    const view = await this.countView(tx, orgId, row, compiled, { store: true });
    return toSegmentResponse(
      row,
      view,
      compiled.invalid,
      await this.canEdit(tx, orgId, row, 'update'),
      await this.sharesOf(tx, orgId, row),
    );
  }

  private async sharesOf(
    tx: Tx,
    orgId: number,
    row: SegmentRow,
  ): Promise<SegmentShareView | undefined> {
    if (row.visibility !== 'specific') return undefined;
    return (await this.repo.sharesFor(tx, orgId, [row.id])).get(row.id);
  }

  /**
   * The people list a save asks for, as ids. A pick that is not in this workspace is named by position (422), never
   * silently dropped: the caller believed that person would see the segment.
   */
  private async resolveShares(
    tx: Tx,
    orgId: number,
    input: SegmentSharedWithInput | undefined,
  ): Promise<ShareTargets> {
    const userUuids = [...new Set(input?.userIds ?? [])];
    const teamUuids = [...new Set(input?.teamIds ?? [])];
    if (userUuids.length + teamUuids.length === 0) {
      throw shareError(
        ERROR_CODES.SEG_SHARE_EMPTY,
        'Choose at least one person or team to share the segment with.',
        [{ path: 'sharedWith', message: 'Choose at least one person or team.' }],
      );
    }
    const users = await this.repo.usersByUuid(tx, orgId, userUuids);
    const missingUsers = userUuids.flatMap((u, i) => (users.has(u) ? [] : [i]));
    if (missingUsers.length > 0) {
      throw shareError(
        ERROR_CODES.SEG_SHARE_USER_NOT_FOUND,
        'Some of the chosen people are not members of this workspace.',
        missingUsers.map((i) => ({
          path: `sharedWith.userIds.${i}`,
          message: 'Not a member of this workspace.',
        })),
      );
    }
    const teams = await this.repo.teamsByUuid(tx, orgId, teamUuids);
    const missingTeams = teamUuids.flatMap((u, i) => (teams.has(u) ? [] : [i]));
    if (missingTeams.length > 0) {
      throw shareError(
        ERROR_CODES.SEG_SHARE_TEAM_NOT_FOUND,
        'Some of the chosen teams do not exist in this workspace.',
        missingTeams.map((i) => ({
          path: `sharedWith.teamIds.${i}`,
          message: 'No such team in this workspace.',
        })),
      );
    }
    return {
      userIds: userUuids.map((u) => users.get(u)!),
      teamIds: teamUuids.map((u) => teams.get(u)!),
    };
  }

  /**
   * What a save does to the people list: the diff between what is stored and what the result must be (nothing for a
   * segment that is not, and stays not, `specific`; everything removed when it stops being `specific`). Throws like
   * `resolveShares` when the result must be `specific` and the list is empty or wrong.
   */
  private async planShares(
    tx: Tx,
    orgId: number,
    existing: SegmentRow,
    nextVisibility: SegmentRow['visibility'],
    input: SegmentSharedWithInput | undefined,
  ): Promise<ShareChange | undefined> {
    const none: ShareTargets = { userIds: [], teamIds: [] };
    if (nextVisibility !== 'specific') {
      if ((input?.userIds.length ?? 0) + (input?.teamIds.length ?? 0) > 0) {
        throw AppError.validation(
          'People can only be chosen when the segment is shared with specific people.',
          [{ path: 'sharedWith', message: 'Set visibility to specific first.' }],
        );
      }
      if (existing.visibility !== 'specific') return undefined;
      const current = await this.repo.shareTargets(tx, orgId, existing.id);
      return {
        add: none,
        remove: current,
        usersBefore: current.userIds.length,
        teamsBefore: current.teamIds.length,
        usersAfter: 0,
        teamsAfter: 0,
      };
    }
    // Becoming `specific` needs a list; staying `specific` keeps the list unless a new one is sent.
    if (input === undefined && existing.visibility === 'specific') return undefined;
    const wanted = await this.resolveShares(tx, orgId, input);
    const current =
      existing.visibility === 'specific'
        ? await this.repo.shareTargets(tx, orgId, existing.id)
        : none;
    const diff = (a: number[], b: number[]) => a.filter((x) => !b.includes(x));
    return {
      add: {
        userIds: diff(wanted.userIds, current.userIds),
        teamIds: diff(wanted.teamIds, current.teamIds),
      },
      remove: {
        userIds: diff(current.userIds, wanted.userIds),
        teamIds: diff(current.teamIds, wanted.teamIds),
      },
      usersBefore: current.userIds.length,
      teamsBefore: current.teamIds.length,
      usersAfter: wanted.userIds.length,
      teamsAfter: wanted.teamIds.length,
    };
  }
}
