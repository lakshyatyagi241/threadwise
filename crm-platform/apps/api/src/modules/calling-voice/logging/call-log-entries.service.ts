import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CallLogEntry,
  type CallNudge,
  type LogCallInput,
  type LogCallResult,
  type UpdateCallLogEntryInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService, type GrantSet } from '../../../kernel/rbac/rbac.service';
import {
  assertContactScope,
  ContactActivitiesRepository,
  ContactResolverService,
  ContactsRepository,
  ContactTouchService,
  TasksService,
  callReachedContact,
} from '../../crm';
import {
  activityTypeOf,
  checkStartedAt,
  defaultStartedAt,
  e164Of,
  editVerdict,
  notesPreview,
  stageNudge,
  timelineTitle,
} from './call-logging.rules';
import {
  CallLogEntriesRepository,
  type EntryRow,
  type NewEntry,
} from './call-log-entries.repository';
import { CallLoggingSettingsService } from './call-logging-settings.service';

const MODULE = 'call_log_entries';
const TASK_TITLE_MAX = 200;

const problem = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status: HttpStatus,
  details?: Array<{ path: string; message: string }>,
) => new AppError(ERROR_CODES[code], message, status, details);

export const entryNotFound = () =>
  problem('CALL_LOG_ENTRY_NOT_FOUND', 'Call not found', HttpStatus.NOT_FOUND);

export const contactRequired = (path: string, message: string) =>
  problem(
    'CALL_LOG_CONTACT_REQUIRED',
    'A call needs a contact, or a phone number that can be read as one.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path, message }],
  );

export const timeInvalid = (why: 'future' | 'too_old') =>
  problem(
    'CALL_LOG_TIME_INVALID',
    why === 'future'
      ? 'A call cannot start in the future.'
      : 'That call is too long ago to be logged.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'startedAt', message: why }],
  );

/** Runs `fn` as the system actor of a workspace when no request of that workspace is in progress (a worker): audit and outbox need a context. */
export function runAsSystem<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
  const current = RequestContextStore.peek();
  if (current && current.orgId === orgId) return fn();
  return RequestContextStore.run(
    {
      requestId: `calllog-${randomUUID()}`,
      orgId,
      actorType: 'system',
      actorId: null,
      userId: null,
    },
    fn,
  );
}

/** What a writer decided about a call; the shared write turns it into a row, a timeline line, an audit row and an event. */
export type EntryDraft = NewEntry & { activitySource: 'user' | 'system' };

/**
 * The call log entries (the calls that are not WhatsApp calls). One write path - `write` - serves every source (a person's form, the
 * phone app, a provider's callback, a click-to-call that finished), so a call is recorded the same way whatever told us about it:
 *
 *   row (idempotent on source + external id) -> a line on the contact's timeline -> audit -> `call.logged`, in one transaction.
 *
 * Logging records a FACT. No consent rule refuses it (the Do-Not-Call list and a withdrawal govern placing a marketing call, in the
 * click-to-call); what the framework stores about the call (notes, a recording reference) follows its own privacy rules.
 */
@Injectable()
export class CallLogEntriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallLogEntriesRepository,
    private readonly contacts: ContactsRepository,
    private readonly activities: ContactActivitiesRepository,
    private readonly tasks: TasksService,
    private readonly resolver: ContactResolverService,
    private readonly settings: CallLoggingSettingsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly leadHandling: ContactTouchService,
  ) {}

  // --- the one write -------------------------------------------------------------------------------------------------------------

  /**
   * Records one call. Returns the row and whether it was new: a source's own id (a redelivered callback, a re-sent batch, a double
   * click) lands once, and the second time answers the first row untouched.
   */
  async write(
    tx: Tx,
    orgId: number,
    d: EntryDraft,
  ): Promise<{ entry: EntryRow; created: boolean }> {
    const inserted = await this.repo.insert(tx, orgId, d);
    if (!inserted) {
      const first = d.externalId
        ? await this.repo.byExternal(tx, orgId, d.source, d.externalId)
        : undefined;
      if (!first) throw new Error('call log entry conflicted but cannot be read');
      return { entry: first, created: false };
    }

    let activityId: number | null = null;
    if (d.contactId !== null) {
      const handlerName =
        d.handlerUserId === null ? null : await this.repo.userName(tx, orgId, d.handlerUserId);
      const line = await this.activities.insert(tx, orgId, {
        contactId: d.contactId,
        activityType: activityTypeOf(d.source),
        title: timelineTitle({
          direction: d.direction,
          outcome: d.outcome,
          durationSec: d.durationSec,
          handlerName,
        }),
        body: notesPreview(d.notes, 200),
        source: d.activitySource,
        actorId: d.handlerUserId ?? d.createdBy,
        occurredAt: d.startedAt,
      });
      activityId = line.id;
      await this.contacts.bumpLastActivity(tx, orgId, d.contactId);
      await this.repo.link(tx, orgId, inserted.id, { activityId });
      // A call a person placed or answered reached the contact: lead handling (the uncontacted marker, BL-290). Never throws.
      if (callReachedContact(d)) await this.leadHandling.touch(tx, orgId, d.contactId, 'contact_button');
    }

    // The trail names the facts, never the words: the notes and the number stay out of the audit row and the event.
    await this.audit.record(tx, {
      module: MODULE,
      recordId: inserted.id,
      action: 'insert',
      delta: {
        source: { old: null, new: d.source },
        direction: { old: null, new: d.direction },
        outcome: { old: null, new: d.outcome },
        durationSec: { old: null, new: d.durationSec },
        hasNotes: { old: null, new: d.notes !== null },
      },
    });
    const entry = (await this.repo.byId(tx, orgId, inserted.id))!;
    await this.outbox.emit(tx, {
      aggregateModule: MODULE,
      aggregateId: inserted.id,
      eventType: 'call.logged',
      orgId,
      payload: {
        uuid: entry.uuid,
        source: entry.source,
        direction: entry.direction,
        outcome: entry.outcome,
        durationSec: entry.durationSec,
        contactId: entry.contactUuid,
        handlerId: entry.handlerUuid,
      },
    });
    return { entry, created: true };
  }

  // --- "Log a call" ----------------------------------------------------------------------------------------------------------------

  async log(input: LogCallInput): Promise<LogCallResult> {
    const ctx = RequestContextStore.require();
    const now = new Date();
    const startedAt = input.startedAt
      ? new Date(input.startedAt)
      : defaultStartedAt(input.durationSec, now);
    const timeVerdict = checkStartedAt(startedAt, now);
    if (timeVerdict !== 'ok') throw timeInvalid(timeVerdict);
    const defaultCc = await this.resolver.defaultCountryCode();
    const typedPhone = input.customerPhone ? e164Of(input.customerPhone, defaultCc) : null;
    if (input.customerPhone && !typedPhone) {
      throw contactRequired('customerPhone', 'That is not a phone number.');
    }
    const ourPhone = input.ourPhone ? e164Of(input.ourPhone, defaultCc) : null;
    if (input.ourPhone && !ourPhone) {
      throw contactRequired('ourPhone', 'That is not a phone number.');
    }
    if (input.followUp && !this.rbac.can(ctx.grants!, 'record.tasks.create').allowed) {
      throw AppError.forbidden('record.tasks.create');
    }

    return this.db.tx(async (tx) => {
      const found = await this.contactFor(tx, ctx.orgId, ctx.userId, ctx.grants!, {
        contactUuid: input.contactId,
        phone: typedPhone,
      });
      if (!found.contact && !typedPhone) {
        throw contactRequired('contactId', 'Give the contact or the phone number.');
      }
      if (input.followUp && !found.contact) {
        throw problem(
          'CALL_LOG_FOLLOW_UP_NEEDS_CONTACT',
          'A follow-up task needs a contact to attach to.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'followUp', message: 'The call has no contact.' }],
        );
      }
      const customerPhone =
        typedPhone ??
        (found.contact
          ? e164Of(await this.repo.contactPhone(tx, ctx.orgId, found.contact.id), defaultCc)
          : null);

      const { entry, created } = await this.write(tx, ctx.orgId, {
        source: input.source,
        direction: input.direction,
        outcome: input.outcome,
        startedAt,
        durationSec: input.durationSec,
        contactId: found.contact?.id ?? null,
        customerPhone,
        ourPhone,
        numberLabel: input.numberLabel ?? null,
        handlerUserId: ctx.userId,
        notes: input.notes ?? null,
        externalId: input.externalId ?? null,
        telephonyConnectionId: null,
        recording: null,
        createdBy: ctx.userId,
        activitySource: 'user',
      });

      let followUpTaskId = entry.followUpTaskUuid;
      if (created && input.followUp && found.contact) {
        const task = await this.tasks.createIn(
          tx,
          {
            title: (
              input.followUp.title ??
              `Follow up on the call with ${entry.contactName ?? 'the contact'}`
            ).slice(0, TASK_TITLE_MAX),
            dueAt: input.followUp.dueAt,
            assigneeId: input.followUp.assigneeId,
            contactId: found.contact.uuid,
          },
          'manual',
        );
        const taskId = await this.repo.taskId(tx, ctx.orgId, task.id);
        await this.repo.link(tx, ctx.orgId, entry.id, { followUpTaskId: taskId });
        followUpTaskId = task.id;
      }

      const nudges: CallNudge[] = [];
      if (created && input.suggestStageNudge && found.contact) {
        const nudge = await this.nudgeFor(tx, ctx.orgId, found.contact.id, input.outcome);
        if (nudge) nudges.push(nudge);
      }

      const fresh = (await this.repo.byId(tx, ctx.orgId, entry.id))!;
      return {
        entry: this.respond(
          fresh,
          ctx.userId,
          this.rbac.can(ctx.grants!, 'call.logging.manage').allowed,
          await this.windowHours(tx, ctx.orgId),
        ),
        created,
        matchedByPhone: found.matchedByPhone,
        followUpTaskId,
        nudges,
      };
    });
  }

  // --- edit and delete -------------------------------------------------------------------------------------------------------------

  async update(uuid: string, input: UpdateCallLogEntryInput): Promise<CallLogEntry> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const { row, canManage, windowHours } = await this.editable(tx, ctx, uuid);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Call');
      const now = new Date();
      let startedAt: Date | undefined;
      if (input.startedAt !== undefined) {
        startedAt = new Date(input.startedAt);
        const verdict = checkStartedAt(startedAt, now);
        if (verdict !== 'ok') throw timeInvalid(verdict);
      }
      const notes =
        input.notes === undefined
          ? undefined
          : input.notes === null || input.notes === ''
            ? null
            : input.notes;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.outcome !== undefined && input.outcome !== row.outcome) {
        delta.outcome = { old: row.outcome, new: input.outcome };
      }
      if (input.direction !== undefined && input.direction !== row.direction) {
        delta.direction = { old: row.direction, new: input.direction };
      }
      if (input.durationSec !== undefined && input.durationSec !== row.durationSec) {
        delta.durationSec = { old: row.durationSec, new: input.durationSec };
      }
      if (startedAt && startedAt.getTime() !== row.startedAt.getTime()) {
        delta.startedAt = { old: row.startedAt.toISOString(), new: startedAt.toISOString() };
      }
      if (notes !== undefined && notes !== row.notes) {
        delta.hasNotes = { old: row.notes !== null, new: notes !== null };
      }
      if (Object.keys(delta).length === 0) {
        return this.respond(row, ctx.userId, canManage, windowHours);
      }
      const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, {
        outcome: input.outcome,
        direction: input.direction,
        startedAt,
        durationSec: input.durationSec,
        notes,
      });
      if (!ok) throw AppError.rowVersionConflict('Call');
      const fresh = (await this.repo.byId(tx, ctx.orgId, row.id))!;
      if (fresh.activityId !== null) {
        await this.activities.rewrite(tx, ctx.orgId, fresh.activityId, {
          title: timelineTitle({
            direction: fresh.direction,
            outcome: fresh.outcome,
            durationSec: fresh.durationSec,
            handlerName: fresh.handlerName,
          }),
          body: notesPreview(fresh.notes, 200),
          occurredAt: fresh.startedAt,
        });
      }
      await this.audit.record(tx, { module: MODULE, recordId: row.id, action: 'update', delta });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'call.log.updated',
        payload: { uuid: fresh.uuid, outcome: fresh.outcome, durationSec: fresh.durationSec },
      });
      return this.respond(fresh, ctx.userId, canManage, windowHours);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const { row } = await this.editable(tx, ctx, uuid);
      // The line on the timeline goes with the call. A follow-up task is its own record and stays.
      if (row.activityId !== null) await this.activities.remove(tx, ctx.orgId, row.activityId);
      await this.repo.remove(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: MODULE,
        recordId: row.id,
        action: 'delete',
        delta: {
          source: { old: row.source, new: null },
          outcome: { old: row.outcome, new: null },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE,
        aggregateId: row.id,
        eventType: 'call.log.deleted',
        payload: { uuid: row.uuid, contactId: row.contactUuid },
      });
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------------------------

  /** The entry under a lock, when the caller may change it; the answer says why not otherwise (404 for an entry that is not theirs). */
  private async editable(
    tx: Tx,
    ctx: ReturnType<typeof RequestContextStore.require>,
    uuid: string,
  ) {
    const row = await this.repo.byUuid(tx, ctx.orgId, uuid, true);
    if (!row) throw entryNotFound();
    const canManage = this.rbac.can(ctx.grants!, 'call.logging.manage').allowed;
    const windowHours = await this.windowHours(tx, ctx.orgId);
    const verdict = editVerdict({
      source: row.source,
      reported: row.viaConnection,
      createdById: row.createdBy,
      createdAt: row.createdAt,
      viewerId: ctx.userId,
      canManage,
      windowHours,
    });
    if (verdict === 'not_found') throw entryNotFound();
    if (verdict === 'not_editable') {
      throw problem(
        'CALL_LOG_NOT_EDITABLE',
        'This call was reported by a phone or a telephony provider and cannot be changed.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (verdict === 'window_closed') {
      throw problem(
        'CALL_LOG_EDIT_WINDOW_CLOSED',
        `A logged call can be changed for ${windowHours} hours after it was logged.`,
        HttpStatus.FORBIDDEN,
      );
    }
    return { row, canManage, windowHours };
  }

  private async windowHours(tx: Tx, orgId: number): Promise<number> {
    return (await this.settings.readIn(tx, orgId)).editWindowHours;
  }

  /**
   * The contact a call belongs to: the one named (which the person must be allowed to read), else the one that owns the phone - but only
   * among the contacts the person may read, so a number cannot be used to discover a contact they cannot see (the call is then logged by
   * its number alone).
   */
  async contactFor(
    tx: Tx,
    orgId: number,
    userId: number | null,
    grants: GrantSet,
    by: { contactUuid?: string; phone: string | null },
  ): Promise<{
    contact: { id: number; uuid: string; ownerId: number | null } | null;
    matchedByPhone: boolean;
    /** A contact owns the number but the person may not read it: the call is logged by its number alone and no contact is made. */
    hidden: boolean;
  }> {
    const read = this.rbac.can(grants, 'record.contacts.read');
    if (by.contactUuid) {
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      const ref = await this.contacts.resolveContactRef(tx, orgId, by.contactUuid);
      if (!ref) throw AppError.notFound('Contact', by.contactUuid);
      await assertContactScope(tx, this.contacts, orgId, read.scope, userId!, ref.ownerId);
      return {
        contact: { id: ref.id, uuid: by.contactUuid, ownerId: ref.ownerId },
        matchedByPhone: false,
        hidden: false,
      };
    }
    if (!by.phone) return { contact: null, matchedByPhone: false, hidden: false };
    const hit = await this.repo.contactByPhone(tx, orgId, by.phone, by.phone.slice(1));
    if (!hit) return { contact: null, matchedByPhone: false, hidden: false };
    if (!read.allowed) return { contact: null, matchedByPhone: false, hidden: true };
    try {
      await assertContactScope(tx, this.contacts, orgId, read.scope, userId!, hit.ownerId);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.NOT_FOUND) {
        return { contact: null, matchedByPhone: false, hidden: true };
      }
      throw err;
    }
    return { contact: hit, matchedByPhone: true, hidden: false };
  }

  private async nudgeFor(
    tx: Tx,
    orgId: number,
    contactId: number,
    outcome: LogCallInput['outcome'],
  ) {
    const current = await this.repo.contactStage(tx, orgId, contactId);
    if (!current) return null;
    return stageNudge(outcome, current, await this.repo.lifecycleStages(tx, orgId));
  }

  /** The API shape of an entry for this viewer. */
  respond(
    r: EntryRow,
    viewerId: number | null,
    canManage: boolean,
    windowHours: number,
    now: Date = new Date(),
  ): CallLogEntry {
    return {
      id: r.uuid,
      source: r.source,
      direction: r.direction,
      outcome: r.outcome,
      startedAt: r.startedAt.toISOString(),
      durationSec: r.durationSec,
      contactId: r.contactUuid,
      contactName: r.contactName,
      customerPhone: r.customerPhone,
      ourPhone: r.ourPhone,
      numberLabel: r.numberLabel,
      handlerId: r.handlerUuid,
      handlerName: r.handlerName,
      notes: r.notes,
      hasRecordingRef: r.hasRecordingRef,
      followUpTaskId: r.followUpTaskUuid,
      createdById: r.createdByUuid,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      rowVersion: r.rowVersion,
      editable:
        editVerdict({
          source: r.source,
          reported: r.viaConnection,
          createdById: r.createdBy,
          createdAt: r.createdAt,
          viewerId,
          canManage,
          windowHours,
          now,
        }) === 'allowed',
    };
  }
}
