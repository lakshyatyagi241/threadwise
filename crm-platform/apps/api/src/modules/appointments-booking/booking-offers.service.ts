import { Injectable } from '@nestjs/common';
import { ERROR_CODES, type AppointmentSource } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { RESERVATION_MINUTES, checkAnswers, inviteeFromAnswers, money } from './appointment-rules';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { priceOf, BookingService } from './booking.service';
import { AppointmentPlan } from './booking-plan';
import { BookingTypesRepository } from './booking-types.repository';
import { ContactLinkService, normalizeEmail, normalizePhone } from './contact-link.service';
import { bookableRange, findOpenSlot, generateSlots } from './slot-engine';
import { SlotsService } from './slots.service';
import { addDays, formatClock, localMonthOf, monthBounds, startOfLocalDay } from './tz';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Reference's channel lists cap at ten rows, so a page is nine plus "more". */
export const OFFER_PAGE = 9;

export interface OfferedType {
  id: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  locationType: string;
  introMessage: string | null;
  currency: string | null;
  /** What the customer owes to book ("0.00" when nothing). */
  dueNow: string;
  hasGateway: boolean;
  questions: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    options: string[] | null;
    mapToContactField: string | null;
  }>;
}

export type Offer =
  | { available: true; types: OfferedType[] }
  | { available: false; reason: 'feature_off' | 'plan_limit' };

export interface FlowBookInput {
  typeId: string;
  startsAt: Date;
  /** Keyed by question uuid. */
  answers?: Record<string, string>;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  /** An existing contact (internal id), when the flow knows it. */
  contactId?: number | null;
  conversationId?: number | null;
  /** The soft-lock reservation made by `reserve`. */
  reservationId?: string;
  sessionRef?: string;
}

/**
 * The chat flow's side of booking (TW-APPT-019, 020, 021, 034): what Reference's Node runtime reached over `/api/booking/*` with a shared
 * secret is a plain service here, called by the flow-runtime domain with the workspace id. No HTTP surface, so no shared secret to guard.
 *
 * The caller names the organization; every method runs scoped to it. `book` writes an audit row and an outbox event, which need a
 * request context: it opens one (actor `bot`) around the call.
 */
@Injectable()
export class BookingOffersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly types: BookingTypesRepository,
    private readonly appts: AppointmentsRepository,
    private readonly slots: SlotsService,
    private readonly booking: BookingService,
    private readonly plan: AppointmentPlan,
    private readonly contactLink: ContactLinkService,
  ) {}

  /** The active types and the offer-time gate: the feature must be on and the month's cap not reached. */
  async offer(orgId: number): Promise<Offer> {
    if (!(await this.plan.isEnabled(orgId))) return { available: false, reason: 'feature_off' };
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const cap = await this.plan.cap(orgId);
      if (cap > 0) {
        const now = Date.now();
        const tz = await this.slots.orgTimezone(tx, orgId);
        const b = monthBounds(localMonthOf(now, tz), tz);
        if ((await this.appts.countInRange(tx, orgId, b.startMs, b.endMs)) >= cap) {
          return { available: false as const, reason: 'plan_limit' as const };
        }
      }
      const rows = await this.types.activeTypes(tx, orgId);
      const children = await this.types.children(
        tx,
        orgId,
        rows.map((r) => r.id),
      );
      return {
        available: true as const,
        types: rows.map((r): OfferedType => {
          const c = children.get(r.id)!;
          const { dueNow } = priceOf(c.financial);
          return {
            id: r.uuid,
            name: r.name,
            durationMinutes: r.durationMinutes,
            description: r.description,
            locationType: r.locationType,
            introMessage: r.introMessage,
            currency: c.financial?.currency ?? null,
            dueNow: money(dueNow, c.financial?.currency ?? null),
            hasGateway: Boolean(c.financial?.gatewaySlug),
            questions: c.questions.map((q) => ({
              id: q.uuid,
              label: q.label,
              type: q.type,
              required: q.required,
              options: q.options,
              mapToContactField: q.mapToContactField,
            })),
          };
        }),
      };
    });
  }

  /** Step one of the drill-down: the next days that have an open slot, nine to a page. */
  async days(
    orgId: number,
    typeId: string,
    offset = 0,
  ): Promise<{
    timezone: string;
    days: Array<{ date: string; label: string; count: number }>;
    hasMore: boolean;
    nextOffset: number;
  }> {
    const nowMs = Date.now();
    const lt = await this.loadActive(orgId, typeId);
    // A drill-down wants the whole advance window, not the two-week default of a slots query.
    const tz = lt.engine.timezone;
    const all = await this.wholeWindow(orgId, lt, nowMs);
    const days = all.map((d) => {
      const [y, m, dd] = d.date.split('-').map(Number) as [number, number, number];
      const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
      return {
        date: d.date,
        label: `${WEEKDAYS[wd]}, ${dd} ${MONTHS[m - 1]}`,
        count: d.slots.length,
      };
    });
    return {
      timezone: tz,
      days: days.slice(offset, offset + OFFER_PAGE),
      hasMore: days.length > offset + OFFER_PAGE,
      nextOffset: offset + OFFER_PAGE,
    };
  }

  /** Step two: the open times of one day, nine to a page. */
  async times(
    orgId: number,
    typeId: string,
    date: string,
    offset = 0,
  ): Promise<{
    timezone: string;
    date: string;
    times: Array<{ start: string; end: string; label: string }>;
    hasMore: boolean;
    nextOffset: number;
  }> {
    const nowMs = Date.now();
    const lt = await this.loadActive(orgId, typeId);
    const tz = lt.engine.timezone;
    const busy = await this.slots.busyFor(
      orgId,
      lt,
      startOfLocalDay(date, tz) - 86_400_000,
      startOfLocalDay(addDays(date, 1), tz) + 86_400_000,
    );
    const day = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const facts = await this.slots.facts(
        tx,
        orgId,
        lt,
        { fromMs: startOfLocalDay(date, tz), toMs: startOfLocalDay(addDays(date, 1), tz) },
        { nowMs, busy },
      );
      return generateSlots({ ...facts, fromDate: date, toDate: date })[0]?.slots ?? [];
    });
    const times = day.map((s) => ({
      start: new Date(s.startMs).toISOString(),
      end: new Date(s.endMs).toISOString(),
      label: formatClock(s.startMs, tz),
    }));
    return {
      timezone: tz,
      date,
      times: times.slice(offset, offset + OFFER_PAGE),
      hasMore: times.length > offset + OFFER_PAGE,
      nextOffset: offset + OFFER_PAGE,
    };
  }

  /** Holds one seat of a slot for ten minutes while the customer answers the questions or pays. */
  async reserve(
    orgId: number,
    typeId: string,
    startsAt: Date,
    sessionRef: string,
    channel = 'whatsapp',
  ): Promise<{ reservationId: string; expiresAt: string }> {
    const nowMs = Date.now();
    const lt = await this.loadActive(orgId, typeId);
    const startMs = startsAt.getTime();
    const busy = await this.slots.busyFor(
      orgId,
      lt,
      startMs - 86_400_000,
      startMs + 2 * 86_400_000,
    );
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.appts.lockType(tx, orgId, lt.row.id);
      const facts = await this.slots.facts(
        tx,
        orgId,
        lt,
        { fromMs: startMs, toMs: startMs + lt.row.durationMinutes * 60_000 },
        { nowMs, busy, exceptSessionRef: sessionRef },
      );
      const open = findOpenSlot(facts, startMs);
      if (!open) {
        throw new AppError(
          ERROR_CODES.APPT_SLOT_TAKEN,
          'That time is not available any more.',
          409,
        );
      }
      const expiresAt = new Date(nowMs + RESERVATION_MINUTES * 60_000);
      const res = await this.appts.insertReservation(tx, orgId, {
        typeId: lt.row.id,
        startsAt,
        endsAt: new Date(startMs + lt.row.durationMinutes * 60_000),
        sessionRef,
        channel,
        expiresAt,
      });
      return { reservationId: res.uuid, expiresAt: expiresAt.toISOString() };
    });
  }

  /** Commits the booking for a chat customer; the same engine and the same guard as staff and the public page. */
  async book(
    orgId: number,
    input: FlowBookInput,
  ): Promise<{ appointment: AppointmentRow; manageUrl: string; replay: boolean }> {
    const nowMs = Date.now();
    return RequestContextStore.run(
      { requestId: `flow-booking-${nowMs}`, orgId, actorType: 'bot', actorId: null, userId: null },
      async () => {
        const lt = await this.loadActive(orgId, input.typeId);
        const questions = lt.children.questions.map((q) => ({
          id: q.uuid,
          label: q.label,
          type: q.type,
          options: q.options,
          required: q.required,
          mapToContactField: q.mapToContactField,
        }));
        const answers = checkAnswers(questions, input.answers);
        const mapped = inviteeFromAnswers(questions, answers);
        const invitee = {
          name: input.name ?? mapped.name ?? null,
          email: normalizeEmail(input.email ?? mapped.email ?? null),
          phone: normalizePhone(input.phone ?? mapped.phone ?? null, 'phone'),
        };
        const contactId =
          input.contactId ?? (await this.contactLink.resolve(invitee, lt.row.hostUuid));
        const startMs = input.startsAt.getTime();
        const busy = await this.slots.busyFor(
          orgId,
          lt,
          startMs - 86_400_000,
          startMs + 2 * 86_400_000,
        );
        const source: AppointmentSource = 'chat';
        const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.booking.book(tx, {
            orgId,
            typeUuid: input.typeId,
            startsAt: input.startsAt,
            source,
            invitee,
            contactId,
            inviteeTimezone: null,
            notes: null,
            answers,
            createdBy: null,
            conversationId: input.conversationId ?? null,
            staff: false,
            notify: true,
            reservationUuid: input.reservationId,
            sessionRef: input.sessionRef,
            nowMs,
            busy,
            requireActiveType: true,
          }),
        );
        const token = res.token ?? '';
        return { appointment: res.row, manageUrl: `/b/manage/${token}`, replay: res.replay };
      },
    );
  }

  // --- internals -----------------------------------------------------------------------------------------------------

  private async loadActive(orgId: number, typeUuid: string) {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.types.findByUuid(tx, orgId, typeUuid);
      if (!row || !row.isActive) throw AppError.notFound('Booking type', typeUuid);
      return this.slots.load(tx, orgId, row);
    });
  }

  /** Every day of the advance window with its open slots. */
  private async wholeWindow(
    orgId: number,
    lt: Awaited<ReturnType<BookingOffersService['loadActive']>>,
    nowMs: number,
  ) {
    const tz = lt.engine.timezone;
    const first = bookableRange(lt.engine, nowMs);
    const busy = await this.slots.busyFor(
      orgId,
      lt,
      startOfLocalDay(first.first, tz) - 86_400_000,
      startOfLocalDay(addDays(first.last, 1), tz) + 86_400_000,
    );
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const facts = await this.slots.facts(
        tx,
        orgId,
        lt,
        {
          fromMs: startOfLocalDay(first.first, tz),
          toMs: startOfLocalDay(addDays(first.last, 1), tz),
        },
        { nowMs, busy },
      );
      return generateSlots({ ...facts, fromDate: first.first, toDate: first.last });
    });
  }
}
