import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AppointmentStatus,
  type ContactMeetingSource,
  type ContactMeetingWindow,
} from '@crm/contracts';
import { schema, type Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor } from '../../../common/pagination/cursor';

const { appointments, contactMeetings, contacts, users } = schema;

export interface ContactMeetingRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string | null;
  source: ContactMeetingSource;
  /** Internal id of the appointment this row mirrors (null when typed in, or when the appointment was deleted). */
  appointmentId: number | null;
  appointmentUuid: string | null;
  /** Read from the appointment on every list/read: a meeting row never stores it. */
  appointmentStatus: AppointmentStatus | null;
  /** Host and booker of the appointment: what the caller's `record.appointments.update` scope is judged against. */
  appointmentHostId: number | null;
  appointmentCreatedBy: number | null;
  joinUrl: string | null;
  createdBy: number | null;
  createdByUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A list row plus the two microsecond-exact keys its cursor is made of (only the `when` lists read them). */
export interface ContactMeetingListRow extends ContactMeetingRow {
  sortKey: string;
  createdKey: string;
}

/** What a booking contributes to its mirrored meeting. */
export interface BookedMeetingValues {
  contactId: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  joinUrl: string | null;
}

const MICROS_ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** The appointment statuses that no longer hold a place in the calendar. */
const CLOSED = sql`('cancelled', 'declined')`;

/** Cursor of a `when` list: sort key | created_at | id, each exact to the microsecond. */
function encodeWindowCursor(row: ContactMeetingListRow): string {
  return Buffer.from(`${row.sortKey}|${row.createdKey}|${row.id}`, 'utf8').toString('base64url');
}

function decodeWindowCursor(raw: string): { sortKey: string; createdKey: string; id: number } {
  const [sortKey, createdKey, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const n = Number.parseInt(id ?? '', 10);
  const okKey = (v: string | undefined) =>
    v === '-infinity' || (!!v && !Number.isNaN(Date.parse(v)));
  if (!okKey(sortKey) || !createdKey || Number.isNaN(Date.parse(createdKey)) || Number.isNaN(n)) {
    throw new Error('malformed');
  }
  return { sortKey: sortKey!, createdKey, id: n };
}

/** Data access for `contact_meetings` — the detail page's Meetings sub-tab. */
@Injectable()
export class ContactMeetingsRepository {
  private selection() {
    return {
      id: contactMeetings.id,
      uuid: contactMeetings.uuid,
      contactId: contactMeetings.contactId,
      contactUuid: contacts.uuid,
      title: contactMeetings.title,
      startsAt: contactMeetings.startsAt,
      endsAt: contactMeetings.endsAt,
      location: contactMeetings.location,
      source: contactMeetings.source,
      appointmentId: contactMeetings.appointmentId,
      appointmentUuid: appointments.uuid,
      appointmentStatus: appointments.status,
      appointmentHostId: appointments.userId,
      appointmentCreatedBy: appointments.createdBy,
      joinUrl: contactMeetings.joinUrl,
      createdBy: contactMeetings.createdBy,
      createdByUuid: users.uuid,
      rowVersion: contactMeetings.rowVersion,
      createdAt: contactMeetings.createdAt,
      updatedAt: contactMeetings.updatedAt,
    };
  }

  private baseQuery(tx: Tx) {
    return this.baseQueryWith(tx, {});
  }

  private baseQueryWith<E extends Record<string, SQL<string>>>(tx: Tx, extra: E) {
    return tx
      .select({ ...this.selection(), ...extra })
      .from(contactMeetings)
      .innerJoin(
        contacts,
        and(eq(contacts.orgId, contactMeetings.orgId), eq(contacts.id, contactMeetings.contactId)),
      )
      .leftJoin(
        users,
        and(eq(users.orgId, contactMeetings.orgId), eq(users.id, contactMeetings.createdBy)),
      )
      .leftJoin(
        appointments,
        and(
          eq(appointments.orgId, contactMeetings.orgId),
          eq(appointments.id, contactMeetings.appointmentId),
        ),
      );
  }

  /**
   * Without `when`: the original list, most recently logged first, paged by (created_at, id).
   *
   * With `when`, ordered by the meeting's own start, with the logging time and id as tie-breaks, so a page boundary never drops or
   * repeats a row that shares a start. `upcoming` is still to come (the end, or the start when there is no end, is not past; a booking
   * the appointment closed - cancelled or declined - is not still to come), soonest first. `past` is every other dated row, latest first.
   * `all` is every row, latest start first, rows with no start last.
   */
  async listByContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    filter: { limit: number; cursor?: string; when?: ContactMeetingWindow },
  ): Promise<ContactMeetingRow[] | ContactMeetingListRow[]> {
    const conditions: SQL[] = [
      eq(contactMeetings.orgId, orgId),
      eq(contactMeetings.contactId, contactId),
    ];
    if (!filter.when) {
      if (filter.cursor) {
        const cursor = decodeCursor(filter.cursor);
        conditions.push(
          or(
            lt(contactMeetings.createdAt, cursor.createdAt),
            and(eq(contactMeetings.createdAt, cursor.createdAt), lt(contactMeetings.id, cursor.id)),
          )!,
        );
      }
      const rows = await this.baseQuery(tx)
        .where(and(...conditions))
        .orderBy(desc(contactMeetings.createdAt), desc(contactMeetings.id))
        .limit(filter.limit + 1);
      return rows as ContactMeetingRow[];
    }

    const stillToCome = sql`(${contactMeetings.startsAt} is not null
      and coalesce(${contactMeetings.endsAt}, ${contactMeetings.startsAt}) >= now()
      and (${appointments.status} is null or ${appointments.status} not in ${CLOSED}))`;
    const ascending = filter.when === 'upcoming';
    if (filter.when === 'upcoming') conditions.push(stillToCome);
    if (filter.when === 'past') {
      conditions.push(sql`(${contactMeetings.startsAt} is not null and not ${stillToCome})`);
    }

    // Rows with no start sort as the earliest instant, so they come last in a descending list (and are never in an upcoming one).
    const sortValue = sql`coalesce(${contactMeetings.startsAt}, '-infinity'::timestamptz)`;
    if (filter.cursor) {
      let c;
      try {
        c = decodeWindowCursor(filter.cursor);
      } catch {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
      }
      const op = ascending ? sql`>` : sql`<`;
      conditions.push(
        sql`(${sortValue}, ${contactMeetings.createdAt}, ${contactMeetings.id}) ${op} (${c.sortKey}::timestamptz, ${c.createdKey}::timestamptz, ${c.id})`,
      );
    }
    const order = ascending
      ? [
          sql`${sortValue} asc`,
          sql`${contactMeetings.createdAt} asc`,
          sql`${contactMeetings.id} asc`,
        ]
      : [
          sql`${sortValue} desc`,
          sql`${contactMeetings.createdAt} desc`,
          sql`${contactMeetings.id} desc`,
        ];
    const rows = await this.baseQueryWith(tx, {
      sortKey: sql<string>`case when ${contactMeetings.startsAt} is null then '-infinity'
        else to_char(${contactMeetings.startsAt} at time zone 'UTC', ${sql.raw(MICROS_ISO)}) end`,
      createdKey: sql<string>`to_char(${contactMeetings.createdAt} at time zone 'UTC', ${sql.raw(MICROS_ISO)})`,
    })
      .where(and(...conditions))
      .orderBy(...order)
      .limit(filter.limit + 1);
    return rows as ContactMeetingListRow[];
  }

  /** The cursor the next page of a `when` list starts after. */
  windowCursorOf(row: ContactMeetingListRow): string {
    return encodeWindowCursor(row);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactMeetingRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.uuid, uuid)),
    );
    return rows[0] as ContactMeetingRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactMeetingRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)),
    );
    return rows[0] as ContactMeetingRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      contactId: number;
      title: string;
      startsAt?: Date | null;
      endsAt?: Date | null;
      location?: string | null;
      createdBy: number | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactMeetings)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        contactId: values.contactId,
        title: values.title,
        startsAt: values.startsAt ?? null,
        endsAt: values.endsAt ?? null,
        location: values.location ?? null,
        createdBy: values.createdBy,
      })
      .returning({ id: contactMeetings.id, uuid: contactMeetings.uuid });
    return row!;
  }

  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(contactMeetings)
      .set(values)
      .where(
        and(
          eq(contactMeetings.orgId, orgId),
          eq(contactMeetings.id, id),
          eq(contactMeetings.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contactMeetings.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactMeetings)
      .where(and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)))
      .returning({ id: contactMeetings.id });
    return result.length > 0;
  }

  // --- the mirror of a booking (written by the appointments-booking module, in the appointment's transaction) ---------------------

  /** The meeting row that mirrors an appointment, if there is one. */
  async findByAppointment(
    tx: Tx,
    orgId: number,
    appointmentId: number,
  ): Promise<ContactMeetingRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.appointmentId, appointmentId)),
    );
    return rows[0] as ContactMeetingRow | undefined;
  }

  /**
   * Makes the mirror row for an appointment. The unique index on (org_id, appointment_id) is the guard against a second row: two
   * writers racing here (a booking and the back-fill) end as one row, and the loser updates what the winner wrote.
   * Returns whether this call created it.
   */
  async upsertFromBooking(
    tx: Tx,
    orgId: number,
    appointmentId: number,
    v: BookedMeetingValues & { createdBy: number | null },
  ): Promise<{ id: number; uuid: string; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO contact_meetings
        (org_id, uuid, contact_id, title, starts_at, ends_at, location, join_url, source, appointment_id, created_by)
      VALUES
        (${orgId}, gen_random_uuid(), ${v.contactId}, ${v.title}, ${v.startsAt.toISOString()}::timestamptz,
         ${v.endsAt.toISOString()}::timestamptz, ${v.location}, ${v.joinUrl}, 'booking', ${appointmentId}, ${v.createdBy})
      ON CONFLICT (org_id, appointment_id) WHERE appointment_id IS NOT NULL
      DO UPDATE SET contact_id = EXCLUDED.contact_id, title = EXCLUDED.title, starts_at = EXCLUDED.starts_at,
                    ends_at = EXCLUDED.ends_at, location = EXCLUDED.location, join_url = EXCLUDED.join_url
      RETURNING id, uuid, (xmax = 0) AS created`);
    const r = res.rows[0] as { id: string | number; uuid: string; created: boolean };
    return { id: Number(r.id), uuid: r.uuid, created: r.created };
  }

  /** Brings an existing mirror row in line with its appointment. */
  async updateFromBooking(
    tx: Tx,
    orgId: number,
    id: number,
    v: BookedMeetingValues,
  ): Promise<void> {
    await tx
      .update(contactMeetings)
      .set({
        contactId: v.contactId,
        title: v.title,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        location: v.location,
        joinUrl: v.joinUrl,
      })
      .where(and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)));
  }

  /**
   * The back-fill's insert: a row for each of the next `limit` appointments (after `afterAppointmentId`, every workspace) that has a
   * contact, is not cancelled or declined and has no row yet, taking the values from the appointment itself. `ON CONFLICT DO NOTHING`
   * on the unique index makes a repeat (or a booking writing at the same moment) harmless. Needs a privileged transaction.
   */
  async backfillBatch(tx: Tx, afterAppointmentId: number, limit: number): Promise<BackfillBatch> {
    const res = await tx.execute(sql`
      WITH batch AS (
        SELECT a.org_id, a.id, a.contact_id, a.title, a.starts_at, a.ends_at, a.location, a.meet_url, a.created_by, a.created_at
        FROM appointments a
        WHERE a.id > ${afterAppointmentId}
          AND a.contact_id IS NOT NULL
          AND a.status NOT IN ('cancelled', 'declined')
          AND NOT EXISTS (SELECT 1 FROM contact_meetings m WHERE m.org_id = a.org_id AND m.appointment_id = a.id)
        ORDER BY a.id
        LIMIT ${limit}
      ), ins AS (
        INSERT INTO contact_meetings
          (org_id, uuid, contact_id, title, starts_at, ends_at, location, join_url, source, appointment_id, created_by, created_at)
        SELECT b.org_id, gen_random_uuid(), b.contact_id, b.title, b.starts_at, b.ends_at, b.location, b.meet_url, 'booking', b.id,
               b.created_by, b.created_at
        FROM batch b
        WHERE EXISTS (SELECT 1 FROM contacts c WHERE c.org_id = b.org_id AND c.id = b.contact_id)
        ON CONFLICT (org_id, appointment_id) WHERE appointment_id IS NOT NULL DO NOTHING
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM batch)::int AS scanned,
             (SELECT count(*) FROM ins)::int AS written,
             (SELECT max(id) FROM batch) AS last_id`);
    const r = res.rows[0] as { scanned: number; written: number; last_id: string | number | null };
    return {
      scanned: Number(r.scanned),
      written: Number(r.written),
      lastId: r.last_id === null ? null : Number(r.last_id),
    };
  }

  /** Sets (or clears) the address that joins the call. Written by the meeting-conferencing module after a provider answered. */
  async setJoinUrl(tx: Tx, orgId: number, id: number, joinUrl: string | null): Promise<void> {
    await tx
      .update(contactMeetings)
      .set({ joinUrl })
      .where(and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)));
  }
}

export interface BackfillBatch {
  scanned: number;
  written: number;
  /** The largest appointment id looked at; null when there was nothing left. */
  lastId: number | null;
}
