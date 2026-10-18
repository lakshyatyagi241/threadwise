import { Injectable } from '@nestjs/common';
import type { RecordScope, FollowUpResult, FollowUpSettingsValues, NextFollowUp } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope } from '../contacts/contact-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { TasksService, type OpenFollowUp } from '../tasks/tasks.service';
import {
  dayEndOf,
  followUpState,
  plannedFollowUp,
  snoozedTo,
  updatesWhen,
} from './follow-up-rules';
import { LeadHandlingSettingsService } from './lead-handling-settings.service';

const toNext = (f: OpenFollowUp | undefined): NextFollowUp | null =>
  f ? { id: f.uuid, dueAt: f.dueAt?.toISOString() ?? null, assigneeId: f.assigneeUuid } : null;

const anyOn = (s: FollowUpSettingsValues): boolean => Object.values(s.updateWhen).some(Boolean);

/**
 * A contact's next follow-up (BL-291, docs/specs/lead-followup-settings.md): the one open task of kind `follow_up` linked to the contact.
 * Two callers: the lead handling hooks (`applyAfterTouch`, when the workspace asked for follow-ups to follow contact) and a person
 * (`set`, `snooze`, `done`, `clear`). Both go through the tasks module, so audit, events, reminders and notifications are the tasks'.
 */
@Injectable()
export class FollowUpService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: LeadHandlingSettingsService,
    private readonly tasks: TasksService,
    private readonly contactsRepo: ContactsRepository,
    private readonly rbac: RbacService,
  ) {}

  // --- the rule: a touch moves the follow-up (never throws to the caller: the touch service guards it) -------------------------

  /**
   * After a contact action: when the follow-up is in a state the workspace updates, put it where the default date and alert time say.
   * Idempotent: the date is a calendar day plus a time, so a redelivered touch computes the same instant and writes nothing.
   */
  async applyAfterTouch(
    tx: Tx,
    orgId: number,
    contactId: number,
    cfg: FollowUpSettingsValues,
    actorUserId: number | null,
  ): Promise<void> {
    if (!anyOn(cfg)) return;
    const now = new Date();
    const tz = await this.tasks.workspaceZone(tx, orgId);
    const open = await this.tasks.openFollowUp(tx, orgId, contactId);
    const state = followUpState(open === undefined ? undefined : open.dueAt, now, dayEndOf(now, tz));
    if (!updatesWhen(cfg, state)) return;
    const plan = plannedFollowUp(cfg, now, tz);
    if (plan.kind === 'none') {
      if (open) await this.tasks.completeFollowUpIn(tx, orgId, contactId);
      return;
    }
    const due = plan.kind === 'date' ? plan.at : null;
    if (open && (open.dueAt?.getTime() ?? null) === (due?.getTime() ?? null)) return;
    const ref = await this.contactsRepo.findById(tx, orgId, contactId);
    if (!ref) return;
    await this.tasks.setFollowUpIn(tx, orgId, {
      contactId,
      dueAt: due,
      // An existing follow-up keeps its person; a new one belongs to the contact's owner, else to whoever made the contact.
      assigneeId: open ? open.assigneeId : (ref.ownerId ?? actorUserId),
      source: 'auto',
    });
  }

  // --- by hand -------------------------------------------------------------------------------------------------------------------

  /** `PUT /contacts/:id/follow-up`: set or move the next follow-up; `dueAt: null` makes it "someday". */
  async set(uuid: string, dueAt: string | null, scope: RecordScope): Promise<FollowUpResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactRef(tx, uuid, scope);
      const open = await this.tasks.openFollowUp(tx, ctx.orgId, ref.id);
      // A new follow-up is a new task: whoever makes it needs the right to create tasks (moving an existing one does not).
      if (!open && !this.rbac.can(ctx.grants!, 'record.tasks.create').allowed) {
        throw AppError.forbidden('record.tasks.create');
      }
      const row = await this.tasks.setFollowUpIn(tx, ctx.orgId, {
        contactId: ref.id,
        dueAt: dueAt ? new Date(dueAt) : null,
        assigneeId: open ? open.assigneeId : (ref.ownerId ?? ctx.userId),
        source: 'manual',
      });
      return { nextFollowUp: toNext(row) };
    });
  }

  /** `POST /contacts/:id/follow-up/snooze`: the preset's day at the workspace's default alert time. */
  async snooze(
    uuid: string,
    preset: 'day' | 'three_days' | 'week',
    scope: RecordScope,
  ): Promise<FollowUpResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactRef(tx, uuid, scope);
      const open = await this.tasks.openFollowUp(tx, ctx.orgId, ref.id);
      if (!open) throw AppError.notFound('Follow-up');
      const rows = await this.settings.readIn(tx, ctx.orgId, ['follow_ups']);
      const cfg = this.settings.followUpsOf(rows.get('follow_ups')?.config);
      const tz = await this.tasks.workspaceZone(tx, ctx.orgId);
      const at = snoozedTo(preset, cfg.defaultTime, new Date(), tz);
      const row = await this.tasks.setFollowUpIn(tx, ctx.orgId, {
        contactId: ref.id,
        dueAt: at,
        assigneeId: open.assigneeId,
        source: 'manual',
      });
      return { nextFollowUp: toNext(row) };
    });
  }

  /** `POST /contacts/:id/follow-up/done`: the follow-up is completed; the contact has none until a new one is set. */
  async done(uuid: string, scope: RecordScope): Promise<FollowUpResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactRef(tx, uuid, scope);
      await this.tasks.completeFollowUpIn(tx, ctx.orgId, ref.id);
      return { nextFollowUp: null };
    });
  }

  /** `DELETE /contacts/:id/follow-up`: removes it. */
  async clear(uuid: string, scope: RecordScope): Promise<FollowUpResult> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactRef(tx, uuid, scope);
      await this.tasks.deleteFollowUpIn(tx, ctx.orgId, ref.id);
      return { nextFollowUp: null };
    });
  }

  private async contactRef(tx: Tx, uuid: string, scope: RecordScope) {
    const ctx = RequestContextStore.require();
    const ref = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, uuid);
    if (!ref) throw AppError.notFound('Contact', uuid);
    await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, ref.ownerId);
    return ref;
  }
}

