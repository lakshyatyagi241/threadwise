import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  majorToMinor,
  type AppointmentSource,
  type AppointmentStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import {
  PAYMENT_HOLD_MINUTES,
  assertActive,
  assertTransition,
  percentToBp,
  totalWithTax,
  generateManageToken,
  hashToken,
  money,
  type AnswerSnapshot,
} from './appointment-rules';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { AppointmentPlan, unavailable } from './booking-plan';
import { BookingTypesRepository, type FinancialRow } from './booking-types.repository';
import { findOpenSlot, pickSeat, type EngineBusy } from './slot-engine';
import { SlotsService } from './slots.service';
import { localMonthOf, monthBounds } from './tz';

const MINUTE = 60_000;

export interface BookParams {
  orgId: number;
  typeUuid: string;
  startsAt: Date;
  source: AppointmentSource;
  invitee: { name: string | null; email: string | null; phone: string | null };
  contactId: number | null;
  inviteeTimezone: string | null;
  notes: string | null;
  /** Already checked against the questions. */
  answers: AnswerSnapshot[];
  /** Internal user id of the host; default the type's host. */
  hostId?: number | null;
  /** Internal user id of the staff member who booked it; null for a customer or a flow. */
  createdBy: number | null;
  conversationId?: number | null;
  /** Staff only: skip the grid, the notice, the horizon and the day cap. A taken seat is never ignored. */
  ignoreAvailability?: boolean;
  /** Staff are the approval and the payment: the result is confirmed whatever the type says. */
  staff: boolean;
  /** Tell the customer. */
  notify: boolean;
  /** The caller's soft-lock reservation (released with the booking) and its session, which does not block itself. */
  reservationUuid?: string;
  sessionRef?: string;
  nowMs: number;
  /** The calendar's busy intervals, fetched before the transaction. */
  busy: EngineBusy[];
  /** A paused type is refused to customers and flows. */
  requireActiveType: boolean;
}

export interface BookResult {
  row: AppointmentRow;
  /** The manage token (a replay recovers it from the encrypted copy). */
  token: string | null;
  replay: boolean;
}

export interface MoveParams {
  startsAt: Date;
  ignoreAvailability: boolean;
  notify: boolean;
  by: 'staff' | 'invitee';
  nowMs: number;
  busy: EngineBusy[];
  rowVersion?: number;
  /** Only when a move must keep a length other than the booking type's (accepting a time Google shows): the new end. */
  endsAt?: Date;
}

export interface TransitionParams {
  by: 'staff' | 'invitee' | 'system';
  reason?: string | null;
  notify: boolean;
  nowMs: number;
  rowVersion?: number;
}

const slotTaken = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_SLOT_TAKEN,
    'That time was just taken. Please pick another.',
    HttpStatus.CONFLICT,
  );

const slotUnavailable = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_SLOT_UNAVAILABLE,
    'That time is not available for this service.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/**
 * Postgres exclusion_violation (23P01), unique_violation (23505) or deadlock_detected (40P01), however the driver wrapped it. The
 * deadlock is what racing inserters into one slot can be handed by the exclusion check: either way the slot is not theirs.
 */
export function isSlotConflict(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const code = (e as { code?: string }).code;
    if (code === '23P01' || code === '23505' || code === '40P01') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** What is owed to book, in minor units, from a type's price row. */
export function priceOf(fin: FinancialRow | null): { total: bigint; dueNow: bigint } {
  if (!fin) return { total: 0n, dueNow: 0n };
  const total = totalWithTax(fin.feeMinor, percentToBp(fin.taxPct));
  const dueNow =
    fin.depositMode === 'full' ? total : fin.depositMode === 'partial' ? fin.depositValueMinor : 0n;
  return { total, dueNow };
}

/**
 * The one place a booking is made, moved or closed (TW-APPT-021, 025, 026; EXT-APPT-02..05). Staff, the public page and the chat flow
 * all come through here, so they cannot disagree about what a free slot is.
 *
 * Every method runs in the CALLER's transaction: the row, its audit entry and its outbox event commit together.
 *
 * Double booking is prevented twice. In the application, a per-(organization, booking type) advisory lock serialises the commit and
 * the slot engine is re-run under it, so buffers, capacity, the day cap and reservations are honoured. In the database, the
 * exclusion constraint on (type, seat, time range) refuses an overlapping pair even if some path forgot the lock.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly types: BookingTypesRepository,
    private readonly appts: AppointmentsRepository,
    private readonly support: AppointmentsSupport,
    private readonly slots: SlotsService,
    private readonly plan: AppointmentPlan,
  ) {}

  // --- book -----------------------------------------------------------------------------------------------------------------

  async book(tx: Tx, p: BookParams): Promise<BookResult> {
    const found = await this.types.findByUuid(tx, p.orgId, p.typeUuid);
    if (!found) throw AppError.notFound('Booking type', p.typeUuid);
    await this.appts.lockType(tx, p.orgId, found.id);
    // Read again under the lock: the type may have been edited or paused while this request waited.
    const type = (await this.types.findById(tx, p.orgId, found.id))!;
    if (p.requireActiveType && !type.isActive) throw AppError.notFound('Booking type', p.typeUuid);
    const lt = await this.slots.load(tx, p.orgId, type);
    const startMs = p.startsAt.getTime();
    const endMs = startMs + type.durationMinutes * MINUTE;

    // The same visitor asking twice (a double click, a retry) gets their booking back.
    if (!p.staff) {
      const same = await this.appts.activeSameSlot(
        tx,
        p.orgId,
        type.id,
        p.startsAt,
        p.invitee.email,
        p.invitee.phone,
      );
      if (same)
        return {
          row: same,
          token: this.support.decrypt(same.manageTokenCipher, 'manage_token'),
          replay: true,
        };
    }

    const facts = await this.slots.facts(
      tx,
      p.orgId,
      lt,
      { fromMs: startMs, toMs: endMs },
      {
        nowMs: p.nowMs,
        busy: p.busy,
        exceptSessionRef: p.sessionRef,
      },
    );
    let seat: number | null;
    if (p.ignoreAvailability) {
      seat = pickSeat(lt.engine, facts.bookings, startMs, endMs, false);
    } else {
      if (!findOpenSlot(facts, startMs)) {
        // On the schedule but full, or not on the schedule at all?
        const onSchedule = findOpenSlot({ ...facts, bookings: [], holds: [], busy: [] }, startMs);
        throw onSchedule ? slotTaken() : slotUnavailable();
      }
      seat = pickSeat(lt.engine, facts.bookings, startMs, endMs, true);
    }
    if (seat === null) throw slotTaken();

    await this.assertPlanCap(tx, p.orgId, startMs);

    const fin = lt.children.financial;
    const { total, dueNow } = priceOf(fin);
    const currency = fin?.currency ?? null;
    let status: AppointmentStatus;
    let paymentStatus: 'none' | 'pending';
    let hold: Date | null = null;
    if (p.staff) {
      status = 'confirmed';
      paymentStatus = dueNow > 0n ? 'pending' : 'none';
    } else {
      paymentStatus = dueNow > 0n ? 'pending' : 'none';
      status = dueNow > 0n || type.approvalRequired ? 'pending' : 'confirmed';
      // Without a gateway nobody can pay online, so the booking waits for staff instead of expiring under the customer.
      if (dueNow > 0n && fin?.gatewaySlug) hold = new Date(p.nowMs + PAYMENT_HOLD_MINUTES * MINUTE);
    }

    const token = generateManageToken();
    const name = p.invitee.name ?? 'Booking';
    let id: number;
    try {
      id = await this.appts.insert(tx, p.orgId, {
        bookingTypeId: type.id,
        hostId: p.hostId === undefined ? type.hostId : p.hostId,
        createdBy: p.createdBy,
        contactId: p.contactId,
        conversationId: p.conversationId ?? null,
        title: `${type.name} — ${name}`.slice(0, 191),
        description: type.description,
        location: type.locationValue,
        startsAt: p.startsAt,
        endsAt: new Date(endMs),
        timezone: lt.engine.timezone,
        inviteeTimezone: p.inviteeTimezone,
        status,
        paymentStatus,
        source: p.source,
        seat,
        answers: p.answers,
        notesCipher: this.support.encrypt(p.notes),
        inviteeName: p.invitee.name,
        inviteeEmail: p.invitee.email,
        inviteePhone: p.invitee.phone,
        manageTokenHash: hashToken(token),
        manageTokenCipher: this.support.crypto.encrypt(token),
        priceMinor: total,
        currency,
        dueNowMinor: dueNow,
        holdExpiresAt: hold,
        calendarId: lt.children.integration?.calendarId ?? null,
      });
    } catch (err) {
      if (isSlotConflict(err)) throw slotTaken();
      throw err;
    }
    if (p.reservationUuid) await this.appts.deleteReservation(tx, p.orgId, p.reservationUuid);

    const row = (await this.appts.findById(tx, p.orgId, id))!;
    await this.support.record(tx, row, {
      orgId: p.orgId,
      audit: { action: 'insert' },
      event: {
        type: 'appointment.booked',
        extra: {
          requiresApproval: status === 'pending' && type.approvalRequired,
          paymentDue: dueNow > 0n,
          notify: p.notify,
        },
      },
    });
    if (dueNow > 0n) {
      // The hook for the payments domain: it makes the pay link or the invoice and calls `recordPayment` when it is settled.
      await this.support.record(tx, row, {
        orgId: p.orgId,
        event: {
          type: 'appointment.payment_due',
          extra: {
            amount: money(dueNow, currency),
            currency,
            gatewaySlug: fin?.gatewaySlug ?? null,
            holdExpiresAt: hold ? hold.toISOString() : null,
          },
        },
      });
    }
    return { row, token, replay: false };
  }

  // --- reschedule -----------------------------------------------------------------------------------------------------------

  /** `row` is locked by the caller. */
  async reschedule(
    tx: Tx,
    orgId: number,
    row: AppointmentRow,
    p: MoveParams,
  ): Promise<AppointmentRow> {
    assertActive(row.status, 'reschedule');
    if (row.startsAt.getTime() <= p.nowMs) throw alreadyStarted();
    if (row.bookingTypeId === null) throw typeGone();
    const startMs = p.startsAt.getTime();
    const sameEnd = p.endsAt === undefined || p.endsAt.getTime() === row.endsAt.getTime();
    if (startMs === row.startsAt.getTime() && sameEnd) return row;

    await this.appts.lockType(tx, orgId, row.bookingTypeId);
    const type = await this.types.findById(tx, orgId, row.bookingTypeId);
    if (!type) throw typeGone();
    const lt = await this.slots.load(tx, orgId, type);
    const endMs = p.endsAt ? p.endsAt.getTime() : startMs + type.durationMinutes * MINUTE;
    // The booking being moved does not block its own new slot.
    const facts = await this.slots.facts(
      tx,
      orgId,
      lt,
      { fromMs: startMs, toMs: endMs },
      {
        nowMs: p.nowMs,
        busy: p.busy,
        exceptAppointmentId: row.id,
      },
    );
    let seat: number | null;
    if (p.ignoreAvailability) {
      seat = pickSeat(lt.engine, facts.bookings, startMs, endMs, false);
    } else {
      if (!findOpenSlot(facts, startMs)) {
        const onSchedule = findOpenSlot({ ...facts, bookings: [], holds: [], busy: [] }, startMs);
        throw onSchedule ? slotTaken() : slotUnavailable();
      }
      seat = pickSeat(lt.engine, facts.bookings, startMs, endMs, true);
    }
    if (seat === null) throw slotTaken();

    try {
      const ok = await this.appts.update(tx, orgId, row.id, p.rowVersion, {
        starts_at: p.startsAt.toISOString(),
        ends_at: new Date(endMs).toISOString(),
        seat,
        timezone: lt.engine.timezone,
        armed_at: new Date(p.nowMs).toISOString(),
        needs_review: false,
      });
      if (!ok) throw AppError.rowVersionConflict('Appointment');
    } catch (err) {
      if (isSlotConflict(err)) throw slotTaken();
      throw err;
    }
    // Every reminder offset is armed again for the new time.
    await this.appts.clearReminderRuns(tx, orgId, row.id);
    const after = (await this.appts.findById(tx, orgId, row.id))!;
    await this.support.record(tx, after, {
      orgId,
      audit: {
        action: 'update',
        delta: {
          startsAt: { old: row.startsAt.toISOString(), new: after.startsAt.toISOString() },
          ...(row.endsAt.getTime() !== after.endsAt.getTime()
            ? { endsAt: { old: row.endsAt.toISOString(), new: after.endsAt.toISOString() } }
            : {}),
        },
      },
      event: {
        type: 'appointment.rescheduled',
        extra: { previousStartsAt: row.startsAt.toISOString(), by: p.by, notify: p.notify },
      },
    });
    return after;
  }

  // --- status transitions ---------------------------------------------------------------------------------------------------

  /** `row` is locked by the caller. */
  async transition(
    tx: Tx,
    orgId: number,
    row: AppointmentRow,
    to: Exclude<AppointmentStatus, 'pending'>,
    p: TransitionParams,
  ): Promise<AppointmentRow> {
    assertTransition(row.status, to);
    if ((to === 'completed' || to === 'no_show') && row.startsAt.getTime() > p.nowMs) {
      throw new AppError(
        ERROR_CODES.APPT_NOT_STARTED,
        'The appointment has not started yet.',
        HttpStatus.CONFLICT,
      );
    }
    const nowIso = new Date(p.nowMs).toISOString();
    const patch: Record<string, unknown> = {
      status: to,
      status_changed_at: nowIso,
      hold_expires_at: null,
      needs_review: false,
    };
    let fee = 0n;
    if (to === 'cancelled' || to === 'declined') {
      patch.cancelled_at = nowIso;
      patch.cancelled_by = p.by;
      patch.cancel_reason = p.reason ?? null;
    }
    if ((to === 'cancelled' && p.by === 'invitee') || to === 'no_show') {
      const fin =
        row.bookingTypeId === null
          ? null
          : ((await this.types.children(tx, orgId, [row.bookingTypeId])).get(row.bookingTypeId)
              ?.financial ?? null);
      if (fin) {
        if (to === 'no_show') fee = fin.noShowFeeMinor;
        else if (
          fin.cancelFeeMinor > 0n &&
          row.startsAt.getTime() - p.nowMs <= fin.cancelWindowMinutes * MINUTE
        ) {
          fee = fin.cancelFeeMinor;
        }
      }
      // Recorded only (Reference: "recorded only in this release"): nothing is charged here.
      if (fee > 0n) patch.fee_recorded_minor = fee.toString();
    }
    const ok = await this.appts.update(tx, orgId, row.id, p.rowVersion, patch);
    if (!ok) throw AppError.rowVersionConflict('Appointment');
    const after = (await this.appts.findById(tx, orgId, row.id))!;
    const eventType: Record<string, string> = {
      confirmed: 'appointment.confirmed',
      declined: 'appointment.declined',
      cancelled: 'appointment.cancelled',
      completed: 'appointment.completed',
      no_show: 'appointment.no_show',
    };
    await this.support.record(tx, after, {
      orgId,
      audit: { action: 'update', delta: { status: { old: row.status, new: to } } },
      event: {
        type: eventType[to]!,
        extra: {
          from: row.status,
          by: p.by,
          reason: p.reason ?? null,
          notify: p.notify,
          feeRecorded: fee > 0n ? money(fee, after.currency) : null,
        },
      },
    });
    return after;
  }

  /** Stamps the arrival. Confirmed only; idempotent. */
  async checkIn(
    tx: Tx,
    orgId: number,
    row: AppointmentRow,
    nowMs: number,
    rowVersion?: number,
  ): Promise<AppointmentRow> {
    assertActive(row.status, 'check_in');
    if (row.checkedInAt) return row;
    const ok = await this.appts.update(tx, orgId, row.id, rowVersion, {
      checked_in_at: new Date(nowMs).toISOString(),
    });
    if (!ok) throw AppError.rowVersionConflict('Appointment');
    const after = (await this.appts.findById(tx, orgId, row.id))!;
    await this.support.record(tx, after, {
      orgId,
      audit: { action: 'update', delta: { checkedIn: { old: false, new: true } } },
    });
    return after;
  }

  // --- payment ----------------------------------------------------------------------------------------------------------------

  /**
   * Records money received for a booking (D-13). It never talks to a gateway: the payments domain, or a person at the till, calls
   * this when the money is in. When what is due to book has been paid, a pending booking is confirmed (unless the type needs staff
   * approval, which is a separate decision).
   */
  async recordPayment(
    tx: Tx,
    orgId: number,
    row: AppointmentRow,
    amount: string,
    extra: { method?: string | null; reference?: string | null },
    nowMs: number,
    needsApproval: boolean,
  ): Promise<AppointmentRow> {
    assertActive(row.status, 'payment');
    const bad = (message: string): AppError =>
      new AppError(ERROR_CODES.APPT_AMOUNT_INVALID, message, HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'amount', message: 'amount' },
      ]);
    if (row.priceMinor <= 0n) throw bad('This appointment has no price.');
    const minor = majorToMinor(amount, row.currency ?? 'USD');
    if (minor === null || minor <= 0n)
      throw bad("Give a positive amount with the currency's decimals.");
    const paid = row.depositPaidMinor + minor;
    if (paid > row.priceMinor) throw bad('That is more than the price of this appointment.');
    const paymentStatus = paid >= row.priceMinor ? 'paid' : 'partial';
    const settles = paid >= row.dueNowMinor;
    const confirm = row.status === 'pending' && settles && !needsApproval;
    const patch: Record<string, unknown> = {
      deposit_paid_minor: paid.toString(),
      payment_status: paymentStatus,
    };
    if (settles) patch.hold_expires_at = null;
    if (confirm) {
      patch.status = 'confirmed';
      patch.status_changed_at = new Date(nowMs).toISOString();
    }
    const ok = await this.appts.update(tx, orgId, row.id, undefined, patch);
    if (!ok) throw AppError.rowVersionConflict('Appointment');
    const after = (await this.appts.findById(tx, orgId, row.id))!;
    await this.support.record(tx, after, {
      orgId,
      audit: {
        action: 'update',
        delta: {
          paymentStatus: { old: row.paymentStatus, new: paymentStatus },
          ...(confirm ? { status: { old: row.status, new: 'confirmed' } } : {}),
        },
      },
      event: {
        type: 'appointment.payment_received',
        extra: {
          amount,
          currency: after.currency,
          method: extra.method ?? null,
          reference: extra.reference ?? null,
        },
      },
    });
    if (confirm) {
      await this.support.record(tx, after, {
        orgId,
        event: {
          type: 'appointment.confirmed',
          extra: { from: 'pending', by: 'system', reason: 'payment', notify: true },
        },
      });
    }
    return after;
  }

  // --- plan cap ---------------------------------------------------------------------------------------------------------------

  /** The monthly cap (D-17): bookings that start in the same calendar month, in the workspace's zone, as the new one. */
  private async assertPlanCap(tx: Tx, orgId: number, startMs: number): Promise<void> {
    const cap = await this.plan.cap(orgId);
    if (cap === 0) return;
    const tz = await this.slots.orgTimezone(tx, orgId);
    const { startMs: from, endMs: to } = monthBounds(localMonthOf(startMs, tz), tz);
    await this.plan.assertWithinCap(orgId, await this.appts.countInRange(tx, orgId, from, to));
  }

  /** Public-side gate: the feature must be on. The cap is checked at commit. */
  async assertOffered(orgId: number): Promise<void> {
    if (!(await this.plan.isEnabled(orgId))) throw unavailable();
  }
}

const alreadyStarted = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_ALREADY_STARTED,
    'This appointment has already started.',
    HttpStatus.CONFLICT,
  );

const typeGone = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_TYPE_UNAVAILABLE,
    'The service this appointment was booked for no longer exists, so it cannot be moved.',
    HttpStatus.CONFLICT,
  );
