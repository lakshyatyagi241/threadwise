import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type AppointmentActionInput,
  type AppointmentCountsQuery,
  type AppointmentCountsResponse,
  type AppointmentManageLink,
  type AppointmentPageResponse,
  type AppointmentResponse,
  type CancelAppointmentInput,
  type CreateAppointmentInput,
  type ListAppointmentsQuery,
  type RecordAppointmentPaymentInput,
  type RecordScope,
  type RescheduleAppointmentInput,
  type UpdateAppointmentInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import {
  checkAnswers,
  generateManageToken,
  hashToken,
  inviteeFromAnswers,
  isFinal,
  type QuestionFacts,
} from './appointment-rules';
import { buildIcs } from './ics';
import {
  appointmentScopeCondition,
  type AppointmentFilter,
  type AppointmentRow,
  AppointmentsRepository,
} from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { BookingService } from './booking.service';
import { BookingTypesRepository } from './booking-types.repository';
import {
  ContactLinkService,
  normalizeEmail,
  normalizePhone,
  type InviteeFacts,
} from './contact-link.service';
import { SlotsService } from './slots.service';

export const APPOINTMENTS_PAGE_LIMIT = 50;

const encodeCursor = (r: AppointmentRow): string =>
  Buffer.from(`${r.startKey}|${r.id}`, 'utf8').toString('base64url');

function decodeCursor(raw: string): { key: string; id: number } {
  const [key, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const n = Number(id);
  if (!key || Number.isNaN(Date.parse(key)) || !Number.isInteger(n)) {
    throw AppError.validation('The cursor is not valid.', [{ path: 'cursor', message: 'invalid' }]);
  }
  return { key, id: n };
}

/**
 * Appointments as staff see them (TW-APPT-002..004, 039; EXT-APPT-02, 04, 06, 07). One transaction per operation: the row lock, the
 * write, the audit row and the outbox event commit together or not at all.
 *
 * What differs from Reference (all in the inventory's "Port decisions"): a status machine with staff actions; a booking is validated by
 * the slot engine and cannot take a taken seat; the record scope applies to every read and write; the list is paged, filtered and
 * counted; the customer's manage link can be copied and rotated; an ICS file can be downloaded.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    private readonly support: AppointmentsSupport,
    private readonly booking: BookingService,
    private readonly slots: SlotsService,
    private readonly contactLink: ContactLinkService,
    private readonly rbac: RbacService,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(query: ListAppointmentsQuery, scope: RecordScope): Promise<AppointmentPageResponse> {
    return this.db.tx(async (tx) => this.listIn(tx, query, scope, {}));
  }

  /** A contact's appointments (EXT-APPT-07): needs record.contacts.read on the contact, whose own scope applies. */
  async forContact(
    contactUuid: string,
    query: ListAppointmentsQuery,
    scope: RecordScope,
  ): Promise<AppointmentPageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      // AZ-020: a contact that does not exist and one the caller may not read (no record.contacts.read, or outside its
      // scope) answer the same 404, with the same text, so the route cannot be used to find out which contacts exist.
      const contact = await this.repo.resolveContact(tx, ctx.orgId, contactUuid);
      try {
        if (!contact) throw AppError.notFound('Contact', contactUuid);
        await this.assertContactVisible(tx, contact.ownerId);
      } catch (err) {
        if (err instanceof AppError && (err.getStatus() === 403 || err.getStatus() === 404)) {
          throw AppError.notFound('Contact', contactUuid);
        }
        throw err;
      }
      return this.listIn(tx, { ...query, contactId: undefined }, scope, { contactId: contact.id });
    });
  }

  async counts(
    query: AppointmentCountsQuery,
    scope: RecordScope,
  ): Promise<AppointmentCountsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = await this.resolveFilter(tx, ctx.orgId, query, {});
      if (!filter) return emptyCounts();
      const c = await this.repo.counts(
        tx,
        ctx.orgId,
        filter,
        appointmentScopeCondition(ctx.orgId, scope, ctx.userId),
        ctx.userId,
      );
      const n = (k: string) => c.byStatus[k] ?? 0;
      return {
        pending: n('pending'),
        confirmed: n('confirmed'),
        cancelled: n('cancelled'),
        declined: n('declined'),
        completed: n('completed'),
        noShow: n('no_show'),
        total: Object.values(c.byStatus).reduce((a, b) => a + b, 0),
        upcoming: c.upcoming,
        past: c.past,
        needsReview: c.needsReview,
        mine: { upcoming: c.mineUpcoming },
      };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Appointment', uuid);
      await this.assertScope(tx, scope, row);
      return this.support.toResponse(row);
    });
  }

  /** The appointment as an iCalendar file (EXT-APPT-06). */
  async ics(uuid: string, scope: RecordScope): Promise<{ filename: string; body: string }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Appointment', uuid);
      await this.assertScope(tx, scope, row);
      return this.icsFor(row);
    });
  }

  /** `forCustomer`: the summary never falls back to the booking's own title, which is made of the customer's name. */
  icsFor(row: AppointmentRow, forCustomer = false): { filename: string; body: string } {
    return {
      filename: `appointment-${row.uuid.slice(0, 8)}.ics`,
      body: buildIcs({
        uid: `${row.uuid}@appointments`,
        title: row.bookingTypeName ?? (forCustomer ? 'Appointment' : row.title),
        description: row.description,
        location: row.meetUrl ?? row.location,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        status: row.status,
        sequence: row.rowVersion,
        stampedAt: row.updatedAt,
      }),
    };
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async create(input: CreateAppointmentInput): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    const nowMs = Date.now();
    // 1. Read the type, the contact and the host; check the answers.
    const prep = await this.db.tx(async (tx) => {
      const type = await this.types.findByUuid(tx, ctx.orgId, input.bookingTypeId);
      if (!type) throw AppError.notFound('Booking type', input.bookingTypeId);
      const children = (await this.types.children(tx, ctx.orgId, [type.id])).get(type.id)!;
      const questions: QuestionFacts[] = children.questions.map((q) => ({
        id: q.uuid,
        label: q.label,
        type: q.type,
        options: q.options,
        required: q.required,
        mapToContactField: q.mapToContactField,
      }));
      const answers = checkAnswers(questions, input.answers);

      let contact: {
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
      } | null = null;
      if (input.contactId) {
        const c = await this.repo.resolveContact(tx, ctx.orgId, input.contactId);
        if (!c) throw AppError.notFound('Contact', input.contactId);
        await this.assertContactVisible(tx, c.ownerId);
        contact = c;
      }
      const host =
        input.hostId === undefined
          ? undefined
          : input.hostId === null
            ? null
            : await this.hostId(tx, ctx.orgId, input.hostId);
      return { type, questions, answers, contact, host, hostUuid: type.hostUuid };
    });

    const mapped = inviteeFromAnswers(prep.questions, prep.answers);
    const invitee: InviteeFacts = {
      name: input.invitee?.name ?? prep.contact?.name ?? mapped.name ?? null,
      email: normalizeEmail(input.invitee?.email ?? prep.contact?.email ?? mapped.email ?? null),
      phone: normalizePhone(input.invitee?.phone ?? prep.contact?.phone ?? mapped.phone ?? null),
    };
    if (!invitee.name) {
      throw AppError.validation('Give the invitee a name.', [
        { path: 'invitee.name', message: 'required' },
      ]);
    }

    // 2. The contact (found or made), outside the booking transaction.
    const contactId = prep.contact
      ? prep.contact.id
      : await this.contactLink.resolve(invitee, prep.hostUuid);

    // 3. The calendar's busy time, outside the transaction.
    const startMs = new Date(input.startsAt).getTime();
    const lt = await this.db.tx((tx) => this.slots.load(tx, ctx.orgId, prep.type));
    const busy = await this.slots.busyFor(
      ctx.orgId,
      lt,
      startMs - 86_400_000,
      startMs + 2 * 86_400_000,
    );

    // 4. The booking.
    return this.db.tx(async (tx) => {
      const res = await this.booking.book(tx, {
        orgId: ctx.orgId,
        typeUuid: input.bookingTypeId,
        startsAt: new Date(input.startsAt),
        source: 'manual',
        invitee,
        contactId,
        inviteeTimezone: input.inviteeTimezone ?? null,
        notes: input.notes ?? null,
        answers: prep.answers,
        hostId: prep.host,
        createdBy: ctx.userId,
        ignoreAvailability: input.ignoreAvailability,
        staff: true,
        notify: input.notify,
        nowMs,
        busy,
        requireActiveType: false,
      });
      return this.support.toResponse(res.row);
    });
  }

  async update(
    uuid: string,
    input: UpdateAppointmentInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Appointment');
      const patch: Record<string, unknown> = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const set = (col: string, key: string, next: unknown, prev: unknown) => {
        if (next === prev) return;
        patch[col] = next;
        delta[key] = { old: prev, new: next };
      };
      if (input.title !== undefined) set('title', 'title', input.title, row.title);
      if (input.description !== undefined)
        set('description', 'description', input.description ?? null, row.description);
      if (input.location !== undefined)
        set('location', 'location', input.location ?? null, row.location);
      if (input.notes !== undefined) {
        const next = input.notes ? input.notes : null;
        patch.notes = this.support.encrypt(next);
        // The audit trail is plain JSON: it records that the notes changed, never what they say.
        delta.notes = { old: row.notesCipher !== null, new: next !== null };
      }
      if (input.hostId !== undefined) {
        const host = input.hostId === null ? null : await this.hostId(tx, ctx.orgId, input.hostId);
        if (host !== row.hostId) {
          patch.user_id = host;
          delta.host = { old: row.hostUuid, new: input.hostId };
        }
      }
      if (input.contactId !== undefined) {
        let contact: number | null = null;
        if (input.contactId !== null) {
          const c = await this.repo.resolveContact(tx, ctx.orgId, input.contactId);
          if (!c) throw AppError.notFound('Contact', input.contactId);
          await this.assertContactVisible(tx, c.ownerId);
          contact = c.id;
        }
        if (contact !== row.contactId) {
          patch.contact_id = contact;
          delta.contact = { old: row.contactUuid, new: input.contactId };
        }
      }
      if (input.invitee) {
        const i = input.invitee;
        if (i.name !== undefined) set('invitee_name', 'inviteeName', i.name, row.inviteeName);
        if (i.email !== undefined)
          set('invitee_email', 'inviteeEmail', normalizeEmail(i.email), row.inviteeEmail);
        if (i.phone !== undefined)
          set('invitee_phone', 'inviteePhone', normalizePhone(i.phone), row.inviteePhone);
      }
      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Appointment');
        const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
        await this.support.record(tx, after, { audit: { action: 'update', delta } });
        return this.support.toResponse(after);
      }
      return this.support.toResponse(row);
    });
  }

  async reschedule(
    uuid: string,
    input: RescheduleAppointmentInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    const nowMs = Date.now();
    const busy = await this.busyAround(uuid, scope, new Date(input.startsAt).getTime());
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      const after = await this.booking.reschedule(tx, ctx.orgId, row, {
        startsAt: new Date(input.startsAt),
        ignoreAvailability: input.ignoreAvailability,
        notify: input.notify,
        by: 'staff',
        nowMs,
        busy,
        rowVersion: input.rowVersion,
      });
      return this.support.toResponse(after);
    });
  }

  /**
   * "Accept Google's change": moves the booking to the start AND end its Google event shows, through the same rules as a staff move (the
   * reminders are armed again, the customer is told when `notify`, `appointment.rescheduled` is emitted). Availability is not re-checked: a
   * person is accepting a time somebody chose on purpose. Only the end differing is a move too.
   */
  async rescheduleToGoogle(
    uuid: string,
    input: { startsAt: Date; endsAt: Date; notify: boolean; rowVersion?: number },
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    const nowMs = Date.now();
    const busy = await this.busyAround(uuid, scope, input.startsAt.getTime());
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      const after = await this.booking.reschedule(tx, ctx.orgId, row, {
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        ignoreAvailability: true,
        notify: input.notify,
        by: 'staff',
        nowMs,
        busy,
        rowVersion: input.rowVersion,
      });
      return this.support.toResponse(after);
    });
  }

  cancel(
    uuid: string,
    input: CancelAppointmentInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    return this.act(uuid, scope, 'cancelled', input);
  }
  confirm(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    return this.act(uuid, scope, 'confirmed', input);
  }
  decline(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    return this.act(uuid, scope, 'declined', input);
  }
  complete(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    return this.act(uuid, scope, 'completed', input);
  }
  noShow(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    return this.act(uuid, scope, 'no_show', input);
  }

  async checkIn(
    uuid: string,
    input: AppointmentActionInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      return this.support.toResponse(
        await this.booking.checkIn(tx, ctx.orgId, row, Date.now(), input.rowVersion),
      );
    });
  }

  /** Records money received (D-13). The payments domain calls this too when its gateway reports a settled payment. */
  async recordPayment(
    uuid: string,
    input: RecordAppointmentPaymentInput,
    scope: RecordScope,
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      const needsApproval =
        row.bookingTypeId !== null &&
        (await this.types.findById(tx, ctx.orgId, row.bookingTypeId))?.approvalRequired === true;
      const after = await this.booking.recordPayment(
        tx,
        ctx.orgId,
        row,
        input.amount,
        { method: input.method, reference: input.reference },
        Date.now(),
        needsApproval,
      );
      return this.support.toResponse(after);
    });
  }

  /** A new manage link; the old one stops working at once. */
  async rotateManageLink(uuid: string, scope: RecordScope): Promise<AppointmentManageLink> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      const token = generateManageToken();
      await this.repo.update(tx, ctx.orgId, row.id, undefined, {
        manage_token_hash: hashToken(token),
        manage_token_cipher: this.support.crypto.encrypt(token),
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.support.record(tx, after, {
        audit: { action: 'update', delta: { manageLink: { old: 'rotated', new: 'rotated' } } },
      });
      return { manageUrl: this.support.manageUrlFor(token) };
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      if (!isFinal(row.status)) {
        throw new AppError(
          ERROR_CODES.APPT_NOT_DELETABLE,
          'Cancel or close this appointment before deleting it.',
          HttpStatus.CONFLICT,
        );
      }
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.support.record(tx, row, {
        audit: { action: 'delete', delta: { title: { old: row.title, new: null } } },
        event: { type: 'appointment.deleted' },
      });
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  private async act(
    uuid: string,
    scope: RecordScope,
    to: 'cancelled' | 'confirmed' | 'declined' | 'completed' | 'no_show',
    input: { reason?: string | null; notify?: boolean; rowVersion?: number },
  ): Promise<AppointmentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      const after = await this.booking.transition(tx, ctx.orgId, row, to, {
        by: 'staff',
        reason: input.reason ?? null,
        notify: input.notify ?? true,
        nowMs: Date.now(),
        rowVersion: input.rowVersion,
      });
      return this.support.toResponse(after);
    });
  }

  /** The calendar's busy time around a target, fetched before the write transaction opens. */
  private async busyAround(uuid: string, scope: RecordScope, startMs: number) {
    const ctx = RequestContextStore.require();
    const lt = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Appointment', uuid);
      await this.assertScope(tx, scope, row);
      if (row.bookingTypeId === null) return null;
      const type = await this.types.findById(tx, ctx.orgId, row.bookingTypeId);
      return type ? this.slots.load(tx, ctx.orgId, type) : null;
    });
    return lt
      ? this.slots.busyFor(ctx.orgId, lt, startMs - 86_400_000, startMs + 2 * 86_400_000)
      : [];
  }

  private async listIn(
    tx: Tx,
    query: ListAppointmentsQuery,
    scope: RecordScope,
    extra: { contactId?: number },
  ): Promise<AppointmentPageResponse> {
    const ctx = RequestContextStore.require();
    const filter = await this.resolveFilter(tx, ctx.orgId, query, extra);
    const limit = query.limit;
    if (!filter) return { data: [], page: { nextCursor: null, hasMore: false, limit } };
    const order = query.order ?? (query.scope === 'upcoming' ? 'asc' : 'desc');
    const rows = await this.repo.list(tx, ctx.orgId, {
      filter,
      scope: appointmentScopeCondition(ctx.orgId, scope, ctx.userId),
      window: query.scope,
      status: query.status,
      order,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: page.map((r) => this.support.toResponse(r)),
      page: { nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null, hasMore, limit },
    };
  }

  /** The filter with uuids turned into internal ids; null when one names something that does not exist (an empty result). */
  private async resolveFilter(
    tx: Tx,
    orgId: number,
    q: AppointmentCountsQuery & { contactId?: string },
    extra: { contactId?: number },
  ): Promise<AppointmentFilter | null> {
    const ctx = RequestContextStore.require();
    const f: AppointmentFilter = {
      q: q.q,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      needsReview: q.needsReview,
    };
    if (q.bookingTypeId) {
      const t = await this.types.findByUuid(tx, orgId, q.bookingTypeId);
      if (!t) return null;
      f.bookingTypeId = t.id;
    }
    if (q.contactId) {
      const c = await this.repo.resolveContactIdByUuid(tx, orgId, q.contactId);
      if (c === undefined) return null;
      f.contactId = c;
    }
    if (extra.contactId !== undefined) f.contactId = extra.contactId;
    if (q.hostId) {
      const h = await this.repo.resolveUserId(tx, orgId, q.hostId);
      if (h === undefined) return null;
      f.hostId = h;
    }
    if (q.mine) {
      if (!ctx.userId) return null;
      f.hostId = ctx.userId;
    }
    return f;
  }

  private async lock(tx: Tx, uuid: string, scope: RecordScope): Promise<AppointmentRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
    if (!row) throw AppError.notFound('Appointment', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  /** Not-found, never forbidden: an appointment outside the caller's scope is not revealed to exist. */
  private async assertScope(tx: Tx, scope: RecordScope, row: AppointmentRow): Promise<void> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return;
    const actor = ctx.userId;
    if (!actor) throw AppError.notFound('Appointment');
    if (row.hostId === actor || row.createdById === actor) return;
    if (scope === 'team') {
      for (const other of [row.hostId, row.createdById]) {
        if (other !== null && (await this.repo.isInActorTeam(tx, ctx.orgId, actor, other))) return;
      }
    }
    throw AppError.notFound('Appointment');
  }

  /** The caller may only attach a contact they can read (its own scope applies). */
  private async assertContactVisible(tx: Tx, ownerId: number | null): Promise<void> {
    const ctx = RequestContextStore.require();
    const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
    if (!read.allowed) throw AppError.forbidden('record.contacts.read');
    if (read.scope === 'all') return;
    if (!ctx.userId || ownerId === null) throw AppError.notFound('Contact');
    if (read.scope === 'own' && ownerId === ctx.userId) return;
    if (
      read.scope === 'team' &&
      (ownerId === ctx.userId ||
        (await this.repo.isInActorTeam(tx, ctx.orgId, ctx.userId, ownerId)))
    )
      return;
    throw AppError.notFound('Contact');
  }

  private async hostId(tx: Tx, orgId: number, uuid: string): Promise<number> {
    const u = await this.types.resolveActiveUser(tx, orgId, uuid);
    if (!u) {
      throw new AppError(
        ERROR_CODES.APPT_HOST_INVALID,
        'The host must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'hostId', message: uuid }],
      );
    }
    return u.id;
  }
}

const emptyCounts = (): AppointmentCountsResponse => ({
  pending: 0,
  confirmed: 0,
  cancelled: 0,
  declined: 0,
  completed: 0,
  noShow: 0,
  total: 0,
  upcoming: 0,
  past: 0,
  needsReview: 0,
  mine: { upcoming: 0 },
});
