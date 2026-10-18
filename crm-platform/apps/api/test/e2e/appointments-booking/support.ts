import { expect } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, bearer, startHarness, type Grant, type Harness, type Tenant };

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let ip = 1;
/** A new client address per call: the public routes throttle per IP, and the tests share one. */
export const freshIp = (): string => `10.88.${Math.floor(ip / 250)}.${ip++ % 250}`;

export const ADMIN_KEYS = ['record.appointments.read'];

/** Every weekday, all day (so a slot exists whenever the test runs), in UTC unless a zone is given. */
export const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  from: '00:00',
  to: '23:59',
}));

export interface BookingType {
  id: string;
  name: string;
  slug: string;
  publicPath: string;
  durationMinutes: number;
  capacity: number;
  effectiveTimezone: string;
  host: { id: string; name: string } | null;
  availability: Array<{ weekday: number; from: string; to: string }>;
  overrides: Array<{
    date: string;
    isClosed: boolean;
    from: string | null;
    to: string | null;
    reason: string | null;
  }>;
  questions: Array<{ id: string; label: string; type: string; required: boolean }>;
  reminders: Array<{
    id: string;
    offsetMinutes: number;
    isActive: boolean;
    kind: 'before' | 'after';
    channels: string[];
    subject: string | null;
    body: string | null;
    waTemplateId: string | null;
  }>;
  templates: Array<{ event: string; channel: string; plainBody: string | null }>;
  payment: {
    fee: string;
    total: string;
    dueNow: string;
    currency: string | null;
    depositMode: string;
  };
  calendar: { calendarId: string | null; createMeet: boolean };
  appointmentsCount: number;
  upcomingCount: number;
  rowVersion: number;
  isActive: boolean;
  approvalRequired: boolean;
}

export interface Appointment {
  id: string;
  status: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  seat: number;
  bookingType: { id: string; name: string } | null;
  invitee: { name: string | null; email: string | null; phone: string | null };
  contact: { id: string; name: string | null } | null;
  host: { id: string; name: string } | null;
  source: string;
  notes: string | null;
  payment: {
    status: string;
    total: string;
    dueNow: string;
    paid: string;
    feeRecorded: string;
    currency: string | null;
    holdExpiresAt: string | null;
  };
  needsReview: boolean;
  checkedInAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  manageUrl: string | null;
  calendar: {
    eventId: string | null;
    calendarId: string | null;
    sync?: {
      state: 'in_sync' | 'drifted';
      reason: string | null;
      detectedAt: string | null;
      googleStartsAt: string | null;
      googleEndsAt: string | null;
      checkedAt: string | null;
    } | null;
  };
  answers: Array<{ questionId: string | null; label: string; value: string }>;
  rowVersion: number;
}

export interface Slot {
  start: string;
  end: string;
  remaining: number;
}

/** Appointments helpers on top of the contacts harness (same app, same database, organizations of their own). */
export class AppointmentsApi extends Api {
  /** Idempotent POSTs need a key; a fresh one per call. */
  post(token: string, path: string, body: unknown = {}) {
    return this.http()
      .post(path)
      .set(bearer(token))
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body as object);
  }

  async type(token: string, body: Record<string, unknown> = {}): Promise<BookingType> {
    const res = await this.post(token, '/v2/booking-types', {
      name: `Demo ${Math.random().toString(36).slice(2, 7)}`,
      durationMinutes: 30,
      minNoticeMinutes: 0,
      maxAdvanceDays: 30,
      timezone: 'UTC',
      availability: ALL_DAY,
      ...body,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as BookingType;
  }

  async slots(token: string, typeId: string, qs = ''): Promise<Slot[]> {
    const res = await this.as(token).get(`/v2/booking-types/${typeId}/slots${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.days as Array<{ slots: Slot[] }>).flatMap((d) => d.slots);
  }

  async publicSlots(orgSlug: string, typeSlug: string, qs = ''): Promise<Slot[]> {
    const res = await this.http()
      .get(`/v2/public/booking/${orgSlug}/${typeSlug}/slots${qs}`)
      .set('x-forwarded-for', freshIp());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.days as Array<{ slots: Slot[] }>).flatMap((d) => d.slots);
  }

  async staffBook(token: string, body: Record<string, unknown>): Promise<Appointment> {
    const res = await this.post(token, '/v2/appointments', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Appointment;
  }

  publicBook(orgSlug: string, typeSlug: string, body: Record<string, unknown>, ipAddr = freshIp()) {
    return this.http()
      .post(`/v2/public/booking/${orgSlug}/${typeSlug}/book`)
      .set('x-forwarded-for', ipAddr)
      .send(body);
  }

  async publicBooked(orgSlug: string, typeSlug: string, body: Record<string, unknown>) {
    const res = await this.publicBook(orgSlug, typeSlug, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as {
      status: string;
      startsAt: string;
      endsAt: string;
      requiresApproval: boolean;
      paymentDue: { currency: string | null; amount: string } | null;
      manageToken: string;
      manageUrl: string;
      replay: boolean;
    };
  }

  manage(token: string) {
    return this.http().get(`/v2/public/booking-manage/${token}`).set('x-forwarded-for', freshIp());
  }
  managePost(token: string, action: 'reschedule' | 'cancel', body: unknown = {}) {
    return this.http()
      .post(`/v2/public/booking-manage/${token}/${action}`)
      .set('x-forwarded-for', freshIp())
      .send(body as object);
  }

  async appt(token: string, id: string): Promise<Appointment> {
    const res = await this.as(token).get(`/v2/appointments/${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Appointment;
  }

  async rowOf(id: string): Promise<Record<string, unknown>> {
    return (await this.h.owner.query(`SELECT * FROM appointments WHERE uuid = $1`, [id])).rows[0];
  }

  /** Shifts a booking in time directly (arranging only): hours relative to now. */
  async moveTo(id: string, startInHours: number, durationMinutes = 30): Promise<void> {
    await this.h.owner.query(
      `UPDATE appointments SET starts_at = now() + ($2 || ' hours')::interval,
                               ends_at = now() + ($2 || ' hours')::interval + ($3 || ' minutes')::interval
       WHERE uuid = $1`,
      [id, String(startInHours), String(durationMinutes)],
    );
  }

  async eventsOf(orgId: number, type: string, uuid?: string) {
    const all = await this.events(orgId, type);
    return uuid ? all.filter((e) => e.uuid === uuid) : all;
  }
}

/** The next daylight-saving start after `afterMs` in a zone: the first calendar date whose midnight-to-midnight is 23 hours. */
export function nextSpringForward(
  tz: string,
  afterMs: number,
): { before: string; day: string; after: string } {
  const off = (ms: number) => {
    const p: Record<string, number> = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    return (
      Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!) -
      Math.floor(ms / 1000) * 1000
    );
  };
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // Noon UTC to noon UTC: the transition of a western-hemisphere zone then falls inside exactly one step, on the later date.
  const d0 = new Date(afterMs + 2 * 86_400_000);
  let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), 12);
  for (let i = 0; i < 400; i++, t += 86_400_000) {
    if (off(t + 86_400_000) > off(t)) {
      return { before: ymd(t), day: ymd(t + 86_400_000), after: ymd(t + 2 * 86_400_000) };
    }
  }
  throw new Error(`no daylight saving start found for ${tz}`);
}
