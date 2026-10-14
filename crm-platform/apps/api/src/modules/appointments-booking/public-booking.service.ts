import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type PublicBookInput,
  type PublicBookResponse,
  type PublicBookingPage,
  type PublicBookingType,
  type PublicCancelInput,
  type PublicManageView,
  type PublicRescheduleInput,
  type SlotsQuery,
  type SlotsResponse,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  checkAnswers,
  hashToken,
  inviteeFromAnswers,
  isActive,
  looksLikeToken,
  money,
  type QuestionFacts,
} from './appointment-rules';
import { ConsentNoticeService } from '../contact-consent';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsService } from './appointments.service';
import { AppointmentsSupport } from './appointments.support';
import { priceOf, BookingService } from './booking.service';
import { unavailable } from './booking-plan';
import {
  BookingTypesRepository,
  type BookingTypeRow,
  type TypeChildren,
} from './booking-types.repository';
import { ContactLinkService, normalizeEmail, normalizePhone } from './contact-link.service';
import { BookingPublicThrottle } from './public-throttle';
import { generateSlots } from './slot-engine';
import { SlotsService } from './slots.service';
import { addDays, startOfLocalDay } from './tz';

const MINUTE = 60_000;

const gone = (): AppError =>
  new AppError(
    ERROR_CODES.APPT_LINK_UNAVAILABLE,
    'This booking can no longer be changed. Contact the business if you need help.',
    HttpStatus.GONE,
  );

/**
 * The customer's side (EXT-APPT-01, TW-APPT-024..026). No login: a booking page is public by design, and a booking is managed with
 * its unguessable token (a SHA-256 of it is looked up in one privileged query, because the organization is not known before it;
 * the rest of the request then runs scoped to that organization like any other).
 *
 * What differs from Reference: the customer can book from a page (Reference only inside a chat); every move is validated by the slot engine
 * (Reference accepted any instant); the page shows the real status and no personal data; the same visitor booking the same slot again
 * gets their booking back; every route is throttled per IP and per target.
 */
@Injectable()
export class PublicBookingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    private readonly support: AppointmentsSupport,
    private readonly booking: BookingService,
    private readonly slots: SlotsService,
    private readonly contactLink: ContactLinkService,
    private readonly staff: AppointmentsService,
    private readonly throttle: BookingPublicThrottle,
    private readonly notices: ConsentNoticeService,
  ) {}

  // --- the booking page -------------------------------------------------------------------------------------------------

  async page(orgSlug: string): Promise<PublicBookingPage> {
    const org = await this.locateOrg(orgSlug, 'browse', orgSlug);
    return this.db.tx(async (tx) => {
      const rows = await this.types.activeTypes(tx, org.id);
      const children = await this.types.children(
        tx,
        org.id,
        rows.map((r) => r.id),
      );
      const zone = await this.slots.orgTimezone(tx, org.id);
      return {
        organization: { name: org.name, slug: org.slug },
        services: rows.map((r) => this.presentType(r, children.get(r.id)!, zone)),
      };
    });
  }

  async typeView(
    orgSlug: string,
    typeSlug: string,
  ): Promise<{ organization: { name: string; slug: string }; service: PublicBookingType }> {
    const org = await this.locateOrg(orgSlug, 'browse', `${orgSlug}/${typeSlug}`);
    return this.db.tx(async (tx) => {
      const { row, children } = await this.activeType(tx, org.id, typeSlug);
      const zone = await this.slots.orgTimezone(tx, org.id);
      return {
        organization: { name: org.name, slug: org.slug },
        service: {
          ...this.presentType(row, children, zone),
          // The optional consent line under the form (BL-167); null when the workspace wrote none.
          consent: await this.consentLine(tx, org.id, row.uuid),
        },
      };
    });
  }

  async slotsFor(orgSlug: string, typeSlug: string, query: SlotsQuery): Promise<SlotsResponse> {
    const org = await this.locateOrg(orgSlug, 'browse', `${orgSlug}/${typeSlug}`);
    const nowMs = Date.now();
    const lt = await this.db.tx(async (tx) => {
      const { row } = await this.activeType(tx, org.id, typeSlug);
      return this.slots.load(tx, org.id, row);
    });
    return this.slotsOf(org.id, lt, query, nowMs);
  }

  async book(
    orgSlug: string,
    typeSlug: string,
    input: PublicBookInput,
  ): Promise<PublicBookResponse> {
    const org = await this.locateOrg(orgSlug, 'book', `${orgSlug}/${typeSlug}`);
    const nowMs = Date.now();
    const prep = await this.db.tx(async (tx) => {
      const { row, children } = await this.activeType(tx, org.id, typeSlug);
      const questions = children.questions.map(toFacts);
      return { row, children, questions, answers: checkAnswers(questions, input.answers) };
    });
    const mapped = inviteeFromAnswers(prep.questions, prep.answers);
    const invitee = {
      name: input.name,
      email: normalizeEmail(input.email ?? mapped.email ?? null),
      phone: normalizePhone(input.phone ?? mapped.phone ?? null, 'phone'),
    };
    if (!invitee.email && !invitee.phone) {
      throw AppError.validation('Give an email or a phone number so we can reach you.', [
        { path: 'email', message: 'required' },
      ]);
    }
    // The visitor ticked the consent line: the wording and version are the SERVER's (looked up by the version their page named), never
    // text sent by the browser. An unknown, switched-off or invented version grants nothing; the booking goes ahead either way.
    const seen =
      input.consent?.given === true
        ? await this.db.tx((tx) =>
            this.notices.seen(tx, org.id, 'booking', prep.row.uuid, input.consent!.version),
          )
        : null;
    const contactId = await this.contactLink.resolve(
      invitee,
      prep.row.hostUuid,
      seen
        ? {
            proof: { text: seen.text, version: String(seen.version) },
            evidence: {
              bookingTypeId: prep.row.uuid,
              noticeVersion: String(seen.version),
              noticeUrl: seen.url ?? undefined,
            },
          }
        : undefined,
    );
    const lt = await this.db.tx((tx) => this.slots.load(tx, org.id, prep.row));
    const startMs = new Date(input.startsAt).getTime();
    const busy = await this.slots.busyFor(
      org.id,
      lt,
      startMs - 86_400_000,
      startMs + 2 * 86_400_000,
    );

    try {
      return await this.db.tx(async (tx) => {
        const res = await this.booking.book(tx, {
          orgId: org.id,
          typeUuid: prep.row.uuid,
          startsAt: new Date(input.startsAt),
          source: 'link',
          invitee,
          contactId,
          inviteeTimezone: input.timezone ?? null,
          notes: input.notes ?? null,
          answers: prep.answers,
          createdBy: null,
          staff: false,
          notify: true,
          nowMs,
          busy,
          requireActiveType: true,
        });
        const r = res.row;
        const token = res.token ?? '';
        return {
          status: r.status,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          timezone: r.timezone,
          requiresApproval: r.status === 'pending' && prep.row.approvalRequired,
          paymentDue:
            r.dueNowMinor > 0n && r.paymentStatus === 'pending'
              ? { currency: r.currency, amount: money(r.dueNowMinor, r.currency) }
              : null,
          manageToken: token,
          manageUrl: this.support.manageUrlFor(token),
          replay: res.replay,
        };
      });
    } catch (err) {
      // A reached plan cap is the business's problem, not the visitor's: "not available right now", and no upgrade hint.
      if (err instanceof AppError && err.code === ERROR_CODES.PLAN_LIMIT_REACHED)
        throw unavailable();
      throw err;
    }
  }

  // --- the manage page ---------------------------------------------------------------------------------------------------

  async manageView(token: string): Promise<PublicManageView> {
    const { orgId, uuid } = await this.locate(token, 'manageRead');
    return this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, orgId, uuid);
      const org = await this.types.org(tx, orgId);
      const type =
        row.bookingTypeId === null
          ? undefined
          : await this.types.findById(tx, orgId, row.bookingTypeId);
      const children = type
        ? (await this.types.children(tx, orgId, [type.id])).get(type.id)!
        : null;
      const upcoming = isActive(row.status) && row.startsAt.getTime() > Date.now();
      const fin = children?.financial ?? null;
      const feeNow =
        fin !== null &&
        fin.cancelFeeMinor > 0n &&
        upcoming &&
        row.startsAt.getTime() - Date.now() <= fin.cancelWindowMinutes * MINUTE;
      return {
        status: row.status,
        organization: { name: org.name },
        bookingType: type
          ? {
              name: type.name,
              durationMinutes: type.durationMinutes,
              locationType: type.locationType,
              locationValue: row.location ?? type.locationValue,
            }
          : null,
        // The booking's own title is made of the customer's name; the page shows the service.
        title: type?.name ?? 'Appointment',
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        timezone: row.timezone,
        meetUrl: row.meetUrl,
        canCancel: upcoming,
        canReschedule: upcoming && type !== undefined,
        cancelFee: feeNow
          ? { currency: fin!.currency, amount: money(fin!.cancelFeeMinor, fin!.currency) }
          : null,
      };
    });
  }

  async manageSlots(token: string, query: SlotsQuery): Promise<SlotsResponse> {
    const { orgId, uuid } = await this.locate(token, 'manageRead');
    const nowMs = Date.now();
    const lt = await this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, orgId, uuid);
      if (!isActive(row.status) || row.bookingTypeId === null) throw gone();
      const type = await this.types.findById(tx, orgId, row.bookingTypeId);
      if (!type) throw gone();
      return { lt: await this.slots.load(tx, orgId, type), id: row.id };
    });
    return this.slotsOf(orgId, lt.lt, query, nowMs, lt.id);
  }

  async reschedule(token: string, input: PublicRescheduleInput): Promise<PublicManageView> {
    const { orgId, uuid } = await this.locate(token, 'manageWrite');
    const nowMs = Date.now();
    const target = new Date(input.startsAt);
    const lt = await this.db.tx(async (tx) => {
      const row = await this.mustFind(tx, orgId, uuid);
      if (!isActive(row.status)) throw gone();
      if (row.bookingTypeId === null) return null;
      const type = await this.types.findById(tx, orgId, row.bookingTypeId);
      return type ? this.slots.load(tx, orgId, type) : null;
    });
    const busyIntervals = lt
      ? await this.slots.busyFor(
          orgId,
          lt,
          target.getTime() - 86_400_000,
          target.getTime() + 2 * 86_400_000,
        )
      : [];
    await this.db.tx(async (tx) => {
      const row = await this.appts.findByUuid(tx, orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking');
      if (!isActive(row.status)) throw gone();
      await this.booking.reschedule(tx, orgId, row, {
        startsAt: target,
        ignoreAvailability: false,
        notify: true,
        by: 'invitee',
        nowMs,
        busy: busyIntervals,
      });
    });
    return this.manageView(token);
  }

  async cancel(token: string, input: PublicCancelInput): Promise<PublicManageView> {
    const { orgId, uuid } = await this.locate(token, 'manageWrite');
    await this.db.tx(async (tx) => {
      const row = await this.appts.findByUuid(tx, orgId, uuid, true);
      if (!row) throw AppError.notFound('Booking');
      if (!isActive(row.status)) throw gone();
      if (row.startsAt.getTime() <= Date.now()) {
        throw new AppError(
          ERROR_CODES.APPT_ALREADY_STARTED,
          'This appointment has already started.',
          HttpStatus.CONFLICT,
        );
      }
      await this.booking.transition(tx, orgId, row, 'cancelled', {
        by: 'invitee',
        reason: input.reason ?? null,
        notify: true,
        nowMs: Date.now(),
      });
    });
    return this.manageView(token);
  }

  async ics(token: string): Promise<{ filename: string; body: string }> {
    const { orgId, uuid } = await this.locate(token, 'manageRead');
    return this.db.tx(async (tx) => this.staff.icsFor(await this.mustFind(tx, orgId, uuid), true));
  }

  // --- internals ---------------------------------------------------------------------------------------------------------

  private async slotsOf(
    orgId: number,
    lt: Awaited<ReturnType<SlotsService['load']>>,
    query: SlotsQuery,
    nowMs: number,
    exceptId?: number,
  ): Promise<SlotsResponse> {
    const window = this.slots.window(query, lt, nowMs);
    const tz = lt.engine.timezone;
    const fromMs = startOfLocalDay(window.fromDate, tz);
    const toMs = startOfLocalDay(addDays(window.toDate, 1), tz);
    const busy = await this.slots.busyFor(orgId, lt, fromMs - 86_400_000, toMs + 86_400_000);
    return this.db.tx(async (tx) => {
      if (exceptId === undefined) return this.slots.slots(tx, orgId, lt, query, nowMs, busy);
      // A booking being moved does not block its own slots.
      const facts = await this.slots.facts(
        tx,
        orgId,
        lt,
        { fromMs, toMs },
        { nowMs, busy, exceptAppointmentId: exceptId },
      );
      const days = generateSlots({ ...facts, fromDate: window.fromDate, toDate: window.toDate });
      return {
        timezone: tz,
        durationMinutes: lt.engine.durationMinutes,
        days: days.map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => ({
            start: new Date(s.startMs).toISOString(),
            end: new Date(s.endMs).toISOString(),
            remaining: s.remaining,
          })),
        })),
      };
    });
  }

  private presentType(row: BookingTypeRow, c: TypeChildren, orgZone: string): PublicBookingType {
    const { total, dueNow } = priceOf(c.financial);
    const currency = c.financial?.currency ?? null;
    return {
      slug: row.slug,
      name: row.name,
      description: row.description,
      introMessage: row.introMessage,
      durationMinutes: row.durationMinutes,
      locationType: row.locationType,
      locationValue: row.locationValue,
      color: row.color,
      timezone: row.timezone ?? orgZone,
      approvalRequired: row.approvalRequired,
      price:
        total > 0n
          ? { currency, total: money(total, currency), dueNow: money(dueNow, currency) }
          : null,
      questions: c.questions.map((q) => ({
        id: q.uuid,
        label: q.label,
        type: q.type,
        options: q.options,
        required: q.required,
      })),
      // Only the single-service page carries the wording (`typeView`); the directory lists services without it.
      consent: null,
    };
  }

  private async consentLine(
    tx: Tx,
    orgId: number,
    typeUuid: string,
  ): Promise<PublicBookingType['consent']> {
    const n = await this.notices.publicCurrent(tx, orgId, 'booking', typeUuid);
    return n ? { text: n.text, version: n.version, url: n.url } : null;
  }

  private async activeType(
    tx: Tx,
    orgId: number,
    slug: string,
  ): Promise<{ row: BookingTypeRow; children: TypeChildren }> {
    const row = await this.types.findBySlug(tx, orgId, slug);
    if (!row || !row.isActive) throw AppError.notFound('Service');
    const children = (await this.types.children(tx, orgId, [row.id])).get(row.id)!;
    return { row, children };
  }

  /** The workspace behind a booking page, throttled first (a junk slug costs a Redis hit, not a query). */
  private async locateOrg(
    slug: string,
    kind: 'browse' | 'book',
    target: string,
  ): Promise<{ id: number; name: string; slug: string }> {
    const ctx = RequestContextStore.require();
    await this.throttle.check(kind, ctx.ip, target);
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(slug)) throw AppError.notFound('Booking page');
    const org = await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, name, slug FROM organizations WHERE slug = ${slug} AND status = 'active'`,
      );
      return res.rows[0] as { id: number | string; name: string; slug: string } | undefined;
    });
    if (!org) throw AppError.notFound('Booking page');
    ctx.orgId = Number(org.id);
    await this.booking.assertOffered(Number(org.id));
    return { id: Number(org.id), name: org.name, slug: org.slug };
  }

  /** Token to booking: throttled, shape-checked, looked up by hash; the request is then scoped to the booking's organization. */
  private async locate(
    token: string,
    kind: 'manageRead' | 'manageWrite',
  ): Promise<{ orgId: number; uuid: string }> {
    const ctx = RequestContextStore.require();
    await this.throttle.check(kind, ctx.ip, token, true);
    if (!looksLikeToken(token)) throw AppError.notFound('Booking');
    const hit = await this.db.privileged((tx) =>
      this.appts.locateByTokenHash(tx, hashToken(token)),
    );
    if (!hit) throw AppError.notFound('Booking');
    ctx.orgId = hit.orgId;
    return hit;
  }

  private async mustFind(tx: Tx, orgId: number, uuid: string): Promise<AppointmentRow> {
    const row = await this.appts.findByUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Booking');
    return row;
  }
}

const toFacts = (q: TypeChildren['questions'][number]): QuestionFacts => ({
  id: q.uuid,
  label: q.label,
  type: q.type,
  options: q.options,
  required: q.required,
  mapToContactField: q.mapToContactField,
});
