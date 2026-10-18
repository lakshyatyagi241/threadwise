import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type ContactMeetingResponse,
  type CreateContactMeetingInput,
  type ListContactMeetingsQuery,
  type PageResponse,
  type UpdateContactMeetingInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
import { toContactMeetingResponse } from './contact-meetings.mapper';
import {
  ContactMeetingsRepository,
  type ContactMeetingListRow,
  type ContactMeetingRow,
} from './contact-meetings.repository';

const MODULE_KEY = 'contact_meetings';

@Injectable()
export class ContactMeetingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactMeetingsRepository,
    private readonly contactsRepo: ContactsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactMeetingsQuery,
  ): Promise<PageResponse<ContactMeetingResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const rows = await this.repo.listByContact(tx, ctx.orgId, contact.id, {
        limit: query.limit,
        cursor: query.cursor,
        when: query.when,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      // A `when` list pages by its own start (the cursor holds it); the original list keeps its (created_at, id) cursor.
      const page = query.when
        ? {
            nextCursor:
              hasMore && last ? this.repo.windowCursorOf(last as ContactMeetingListRow) : null,
            hasMore,
            limit: query.limit,
          }
        : buildPage(rows, query.limit).page;
      const canManage = await this.bookingManager(tx, ctx.orgId, items);
      return { data: items.map((row) => toContactMeetingResponse(row, canManage(row))), page };
    });
  }

  async create(
    contactUuid: string,
    input: CreateContactMeetingInput,
  ): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        contact.ownerId,
      );
      const contactId = contact.id;

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        title: input.title,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        location: input.location,
        createdBy: ctx.userId,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_meeting.created',
        // `source` and `appointmentId` tell a typed-in meeting from the mirror of a booking (which also fires `appointment.*`): a
        // rule that reacts to meetings skips `source: 'booking'`, so one booking is not handled twice.
        payload: { uuid: created.uuid, title: input.title, source: 'manual', appointmentId: null },
      });

      const row = await this.repo.findById(tx, ctx.orgId, created.id);
      return toContactMeetingResponse(row!);
    });
  }

  async update(uuid: string, input: UpdateContactMeetingInput): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactMeeting', uuid);
      const parent = await this.contactsRepo.findById(tx, ctx.orgId, existing.contactId);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        parent?.ownerId ?? null,
      );
      this.assertNotBooked(existing);

      const values: Record<string, unknown> = {};
      if (input.title !== undefined) values.title = input.title;
      if (input.startsAt !== undefined)
        values.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined) values.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.location !== undefined) values.location = input.location;

      const updated = await this.repo.updateWithVersion(
        tx,
        ctx.orgId,
        existing.id,
        input.rowVersion,
        values,
      );
      if (!updated) throw AppError.rowVersionConflict('ContactMeeting');

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'update' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_meeting.updated',
        payload: { uuid, source: 'manual', appointmentId: null },
      });

      const row = await this.repo.findById(tx, ctx.orgId, existing.id);
      return toContactMeetingResponse(row!);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('ContactMeeting', uuid);
      const parent = await this.contactsRepo.findById(tx, ctx.orgId, existing.contactId);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(
        tx,
        this.contactsRepo,
        ctx.orgId,
        scope,
        ctx.userId!,
        parent?.ownerId ?? null,
      );
      this.assertNotBooked(existing);

      await this.audit.record(tx, { module: MODULE_KEY, recordId: existing.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'contact_meeting.deleted',
        payload: { uuid, source: 'manual', appointmentId: null },
      });
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
    });
  }

  /**
   * A row that mirrors a booking is changed on the appointment, never here: an edit would be overwritten by the next change to the
   * appointment, and a delete would be undone by it. (A booking row whose appointment was deleted has nothing left to mirror and is
   * an ordinary row.)
   */
  private assertNotBooked(row: ContactMeetingRow): void {
    if (row.source === 'booking' && row.appointmentId !== null) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'This meeting comes from a booking. Change it on the appointment.',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Whether the caller may change the booking behind each mirrored row: `record.appointments.update`, with the grant's record scope
   * judged against the appointment's host and booker the way the appointments module judges it (`own`: I host it or I booked it;
   * `team` adds the people who share a team with me).
   */
  private async bookingManager(
    tx: Tx,
    orgId: number,
    rows: ContactMeetingRow[],
  ): Promise<(row: ContactMeetingRow) => boolean> {
    const ctx = RequestContextStore.require();
    const grant = this.rbac.can(ctx.grants!, 'record.appointments.update');
    if (!grant.allowed || !rows.some((r) => r.appointmentId !== null)) return () => false;
    const me = ctx.userId;
    const peers =
      grant.scope === 'team' && me !== null
        ? await this.repo.teamPeerIds(tx, orgId, me)
        : new Set<number>();
    return (row) => {
      if (row.appointmentId === null) return false;
      if (grant.scope === 'all') return true;
      if (me === null) return false;
      const people = [row.appointmentHostId, row.appointmentCreatedBy];
      if (people.includes(me)) return true;
      return grant.scope === 'team' && people.some((p) => p !== null && peers.has(p));
    };
  }

  private async requireContact(
    tx: Parameters<ContactsRepository['resolveContactRef']>[0],
    orgId: number,
    uuid: string,
  ) {
    const ref = await this.contactsRepo.resolveContactRef(tx, orgId, uuid);
    if (!ref) throw AppError.notFound('Contact', uuid);
    return ref;
  }
}
