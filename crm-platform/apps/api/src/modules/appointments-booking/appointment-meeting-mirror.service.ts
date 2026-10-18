import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactMeetingsRepository, ContactsRepository } from '../crm';
import type { BookedMeetingValues, ContactMeetingRow } from '../crm';
import type { AppointmentRow } from './appointments.repository';

/** `audit_log.module` and the aggregate of the events: the same as the typed-in meetings the crm module writes. */
const MEETING_MODULE = 'contact_meetings';

/**
 * Keeps a contact's Meetings tab in step with its bookings (BL-281, phase P1).
 *
 * An appointment that has a contact has ONE meeting row (`source = 'booking'`, `appointment_id` set; the unique index on
 * (org_id, appointment_id) makes a second impossible). Every place that writes an appointment calls `sync` with the row as it is
 * AFTER the write, inside the same transaction, so the appointment and its mirror commit together or not at all and no booking source
 * (link, chat, manual, api) can skip it.
 *
 *   - no contact on the appointment: no row; it appears when a contact is linked later (`AppointmentsService.update`).
 *   - the contact changes: the row moves to the new contact, or goes when the contact is removed.
 *   - title, start, end, place or join link change: the row follows.
 *   - the booking is cancelled, declined, completed or no-show: the row STAYS. Its status is not stored here: the meetings list reads
 *     it from the appointment, so it can never disagree.
 *   - the appointment is deleted: the row goes with it (`forget`).
 *
 * Direction of dependency: this module imports the crm module (never the reverse), so the mirror writes through crm's exported
 * repository and the crm side reads the appointment's id, status and people by joining the table.
 *
 * Audit and outbox: a created, changed or removed row writes `contact_meetings` audit and `contact_meeting.*` events whose payload names
 * `source: 'booking'` and the appointment's id. The same booking also fires `appointment.*` (which is what flows and reminders
 * subscribe to); a consumer of `contact_meeting.*` must skip `source: 'booking'` or it would act on one booking twice. Nothing in the
 * platform consumes `contact_meeting.*` today.
 */
@Injectable()
export class AppointmentMeetingMirror {
  constructor(
    private readonly meetings: ContactMeetingsRepository,
    private readonly contacts: ContactsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Brings the meeting row of `row` in line with it. `row` is the appointment after the write; idempotent. */
  async sync(tx: Tx, orgId: number, row: AppointmentRow): Promise<void> {
    const existing = await this.meetings.findByAppointment(tx, orgId, row.id);

    if (row.contactId === null) {
      if (existing) await this.remove(tx, orgId, row, existing);
      return;
    }
    const wanted: BookedMeetingValues = {
      contactId: row.contactId,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      location: row.location,
      joinUrl: row.meetUrl,
    };

    if (!existing) {
      const made = await this.meetings.upsertFromBooking(tx, orgId, row.id, {
        ...wanted,
        createdBy: row.createdById,
      });
      await this.contacts.bumpLastActivity(tx, orgId, row.contactId);
      await this.write(tx, orgId, row, made.id, made.uuid, made.created ? 'created' : 'updated');
      return;
    }

    const delta = changes(existing, wanted);
    if (Object.keys(delta).length === 0) return;
    await this.meetings.updateFromBooking(tx, orgId, existing.id, wanted);
    if (delta.contact) await this.contacts.bumpLastActivity(tx, orgId, row.contactId);
    await this.write(tx, orgId, row, existing.id, existing.uuid, 'updated', delta);
  }

  /** The appointment is going away: its mirror goes with it (the foreign key would otherwise leave an unlinked orphan). */
  async forget(tx: Tx, orgId: number, row: AppointmentRow): Promise<void> {
    const existing = await this.meetings.findByAppointment(tx, orgId, row.id);
    if (existing) await this.remove(tx, orgId, row, existing);
  }

  private async remove(
    tx: Tx,
    orgId: number,
    row: AppointmentRow,
    existing: ContactMeetingRow,
  ): Promise<void> {
    await this.meetings.deleteById(tx, orgId, existing.id);
    await this.write(tx, orgId, row, existing.id, existing.uuid, 'deleted');
  }

  private async write(
    tx: Tx,
    orgId: number,
    appointment: AppointmentRow,
    meetingId: number,
    meetingUuid: string,
    kind: 'created' | 'updated' | 'deleted',
    delta?: Record<string, { old: unknown; new: unknown }>,
  ): Promise<void> {
    await this.inContext(orgId, appointment.uuid, async () => {
      await this.audit.record(tx, {
        module: MEETING_MODULE,
        recordId: meetingId,
        action: kind === 'created' ? 'insert' : kind === 'updated' ? 'update' : 'delete',
        delta,
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: MEETING_MODULE,
        aggregateId: meetingId,
        eventType: `contact_meeting.${kind}`,
        payload: {
          uuid: meetingUuid,
          source: 'booking',
          appointmentId: appointment.uuid,
        },
      });
    });
  }

  /** The audit trail needs a request context; a worker (the calendar writer, the sweeps) has none, so it acts as the system. */
  private inContext<T>(orgId: number, appointmentUuid: string, fn: () => Promise<T>): Promise<T> {
    if (RequestContextStore.peek()) return fn();
    return RequestContextStore.run(
      {
        requestId: `meeting-mirror-${appointmentUuid}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}

/**
 * What differs between a mirror row and what its appointment says now (the audit delta; empty when nothing does). Times and internal
 * ids are recorded as they are; the title, place and join link are personal data (a name, an address, a link that opens the call), so
 * the trail says THAT they changed, never what they said.
 */
function changes(
  row: ContactMeetingRow,
  want: BookedMeetingValues,
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  const time = (d: Date | null) => d?.getTime() ?? null;
  if (row.contactId !== want.contactId) out.contact = { old: row.contactId, new: want.contactId };
  if (row.title !== want.title) out.title = { old: 'changed', new: 'changed' };
  if (time(row.startsAt) !== time(want.startsAt)) {
    out.startsAt = { old: row.startsAt?.toISOString() ?? null, new: want.startsAt.toISOString() };
  }
  if (time(row.endsAt) !== time(want.endsAt)) {
    out.endsAt = { old: row.endsAt?.toISOString() ?? null, new: want.endsAt.toISOString() };
  }
  if (row.location !== want.location) out.location = { old: 'changed', new: 'changed' };
  if (row.joinUrl !== want.joinUrl) out.joinUrl = { old: 'changed', new: 'changed' };
  return out;
}
