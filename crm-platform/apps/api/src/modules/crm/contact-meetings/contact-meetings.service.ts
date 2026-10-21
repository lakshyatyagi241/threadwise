import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
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
import { ContactTouchService } from '../lead-handling/contact-touch.service';
import {
  ContactMeetingConferencingRepository,
  type MeetingConferencingRow,
} from './contact-meeting-conferencing.repository';
import {
  CONFERENCING_RELEASE_EVENT,
  MEETING_CONFERENCING,
  type MeetingConferencingPort,
} from './meeting-conferencing.port';
import {
  planConferencing,
  releaseAll,
  validZone,
  type ConferencingPlan,
  type ConferencingState,
} from './meeting-conferencing.rules';
import { canActOn } from '../../../kernel/rbac/scope';

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
    private readonly leadHandling: ContactTouchService,
    private readonly conferencingRepo: ContactMeetingConferencingRepository,
    /** Bound by the meeting-conferencing module; absent, a meeting is saved without any video or calendar step (BL-361, BL-362). */
    @Optional()
    @Inject(MEETING_CONFERENCING)
    private readonly conferencing?: MeetingConferencingPort,
  ) {}

  async list(
    contactUuid: string,
    query: ListContactMeetingsQuery,
  ): Promise<PageResponse<ContactMeetingResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.read').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
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
      const conf = await this.conferencingRepo.findByMeetings(
        tx,
        ctx.orgId,
        items.map((r) => r.id),
      );
      return {
        data: items.map((row) => toContactMeetingResponse(row, canManage(row), conf.get(row.id))),
        page,
      };
    });
  }

  async create(
    contactUuid: string,
    input: CreateContactMeetingInput,
  ): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    const made = await this.db.tx(async (tx) => {
      const contact = await this.requireContact(tx, ctx.orgId, contactUuid);
      const scope = this.rbac.can(ctx.grants!, 'record.contacts.update').scope;
      await assertContactScope(tx, this.contactsRepo, ctx.orgId, scope, ctx.userId!, contact);
      const contactId = contact.id;
      // A link or a calendar entry is judged BEFORE anything is written: a request the rules refuse saves nothing.
      const plan = this.conferencingPlan(null, input.conferencing, {
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
      });

      const created = await this.repo.insert(tx, ctx.orgId, {
        contactId,
        title: input.title,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        location: input.location,
        createdBy: ctx.userId,
      });
      await this.contactsRepo.bumpLastActivity(tx, ctx.orgId, contactId);
      // A meeting a person added reached the contact: lead handling (the uncontacted marker, BL-290). Never throws.
      await this.leadHandling.touch(tx, ctx.orgId, contactId, 'activity');

      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'contact_meeting.created',
        // `source` and `appointmentId` tell a typed-in meeting from the mirror of a booking (which also fires `appointment.*`): a
        // rule that reacts to meetings skips `source: 'booking'`, so one booking is not handled twice.
        payload: { uuid: created.uuid, title: input.title, source: 'manual', appointmentId: null },
      });
      if (plan.next) await this.applyConferencing(tx, ctx.orgId, created.id, plan);

      return { id: created.id, provision: plan.provision };
    });
    // The provider is asked once the meeting is safely saved: a slow or failing provider never loses the meeting or holds a connection.
    if (made.provision) await this.conferencing?.provision(ctx.orgId, made.id);
    return this.read(ctx.orgId, made.id);
  }

  async update(uuid: string, input: UpdateContactMeetingInput): Promise<ContactMeetingResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
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
        parent ?? { ownerId: null, createdBy: null },
      );
      this.assertNotBooked(existing);

      const values: Record<string, unknown> = {};
      if (input.title !== undefined) values.title = input.title;
      if (input.startsAt !== undefined)
        values.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined) values.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.location !== undefined) values.location = input.location;

      const held = await this.conferencingRepo.findByMeeting(tx, ctx.orgId, existing.id);
      const startsAt =
        input.startsAt !== undefined
          ? input.startsAt
            ? new Date(input.startsAt)
            : null
          : existing.startsAt;
      const plan = this.conferencingPlan(held ?? null, input.conferencing, { startsAt });
      if (plan.clearJoinUrl) values.joinUrl = null;
      // A request that changes only the video link or the calendar entry still takes the row's version (and checks the one the person saw).
      if (Object.keys(values).length === 0) values.updatedAt = new Date();

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
      if (plan.next || plan.release) {
        await this.applyConferencing(tx, ctx.orgId, existing.id, plan);
      }
      // A move or a rename follows the meeting to the room and the event it holds (the request may say nothing about video at all).
      const moved =
        input.title !== undefined ||
        input.startsAt !== undefined ||
        input.endsAt !== undefined ||
        input.location !== undefined;
      return {
        id: existing.id,
        provision: plan.provision && (input.conferencing !== undefined || moved),
      };
    });
    if (done.provision) await this.conferencing?.provision(ctx.orgId, done.id);
    return this.read(ctx.orgId, done.id);
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
        parent ?? { ownerId: null, createdBy: null },
      );
      this.assertNotBooked(existing);

      // The room and the calendar event are removed at the provider by the worker, from what is captured here: the row goes with the meeting.
      const held = await this.conferencingRepo.findByMeeting(tx, ctx.orgId, existing.id);
      const release = releaseAll(held ? stateOf(held) : null);
      if (release) {
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: existing.id,
          eventType: CONFERENCING_RELEASE_EVENT,
          payload: { ...release },
        });
      }

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

  /** The meeting as the caller sees it now (with its video link and calendar entry), read in its own transaction. */
  private async read(orgId: number, id: number): Promise<ContactMeetingResponse> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.findById(tx, orgId, id);
      const conf = await this.conferencingRepo.findByMeeting(tx, orgId, id);
      return toContactMeetingResponse(row!, false, conf);
    });
  }

  /** Judges a request for a video link or a calendar entry; the rules refuse one without a start time. */
  private conferencingPlan(
    current: MeetingConferencingRow | null,
    request: CreateContactMeetingInput['conferencing'],
    facts: { startsAt: Date | null },
  ): ConferencingPlan {
    const ctx = RequestContextStore.require();
    if (request?.timeZone && !validZone(request.timeZone)) {
      throw AppError.validation('That time zone is not known.', [
        { path: 'conferencing.timeZone', message: 'invalid_zone' },
      ]);
    }
    const res = planConferencing(current ? stateOf(current) : null, request, {
      actorUserId: ctx.userId,
      startsAt: facts.startsAt,
      timeZone: request?.timeZone,
    });
    if (!res.ok) {
      throw AppError.validation('A video link or a calendar entry needs a start time.', [
        { path: 'conferencing', message: res.problem },
      ]);
    }
    return res.plan;
  }

  /** Writes the plan: the row, and the release of what it drops (an outbox event, same transaction). */
  private async applyConferencing(
    tx: Tx,
    orgId: number,
    meetingId: number,
    plan: ConferencingPlan,
  ): Promise<void> {
    if (plan.release) {
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: meetingId,
        eventType: CONFERENCING_RELEASE_EVENT,
        payload: { ...plan.release },
      });
    }
    const n = plan.next;
    if (!n) return;
    await this.conferencingRepo.upsert(tx, orgId, meetingId, {
      hostUserId: n.hostUserId,
      videoProvider: n.videoProvider,
      videoMeetingId: n.videoMeetingId,
      videoVia: n.videoVia,
      ...(n.resetVideo
        ? { videoStatus: 'pending' as const, videoError: null }
        : n.videoProvider === null
          ? { videoStatus: null, videoError: null }
          : {}),
      addToCalendar: n.addToCalendar,
      sendInvitation: n.sendInvitation,
      calendarProvider: n.calendarProvider,
      calendarId: n.calendarId,
      calendarEventId: n.calendarEventId,
      ...(n.resetCalendar ? { calendarStatus: null, calendarError: null } : {}),
      timeZone: n.timeZone,
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
    // The appointments module's own rule (host or booker, plus teammates at `team`), through the one scope resolver.
    const allowed = new Set<ContactMeetingRow>();
    for (const row of rows) {
      if (row.appointmentId === null) continue;
      if (
        await canActOn(tx, { orgId, userId: ctx.userId }, grant.scope, [
          row.appointmentHostId,
          row.appointmentCreatedBy,
        ])
      ) {
        allowed.add(row);
      }
    }
    return (row) => allowed.has(row);
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

/** The columns the planning rules read. */
function stateOf(row: MeetingConferencingRow): ConferencingState {
  return {
    hostUserId: row.hostUserId,
    videoProvider: row.videoProvider,
    videoMeetingId: row.videoMeetingId,
    videoVia: row.videoVia,
    addToCalendar: row.addToCalendar,
    sendInvitation: row.sendInvitation,
    calendarProvider: row.calendarProvider,
    calendarId: row.calendarId,
    calendarEventId: row.calendarEventId,
    timeZone: row.timeZone,
  };
}
