import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  mergeFollowUpSettings,
  mergeUncontactedSettings,
  type ContactTouchChannel,
  type RecordScope,
  type TouchContactResponse,
  type UncontactedCause,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { assertContactScope } from '../contacts/contact-scope';
import { ContactsRepository } from '../contacts/contacts.repository';
import { FollowUpService } from './follow-up.service';
import { LeadHandlingSettingsService } from './lead-handling-settings.service';
import { clearsOn, marksNew, type CreateMethod, type TouchSource } from './lead-handling-rules';

const { contacts } = schema;
const MODULE_KEY = 'contacts';

/**
 * The one place that applies the lead handling settings to a contact (docs/specs/lead-followup-settings.md, section 3). Every action
 * that "contacts" a person calls `touch`, every creation path `markNew`, every owner change `afterReassign`.
 *
 * The hooks run inside the caller's transaction, in a savepoint, and never throw: a failure here (a settings row that cannot be read, a
 * constraint) is logged and rolled back to the savepoint, because it must never fail a message, a call log or a contact create. They
 * work with or without a request context (a worker has none): audit and outbox rows then name the workspace's system actor.
 *
 * Nothing here changes data unless the workspace turned something on or a person marked a contact by hand, so with the defaults a
 * hook costs one primary-key read and one update that matches no row.
 */
@Injectable()
export class ContactTouchService {
  private readonly logger = new Logger(ContactTouchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: LeadHandlingSettingsService,
    private readonly contactsRepo: ContactsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly followUps: FollowUpService,
  ) {}

  // --- hooks (called by other modules; never throw) -----------------------------------------------------------------------------

  /** A person or an automation reached the contact: clear the uncontacted marker when the workspace says this kind of touch counts. */
  async touch(
    tx: Tx,
    orgId: number,
    contactId: number,
    source: TouchSource,
    /** The person who reached out, when the caller knows (a worker has no request user): the follow-up's fallback assignee. */
    actorUserId?: number | null,
  ): Promise<void> {
    // The timeline is the team's own: a note or an activity written by a key or a system actor is not a person reaching out.
    if (source === 'activity' && RequestContextStore.peek()?.actorType !== 'user') return;
    await this.guarded(tx, orgId, 'touch', async (sp) => {
      const rows = await this.settings.readIn(sp, orgId, ['uncontacted', 'follow_ups']);
      const s = mergeUncontactedSettings(rows.get('uncontacted')?.config);
      if (clearsOn(s, source)) await this.clearIn(sp, orgId, contactId, source);
      // The same touch may move the contact's next follow-up (BL-291): a no-op unless the workspace switched a situation on.
      await this.followUps.applyAfterTouch(
        sp,
        orgId,
        contactId,
        mergeFollowUpSettings(rows.get('follow_ups')?.config),
        actorUserId ?? RequestContextStore.peek()?.userId ?? null,
      );
    });
  }

  /** A contact was just created this way: start it uncontacted when the workspace says so. */
  async markNew(tx: Tx, orgId: number, contactId: number, method: CreateMethod): Promise<void> {
    await this.guarded(tx, orgId, 'markNew', async (sp) => {
      const s = await this.settings.uncontactedIn(sp, orgId);
      if (marksNew(s, method)) await this.setSinceIn(sp, orgId, [contactId]);
    });
  }

  /** The same for several contacts created in one statement (an import). */
  async markNewMany(
    tx: Tx,
    orgId: number,
    contactIds: number[],
    method: CreateMethod,
  ): Promise<void> {
    if (contactIds.length === 0) return;
    await this.guarded(tx, orgId, 'markNewMany', async (sp) => {
      const s = await this.settings.uncontactedIn(sp, orgId);
      if (marksNew(s, method)) await this.setSinceIn(sp, orgId, contactIds);
    });
  }

  /** The contacts just got a new owner (not a restore after leave): mark them uncontacted when the workspace says so. */
  async afterReassign(tx: Tx, orgId: number, contactIds: number[]): Promise<void> {
    if (contactIds.length === 0) return;
    await this.guarded(tx, orgId, 'afterReassign', async (sp) => {
      const s = await this.settings.uncontactedIn(sp, orgId);
      if (s.onReassign === 'mark') await this.setSinceIn(sp, orgId, contactIds);
    });
  }

  /** For a set-based writer that folds the marking into its own statement: does this workspace mark on reassign? Never throws. */
  async marksOnReassign(tx: Tx, orgId: number): Promise<boolean> {
    try {
      return await tx.transaction(
        async (sp) => (await this.settings.uncontactedIn(sp as Tx, orgId)).onReassign === 'mark',
      );
    } catch (err) {
      this.logger.warn({ err, orgId }, 'lead handling settings could not be read');
      return false;
    }
  }

  // --- the API (a person acts) ---------------------------------------------------------------------------------------------------

  /** `POST /contacts/:id/touch`: the person pressed Call, SMS, E-mail or WhatsApp on a contact. */
  async touchByUuid(
    uuid: string,
    _channel: ContactTouchChannel,
    scope: RecordScope,
  ): Promise<TouchContactResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, uuid);
      if (!ref) throw AppError.notFound('Contact', uuid);
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, ref.ownerId);
      await this.touch(tx, ctx.orgId, ref.id, 'contact_button');
      return { uncontacted: await this.isUncontacted(tx, ctx.orgId, ref.id) };
    });
  }

  /** `PUT /contacts/:id/uncontacted`: mark by hand. Setting the state a contact is already in changes nothing (no audit row, no event). */
  async setByUuid(
    uuid: string,
    uncontacted: boolean,
    scope: RecordScope,
  ): Promise<TouchContactResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const ref = await this.contactsRepo.resolveContactRef(tx, ctx.orgId, uuid);
      if (!ref) throw AppError.notFound('Contact', uuid);
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, ref.ownerId);
      if (uncontacted) await this.markManualIn(tx, ctx.orgId, ref.id);
      else await this.clearIn(tx, ctx.orgId, ref.id, 'manual');
      return { uncontacted: await this.isUncontacted(tx, ctx.orgId, ref.id) };
    });
  }

  // --- statements ----------------------------------------------------------------------------------------------------------------

  private async isUncontacted(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const rows = await tx
      .select({ since: contacts.uncontactedSince })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)));
    return rows[0]?.since != null;
  }

  /** Clears the marker; writes the audit row and the event only when it really was set. */
  private async clearIn(
    tx: Tx,
    orgId: number,
    contactId: number,
    cause: UncontactedCause,
  ): Promise<void> {
    const rows = await tx
      .select({ uuid: contacts.uuid, since: contacts.uncontactedSince })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)))
      .for('update');
    const row = rows[0];
    if (!row || row.since === null) return;
    await tx
      .update(contacts)
      .set({ uncontactedSince: null })
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)));
    await this.inContext(orgId, () =>
      this.record(tx, orgId, contactId, row.uuid, row.since, null, cause),
    );
  }

  private async markManualIn(tx: Tx, orgId: number, contactId: number): Promise<void> {
    const rows = await tx
      .select({ uuid: contacts.uuid, since: contacts.uncontactedSince })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)))
      .for('update');
    const row = rows[0];
    if (!row || row.since !== null) return;
    const now = new Date();
    await tx
      .update(contacts)
      .set({ uncontactedSince: now })
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)));
    await this.inContext(orgId, () =>
      this.record(tx, orgId, contactId, row.uuid, null, now, 'manual'),
    );
  }

  /** Marks contacts that are not yet marked. No audit or event per contact: the creation or the owner change that caused it is the record. */
  private async setSinceIn(tx: Tx, orgId: number, ids: number[]): Promise<void> {
    await tx
      .update(contacts)
      .set({ uncontactedSince: sql`now()` })
      .where(
        and(
          eq(contacts.orgId, orgId),
          ids.length === 1 ? eq(contacts.id, ids[0]!) : inArray(contacts.id, ids),
          isNull(contacts.uncontactedSince),
        ),
      );
  }

  private async record(
    tx: Tx,
    orgId: number,
    contactId: number,
    uuid: string,
    was: Date | null,
    now: Date | null,
    cause: UncontactedCause,
  ): Promise<void> {
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: contactId,
      action: 'update',
      delta: {
        uncontactedSince: { old: was?.toISOString() ?? null, new: now?.toISOString() ?? null },
        cause: { old: null, new: cause },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: contactId,
      eventType: 'contact.uncontacted_changed',
      orgId,
      payload: { uuid, uncontacted: now !== null, cause },
    });
  }

  // --- plumbing ------------------------------------------------------------------------------------------------------------------

  /** Runs `body` in a savepoint; any failure is logged and undone, never thrown. */
  private async guarded(
    tx: Tx,
    orgId: number,
    what: string,
    body: (sp: Tx) => Promise<void>,
  ): Promise<void> {
    try {
      await tx.transaction(async (sp) => this.inContext(orgId, () => body(sp as Tx)));
    } catch (err) {
      this.logger.warn(
        { err, orgId, what },
        'lead handling hook failed; the action it belongs to is unaffected',
      );
    }
  }

  /** Audit and outbox need a request context: a request keeps its own, a worker gets its workspace's system actor. */
  private inContext<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    const current = RequestContextStore.peek();
    if (current && current.orgId === orgId) return fn();
    return RequestContextStore.run(
      {
        requestId: `lead-handling-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
