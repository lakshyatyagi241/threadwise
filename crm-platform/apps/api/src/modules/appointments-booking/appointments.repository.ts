import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  AppointmentPaymentStatus,
  AppointmentSource,
  AppointmentStatus,
  BookingLocationType,
  RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { AnswerSnapshot } from './appointment-rules';
import type { EngineBooking, EngineHold } from './slot-engine';
import { isTeamPeer, scopeOwnerCondition } from '../../kernel/rbac/scope';

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface AppointmentRow {
  id: number;
  uuid: string;
  status: AppointmentStatus;
  paymentStatus: AppointmentPaymentStatus;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  /** The keyset key of the list (microsecond precision). */
  startKey: string;
  timezone: string;
  inviteeTimezone: string | null;
  meetUrl: string | null;
  calendarEventId: string | null;
  calendarId: string | null;
  /** Which provider holds the event; null with an event id means Google (every event written before Outlook existed). */
  calendarProvider: 'google' | 'microsoft' | null;
  googleSyncState: 'in_sync' | 'drifted' | 'unreadable' | null;
  googleSyncReason: string | null;
  googleDriftDetectedAt: Date | null;
  googleDriftStartsAt: Date | null;
  googleDriftEndsAt: Date | null;
  googleEventEtag: string | null;
  googlePushedAt: Date | null;
  googlePushedStartsAt: Date | null;
  googlePushedEndsAt: Date | null;
  googlePushedAttendee: string | null;
  googleCheckedAt: Date | null;
  seat: number;
  source: AppointmentSource;
  answers: AnswerSnapshot[];
  /** Encrypted at rest; the service decrypts. */
  notesCipher: string | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  manageTokenCipher: string | null;
  needsReview: boolean;
  checkedInAt: Date | null;
  statusChangedAt: Date;
  cancelledAt: Date | null;
  cancelledBy: 'staff' | 'invitee' | 'system' | null;
  cancelReason: string | null;
  priceMinor: bigint;
  currency: string | null;
  dueNowMinor: bigint;
  depositPaidMinor: bigint;
  feeRecordedMinor: bigint;
  holdExpiresAt: Date | null;
  armedAt: Date;
  /** When the customer tapped Confirm on a reminder; null until they do. */
  customerConfirmedAt: Date | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  bookingTypeId: number | null;
  bookingTypeUuid: string | null;
  bookingTypeName: string | null;
  bookingTypeColor: string | null;
  bookingTypeDuration: number | null;
  bookingTypeLocation: BookingLocationType | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  hostId: number | null;
  hostUuid: string | null;
  hostName: string | null;
  createdById: number | null;
}

const big = (v: unknown): bigint => BigInt((v ?? 0) as string | number);

const toRow = (r: Raw): AppointmentRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  status: r.status as AppointmentStatus,
  paymentStatus: r.payment_status as AppointmentPaymentStatus,
  title: r.title as string,
  description: s(r.description),
  location: s(r.location),
  startsAt: new Date(r.starts_at as string),
  endsAt: new Date(r.ends_at as string),
  startKey: r.start_key as string,
  timezone: r.timezone as string,
  inviteeTimezone: s(r.invitee_timezone),
  meetUrl: s(r.meet_url),
  calendarEventId: s(r.calendar_event_id),
  calendarId: s(r.calendar_id),
  calendarProvider: (r.calendar_provider as AppointmentRow['calendarProvider']) ?? null,
  googleSyncState: (r.google_sync_state as AppointmentRow['googleSyncState']) ?? null,
  googleSyncReason: s(r.google_sync_reason),
  googleDriftDetectedAt: d(r.google_drift_detected_at),
  googleDriftStartsAt: d(r.google_drift_starts_at),
  googleDriftEndsAt: d(r.google_drift_ends_at),
  googleEventEtag: s(r.google_event_etag),
  googlePushedAt: d(r.google_pushed_at),
  googlePushedStartsAt: d(r.google_pushed_starts_at),
  googlePushedEndsAt: d(r.google_pushed_ends_at),
  googlePushedAttendee: s(r.google_pushed_attendee),
  googleCheckedAt: d(r.google_checked_at),
  seat: Number(r.seat),
  source: r.source as AppointmentSource,
  answers: Array.isArray(r.answers) ? (r.answers as AnswerSnapshot[]) : [],
  notesCipher: s(r.notes),
  inviteeName: s(r.invitee_name),
  inviteeEmail: s(r.invitee_email),
  inviteePhone: s(r.invitee_phone),
  manageTokenCipher: s(r.manage_token_cipher),
  needsReview: r.needs_review as boolean,
  checkedInAt: d(r.checked_in_at),
  statusChangedAt: new Date(r.status_changed_at as string),
  cancelledAt: d(r.cancelled_at),
  cancelledBy: (r.cancelled_by as AppointmentRow['cancelledBy']) ?? null,
  cancelReason: s(r.cancel_reason),
  priceMinor: big(r.price_minor),
  currency: s(r.currency),
  dueNowMinor: big(r.due_now_minor),
  depositPaidMinor: big(r.deposit_paid_minor),
  feeRecordedMinor: big(r.fee_recorded_minor),
  holdExpiresAt: d(r.hold_expires_at),
  armedAt: new Date(r.armed_at as string),
  customerConfirmedAt: r.customer_confirmed_at ? new Date(r.customer_confirmed_at as string) : null,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  bookingTypeId: n(r.booking_type_id),
  bookingTypeUuid: s(r.type_uuid),
  bookingTypeName: s(r.type_name),
  bookingTypeColor: s(r.type_color),
  bookingTypeDuration: n(r.type_duration),
  bookingTypeLocation: (r.type_location as BookingLocationType | null) ?? null,
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  hostId: n(r.user_id),
  hostUuid: s(r.host_uuid),
  hostName: s(r.host_name),
  createdById: n(r.created_by),
});

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const SELECT = sql`
  SELECT a.*, to_char(a.starts_at at time zone 'UTC', ${sql.raw(ISO)}) AS start_key,
         bt.uuid AS type_uuid, bt.name AS type_name, bt.color AS type_color, bt.duration_minutes AS type_duration,
         bt.location_type AS type_location,
         c.uuid AS contact_uuid, c.name AS contact_name,
         u.uuid AS host_uuid, u.full_name AS host_name
  FROM appointments a
  LEFT JOIN booking_types bt ON bt.org_id = a.org_id AND bt.id = a.booking_type_id
  LEFT JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id
  LEFT JOIN users u ON u.org_id = a.org_id AND u.id = a.user_id`;

/**
 * The record scope of an appointment is a condition on the PEOPLE of the booking: `own` is "I host it or I booked it", `team` adds
 * the people who share a team with me, `all` adds nothing.
 */
export function appointmentScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  return scopeOwnerCondition({ orgId, userId: actorUserId }, scope, [
    sql`a.user_id`,
    sql`a.created_by`,
  ]);
}

/** A filter with every uuid already resolved to the internal id the SQL needs. */
export interface AppointmentFilter {
  q?: string;
  bookingTypeId?: number;
  contactId?: number;
  hostId?: number;
  from?: Date;
  to?: Date;
  needsReview?: boolean;
}

export interface AppointmentListInput {
  filter: AppointmentFilter;
  scope?: SQL;
  window: 'upcoming' | 'past' | 'all';
  status?: AppointmentStatus[];
  order: 'asc' | 'desc';
  cursor?: { key: string; id: number };
  limit: number;
}

const likeEscape = (v: string): string => v.replace(/[\\%_]/g, '\\$&');

function filterConds(orgId: number, f: AppointmentFilter, scope?: SQL): SQL[] {
  const c: SQL[] = [sql`a.org_id = ${orgId}`];
  if (scope) c.push(scope);
  if (f.bookingTypeId !== undefined) c.push(sql`a.booking_type_id = ${f.bookingTypeId}`);
  if (f.contactId !== undefined) c.push(sql`a.contact_id = ${f.contactId}`);
  if (f.hostId !== undefined) c.push(sql`a.user_id = ${f.hostId}`);
  if (f.from) c.push(sql`a.starts_at >= ${f.from.toISOString()}::timestamptz`);
  if (f.to) c.push(sql`a.starts_at < ${f.to.toISOString()}::timestamptz`);
  if (f.needsReview !== undefined) c.push(sql`a.needs_review = ${f.needsReview}`);
  if (f.q) {
    // The same expression as the trigram index, so the planner can use it.
    c.push(
      sql`(coalesce(a.title, '') || ' ' || coalesce(a.invitee_name, '') || ' ' || coalesce(a.invitee_email, '') || ' ' || coalesce(a.invitee_phone, '')) ILIKE ${`%${likeEscape(f.q)}%`}`,
    );
  }
  return c;
}

export interface NewAppointment {
  bookingTypeId: number | null;
  hostId: number | null;
  createdBy: number | null;
  contactId: number | null;
  conversationId?: number | null;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  inviteeTimezone: string | null;
  status: AppointmentStatus;
  paymentStatus: AppointmentPaymentStatus;
  source: AppointmentSource;
  seat: number;
  answers: AnswerSnapshot[];
  notesCipher: string | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  manageTokenHash: string;
  manageTokenCipher: string;
  priceMinor: bigint;
  currency: string | null;
  dueNowMinor: bigint;
  holdExpiresAt: Date | null;
  calendarId: string | null;
}

/** Column -> value for an update; the service builds it. */
export type AppointmentPatch = Record<string, unknown>;

@Injectable()
export class AppointmentsRepository {
  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<AppointmentRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE a.org_id = ${orgId} AND a.uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE OF a` : sql``}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(
    tx: Tx,
    orgId: number,
    id: number,
    forUpdate = false,
  ): Promise<AppointmentRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE a.org_id = ${orgId} AND a.id = ${id} ${forUpdate ? sql`FOR UPDATE OF a` : sql``}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /**
   * The confirmed bookings that start in [from, to) and have a Google event, least recently looked at first (never looked at first of all):
   * the reconcile's batch. `limit` bounds one pass; the rest is taken by the next.
   */
  async reconcileCandidates(
    tx: Tx,
    orgId: number,
    from: Date,
    to: Date,
    limit: number,
    checkedBefore: Date,
  ): Promise<AppointmentRow[]> {
    // Only what has not been looked at since `checkedBefore`: a pass that finds fewer than `limit` has caught up, so a busy workspace is read
    // once an hour per appointment (not continuously), and a backlog is worked off oldest-checked first.
    const res = await tx.execute(sql`${SELECT}
      WHERE a.org_id = ${orgId} AND a.status = 'confirmed' AND a.calendar_event_id IS NOT NULL
        AND COALESCE(a.calendar_provider, 'google') = 'google'
        AND a.starts_at >= ${from.toISOString()}::timestamptz AND a.starts_at < ${to.toISOString()}::timestamptz
        AND (a.google_checked_at IS NULL OR a.google_checked_at < ${checkedBefore.toISOString()}::timestamptz)
      ORDER BY a.google_checked_at ASC NULLS FIRST, a.starts_at ASC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /**
   * The confirmed bookings that have not ended and start before `to` whose event is NOT in `provider`'s calendar: they have none (made while
   * nothing was connected, or lost with an account that was replaced) or it sits in the other provider. In start order, `limit` at a time,
   * after the `after` cursor so a booking that cannot be written (the pass moves on) is not asked for again within the pass.
   */
  async backfillCandidates(
    tx: Tx,
    orgId: number,
    now: Date,
    to: Date,
    provider: 'google' | 'microsoft',
    limit: number,
    after: { startsAt: Date; id: number } | null,
  ): Promise<Array<{ id: number; uuid: string; startsAt: Date }>> {
    const res = await tx.execute(sql`
      SELECT a.id, a.uuid, a.starts_at FROM appointments a
       WHERE a.org_id = ${orgId} AND a.status = 'confirmed'
         AND a.ends_at > ${now.toISOString()}::timestamptz AND a.starts_at < ${to.toISOString()}::timestamptz
         AND (a.calendar_event_id IS NULL OR COALESCE(a.calendar_provider, 'google') <> ${provider})
         ${after ? sql`AND (a.starts_at, a.id) > (${after.startsAt.toISOString()}::timestamptz, ${after.id})` : sql``}
       ORDER BY a.starts_at ASC, a.id ASC
       LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      startsAt: new Date(r.starts_at as string),
    }));
  }

  /** How many bookings `backfillCandidates` would offer (the same conditions, no cursor). */
  async backfillCount(
    tx: Tx,
    orgId: number,
    now: Date,
    to: Date,
    provider: 'google' | 'microsoft',
  ): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM appointments a
       WHERE a.org_id = ${orgId} AND a.status = 'confirmed'
         AND a.ends_at > ${now.toISOString()}::timestamptz AND a.starts_at < ${to.toISOString()}::timestamptz
         AND (a.calendar_event_id IS NULL OR COALESCE(a.calendar_provider, 'google') <> ${provider})`);
    return Number((res.rows as Raw[])[0]?.n ?? 0);
  }

  /** The reconcile's "looked, nothing new": one statement for the whole pass. The monitoring columns do not bump `row_version`. */
  async markChecked(tx: Tx, orgId: number, ids: number[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE appointments SET google_checked_at = ${at.toISOString()}::timestamptz
       WHERE org_id = ${orgId} AND id = ANY(${sql`ARRAY[${sql.join(
         ids.map((i) => sql`${i}`),
         sql`, `,
       )}]::bigint[]`})`);
  }

  /**
   * The workspace moved to another account of a calendar provider: every upcoming booking's event of that provider is in the OLD account.
   * Forgets the event and everything learned about it (the snapshot of what we wrote, the etag, drift) so nothing is compared with, or
   * reported about, an event that cannot be read any more. The meeting link stays on the booking. Events of the other provider are
   * untouched (an event with no provider recorded is Google's).
   */
  async detachEvents(tx: Tx, orgId: number, provider: 'google' | 'microsoft'): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE appointments SET calendar_event_id = NULL, calendar_id = NULL, calendar_provider = NULL,
             google_sync_state = NULL, google_sync_reason = NULL, google_drift_detected_at = NULL,
             google_drift_starts_at = NULL, google_drift_ends_at = NULL, google_event_etag = NULL,
             google_pushed_at = NULL, google_pushed_starts_at = NULL, google_pushed_ends_at = NULL,
             google_pushed_attendee = NULL, google_checked_at = NULL
       WHERE org_id = ${orgId} AND calendar_event_id IS NOT NULL AND ends_at >= now()
         AND COALESCE(calendar_provider, 'google') = ${provider}
       RETURNING id`);
    return res.rows.length;
  }

  /** The manage token's lookup: by hash, across every organization (the organization is not known before it). */
  async locateByTokenHash(
    tx: Tx,
    hash: string,
  ): Promise<{ orgId: number; uuid: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT org_id, uuid FROM appointments WHERE manage_token_hash = ${hash}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? { orgId: Number(r.org_id), uuid: r.uuid as string } : undefined;
  }

  async list(tx: Tx, orgId: number, input: AppointmentListInput): Promise<AppointmentRow[]> {
    const conds = filterConds(orgId, input.filter, input.scope);
    if (input.status && input.status.length > 0) {
      conds.push(
        sql`a.status IN (${sql.join(
          input.status.map((x) => sql`${x}`),
          sql`, `,
        )})`,
      );
    }
    if (input.window === 'upcoming') {
      conds.push(sql`a.starts_at >= now()`);
      if (!input.status || input.status.length === 0)
        conds.push(sql`a.status IN ('pending', 'confirmed')`);
    } else if (input.window === 'past') {
      conds.push(sql`a.starts_at < now()`);
    }
    const asc = input.order === 'asc';
    if (input.cursor) {
      const key = sql`(date_trunc('microseconds', ${input.cursor.key}::timestamptz))`;
      conds.push(
        asc
          ? sql`(a.starts_at, a.id) > (${key}, ${input.cursor.id})`
          : sql`(a.starts_at, a.id) < (${key}, ${input.cursor.id})`,
      );
    }
    const res = await tx.execute(sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY a.starts_at ${asc ? sql`ASC` : sql`DESC`}, a.id ${asc ? sql`ASC` : sql`DESC`}
      LIMIT ${input.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async counts(
    tx: Tx,
    orgId: number,
    filter: AppointmentFilter,
    scope: SQL | undefined,
    actorUserId: number | null,
  ): Promise<{
    byStatus: Record<string, number>;
    upcoming: number;
    past: number;
    needsReview: number;
    mineUpcoming: number;
  }> {
    const conds = filterConds(orgId, filter, scope);
    const res = await tx.execute(sql`
      SELECT a.status, count(*) AS n,
             count(*) FILTER (WHERE a.status IN ('pending', 'confirmed') AND a.starts_at >= now()) AS upcoming,
             count(*) FILTER (WHERE a.starts_at < now()) AS past,
             count(*) FILTER (WHERE a.needs_review) AS review,
             count(*) FILTER (WHERE a.status IN ('pending', 'confirmed') AND a.starts_at >= now()
                              AND ${actorUserId === null ? sql`false` : sql`a.user_id = ${actorUserId}`}) AS mine
      FROM appointments a WHERE ${sql.join(conds, sql` AND `)} GROUP BY a.status`);
    const out = {
      byStatus: {} as Record<string, number>,
      upcoming: 0,
      past: 0,
      needsReview: 0,
      mineUpcoming: 0,
    };
    for (const r of res.rows as Raw[]) {
      out.byStatus[r.status as string] = Number(r.n);
      out.upcoming += Number(r.upcoming);
      out.past += Number(r.past);
      out.needsReview += Number(r.review);
      out.mineUpcoming += Number(r.mine);
    }
    return out;
  }

  async insert(tx: Tx, orgId: number, v: NewAppointment): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO appointments (org_id, booking_type_id, user_id, created_by, contact_id, conversation_id, title, description, location,
        starts_at, ends_at, timezone, invitee_timezone, status, payment_status, source, seat, answers, notes,
        invitee_name, invitee_email, invitee_phone, manage_token_hash, manage_token_cipher,
        price_minor, currency, due_now_minor, hold_expires_at, calendar_id, provider)
      VALUES (${orgId}, ${v.bookingTypeId}, ${v.hostId}, ${v.createdBy}, ${v.contactId}, ${v.conversationId ?? null}, ${v.title},
        ${v.description}, ${v.location}, ${v.startsAt.toISOString()}::timestamptz, ${v.endsAt.toISOString()}::timestamptz,
        ${v.timezone}, ${v.inviteeTimezone}, ${v.status}, ${v.paymentStatus}, ${v.source}, ${v.seat},
        ${JSON.stringify(v.answers)}::jsonb, ${v.notesCipher}, ${v.inviteeName}, ${v.inviteeEmail}, ${v.inviteePhone},
        ${v.manageTokenHash}, ${v.manageTokenCipher}, ${v.priceMinor.toString()}::bigint, ${v.currency},
        ${v.dueNowMinor.toString()}::bigint, ${v.holdExpiresAt ? v.holdExpiresAt.toISOString() : null}::timestamptz,
        ${v.calendarId}, 'whatsapp')
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Optimistic update: false when the version moved. The touch trigger bumps `row_version`. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number | undefined,
    patch: AppointmentPatch,
  ): Promise<boolean> {
    const cols = Object.keys(patch);
    if (cols.length === 0) return true;
    const sets = cols.map((c) => sql`${sql.raw(`"${c}"`)} = ${patch[c]}`);
    const res = await tx.execute(sql`
      UPDATE appointments SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} ${rowVersion !== undefined ? sql`AND row_version = ${rowVersion}` : sql``}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM appointments WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- the facts the slot engine and the commit read ---------------------------------------------------------------------

  /** Active bookings of a type that can touch [fromMs, toMs] (padded by the caller), optionally leaving one out. */
  async activeBookings(
    tx: Tx,
    orgId: number,
    typeId: number,
    fromMs: number,
    toMs: number,
    exceptId?: number,
  ): Promise<EngineBooking[]> {
    const res = await tx.execute(sql`
      SELECT starts_at, ends_at, seat FROM appointments
      WHERE org_id = ${orgId} AND booking_type_id = ${typeId} AND status IN ('pending', 'confirmed')
        AND ends_at > ${new Date(fromMs).toISOString()}::timestamptz AND starts_at < ${new Date(toMs).toISOString()}::timestamptz
        ${exceptId ? sql`AND id <> ${exceptId}` : sql``}`);
    return (res.rows as Raw[]).map((r) => ({
      startMs: new Date(r.starts_at as string).getTime(),
      endMs: new Date(r.ends_at as string).getTime(),
      seat: Number(r.seat),
    }));
  }

  async liveHolds(
    tx: Tx,
    orgId: number,
    typeId: number,
    fromMs: number,
    toMs: number,
    exceptSessionRef?: string,
  ): Promise<EngineHold[]> {
    const res = await tx.execute(sql`
      SELECT starts_at, ends_at, seats FROM slot_reservations
      WHERE org_id = ${orgId} AND booking_type_id = ${typeId} AND expires_at > now()
        AND ends_at > ${new Date(fromMs).toISOString()}::timestamptz AND starts_at < ${new Date(toMs).toISOString()}::timestamptz
        ${exceptSessionRef ? sql`AND session_ref <> ${exceptSessionRef}` : sql``}`);
    return (res.rows as Raw[]).map((r) => ({
      startMs: new Date(r.starts_at as string).getTime(),
      endMs: new Date(r.ends_at as string).getTime(),
      seats: Number(r.seats),
    }));
  }

  /** Active bookings (pending, confirmed, completed) that start inside [fromMs, toMs): the plan cap's count. */
  async countInRange(tx: Tx, orgId: number, fromMs: number, toMs: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM appointments
      WHERE org_id = ${orgId} AND status IN ('pending', 'confirmed', 'completed')
        AND starts_at >= ${new Date(fromMs).toISOString()}::timestamptz AND starts_at < ${new Date(toMs).toISOString()}::timestamptz`);
    return Number((res.rows[0] as Raw).n);
  }

  /** Active bookings of the type whose seat is above a smaller capacity (a capacity cut would strand them). */
  async seatsAbove(tx: Tx, orgId: number, typeId: number, capacity: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM appointments WHERE org_id = ${orgId} AND booking_type_id = ${typeId}
        AND status IN ('pending', 'confirmed') AND ends_at > now() AND seat > ${capacity} LIMIT 1`);
    return res.rows.length > 0;
  }

  /** Per-(org, type) mutual exclusion for the length of the transaction: the booking commit's critical section. */
  async lockType(tx: Tx, orgId: number, typeId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`appt:${orgId}`}), hashtext(${`type:${typeId}`}))`,
    );
  }

  async activeSameSlot(
    tx: Tx,
    orgId: number,
    typeId: number,
    startsAt: Date,
    inviteeEmail: string | null,
    inviteePhone: string | null,
  ): Promise<AppointmentRow | undefined> {
    if (!inviteeEmail && !inviteePhone) return undefined;
    const res = await tx.execute(sql`${SELECT}
      WHERE a.org_id = ${orgId} AND a.booking_type_id = ${typeId} AND a.starts_at = ${startsAt.toISOString()}::timestamptz
        AND a.status IN ('pending', 'confirmed')
        AND ((${inviteeEmail}::text IS NOT NULL AND lower(a.invitee_email) = lower(${inviteeEmail}::text))
          OR (${inviteePhone}::text IS NOT NULL AND a.invitee_phone = ${inviteePhone}::text))
      LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  // --- reservations ---------------------------------------------------------------------------------------------------------

  async insertReservation(
    tx: Tx,
    orgId: number,
    v: {
      typeId: number;
      startsAt: Date;
      endsAt: Date;
      sessionRef: string;
      channel: string;
      expiresAt: Date;
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO slot_reservations (org_id, booking_type_id, starts_at, ends_at, session_ref, channel, seats, expires_at)
      VALUES (${orgId}, ${v.typeId}, ${v.startsAt.toISOString()}::timestamptz, ${v.endsAt.toISOString()}::timestamptz,
              ${v.sessionRef}, ${v.channel}, 1, ${v.expiresAt.toISOString()}::timestamptz)
      RETURNING id, uuid`);
    const r = res.rows[0] as Raw;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  async deleteReservation(tx: Tx, orgId: number, uuid: string): Promise<void> {
    await tx.execute(
      sql`DELETE FROM slot_reservations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
  }

  // --- lookups ------------------------------------------------------------------------------------------------------------

  async resolveContact(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<
    | {
        id: number;
        ownerId: number | null;
        createdBy: number | null;
        name: string | null;
        email: string | null;
        phone: string | null;
      }
    | undefined
  > {
    const res = await tx.execute(
      sql`SELECT id, owner_id, created_by, name, email, phone FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          ownerId: n(r.owner_id),
          createdBy: n(r.created_by),
          name: s(r.name),
          email: s(r.email),
          phone: s(r.phone),
        }
      : undefined;
  }

  async resolveContactUuid(tx: Tx, orgId: number, id: number): Promise<string | undefined> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res.rows[0] as Raw | undefined)?.uuid as string | undefined;
  }

  async resolveContactIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? Number(r.id) : undefined;
  }

  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? Number(r.id) : undefined;
  }

  async isInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    userId: number,
    /** `team_and_below`: a person in a team under one of the actor's teams counts too. */
    below = false,
  ): Promise<boolean> {
    return isTeamPeer(tx, orgId, actorUserId, userId, below);
  }
}
