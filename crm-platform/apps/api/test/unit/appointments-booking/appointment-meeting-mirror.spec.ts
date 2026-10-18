import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppointmentMeetingMirror } from '../../../src/modules/appointments-booking/appointment-meeting-mirror.service';
import type { AppointmentRow } from '../../../src/modules/appointments-booking/appointments.repository';
import type { ContactMeetingRow } from '../../../src/modules/crm';

const ORG = 7;
const tx = {} as Tx;

const appt = (over: Partial<AppointmentRow> = {}): AppointmentRow =>
  ({
    id: 41,
    uuid: 'a0000000-0000-4000-8000-000000000041',
    contactId: 5,
    title: 'Intro call — Priya',
    startsAt: new Date('2030-01-02T10:00:00.000Z'),
    endsAt: new Date('2030-01-02T10:30:00.000Z'),
    location: 'Room 4',
    meetUrl: 'https://meet.example/abc',
    createdById: 3,
    ...over,
  }) as AppointmentRow;

const mirrored = (over: Partial<ContactMeetingRow> = {}): ContactMeetingRow =>
  ({
    id: 900,
    uuid: 'b0000000-0000-4000-8000-000000000900',
    contactId: 5,
    contactUuid: 'c0000000-0000-4000-8000-000000000005',
    title: 'Intro call — Priya',
    startsAt: new Date('2030-01-02T10:00:00.000Z'),
    endsAt: new Date('2030-01-02T10:30:00.000Z'),
    location: 'Room 4',
    joinUrl: 'https://meet.example/abc',
    source: 'booking',
    appointmentId: 41,
    ...over,
  }) as ContactMeetingRow;

function build(existing?: ContactMeetingRow, created = true) {
  const meetings = {
    findByAppointment: vi.fn().mockResolvedValue(existing),
    upsertFromBooking: vi.fn().mockResolvedValue({ id: 901, uuid: 'new-uuid', created }),
    updateFromBooking: vi.fn().mockResolvedValue(undefined),
    deleteById: vi.fn().mockResolvedValue(true),
  };
  const contacts = { bumpLastActivity: vi.fn().mockResolvedValue(undefined) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { emit: vi.fn().mockResolvedValue(undefined) };
  const mirror = new AppointmentMeetingMirror(
    meetings as never,
    contacts as never,
    audit as never,
    outbox as never,
  );
  return { mirror, meetings, contacts, audit, outbox };
}

describe('AppointmentMeetingMirror.sync', () => {
  it('an appointment with no contact and no row writes nothing', async () => {
    const m = build(undefined);
    await m.mirror.sync(tx, ORG, appt({ contactId: null }));
    expect(m.meetings.upsertFromBooking).not.toHaveBeenCalled();
    expect(m.audit.record).not.toHaveBeenCalled();
    expect(m.outbox.emit).not.toHaveBeenCalled();
  });

  it('a contact removed from the appointment deletes its row and announces the delete with the source and the appointment', async () => {
    const m = build(mirrored());
    await m.mirror.sync(tx, ORG, appt({ contactId: null }));
    expect(m.meetings.deleteById).toHaveBeenCalledWith(tx, ORG, 900);
    expect(m.audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'delete', recordId: 900 }),
    );
    expect(m.outbox.emit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orgId: ORG,
        eventType: 'contact_meeting.deleted',
        payload: expect.objectContaining({ source: 'booking', appointmentId: appt().uuid }),
      }),
    );
  });

  it('a new booking with a contact creates the row from the appointment, bumps the last activity once and announces it once', async () => {
    const m = build(undefined);
    await m.mirror.sync(tx, ORG, appt());
    expect(m.meetings.upsertFromBooking).toHaveBeenCalledWith(tx, ORG, 41, {
      contactId: 5,
      title: 'Intro call — Priya',
      startsAt: new Date('2030-01-02T10:00:00.000Z'),
      endsAt: new Date('2030-01-02T10:30:00.000Z'),
      location: 'Room 4',
      joinUrl: 'https://meet.example/abc',
      createdBy: 3,
    });
    expect(m.contacts.bumpLastActivity).toHaveBeenCalledTimes(1);
    expect(m.outbox.emit).toHaveBeenCalledTimes(1);
    const event = m.outbox.emit.mock.calls[0]![1] as {
      eventType: string;
      payload: Record<string, unknown>;
    };
    expect(event.eventType).toBe('contact_meeting.created');
    expect(event.payload).toEqual({
      uuid: 'new-uuid',
      source: 'booking',
      appointmentId: appt().uuid,
    });
    // The invitee's name is in the title: it does not travel in the event.
    expect(JSON.stringify(event.payload)).not.toContain('Priya');
  });

  it('when a racing writer already made the row, the upsert updates it and says updated, not created', async () => {
    const m = build(undefined, false);
    await m.mirror.sync(tx, ORG, appt());
    expect((m.outbox.emit.mock.calls[0]![1] as { eventType: string }).eventType).toBe(
      'contact_meeting.updated',
    );
  });

  it('a row that already says what the appointment says is left alone: no write, no audit, no event', async () => {
    const m = build(mirrored());
    await m.mirror.sync(tx, ORG, appt());
    expect(m.meetings.updateFromBooking).not.toHaveBeenCalled();
    expect(m.audit.record).not.toHaveBeenCalled();
    expect(m.outbox.emit).not.toHaveBeenCalled();
  });

  it('a closed booking changes nothing here: the status is read from the appointment when listed, never copied', async () => {
    const m = build(mirrored());
    await m.mirror.sync(tx, ORG, appt({ status: 'cancelled' }));
    expect(m.meetings.updateFromBooking).not.toHaveBeenCalled();
    expect(m.meetings.deleteById).not.toHaveBeenCalled();
  });

  it('a moved time and a new join link update the row; the audit holds times but never the title, place or link', async () => {
    const m = build(mirrored());
    await m.mirror.sync(
      tx,
      ORG,
      appt({
        startsAt: new Date('2030-01-03T10:00:00.000Z'),
        endsAt: new Date('2030-01-03T10:30:00.000Z'),
        title: 'Renamed — Priya',
        meetUrl: 'https://meet.example/secret-link',
      }),
    );
    expect(m.meetings.updateFromBooking).toHaveBeenCalledWith(
      tx,
      ORG,
      900,
      expect.objectContaining({
        title: 'Renamed — Priya',
        joinUrl: 'https://meet.example/secret-link',
      }),
    );
    const audit = m.audit.record.mock.calls[0]![1] as {
      action: string;
      delta: Record<string, unknown>;
    };
    expect(audit.action).toBe('update');
    expect(Object.keys(audit.delta).sort()).toEqual(['endsAt', 'joinUrl', 'startsAt', 'title']);
    const text = JSON.stringify(audit.delta);
    expect(text).toContain('2030-01-03T10:00:00.000Z');
    expect(text).not.toContain('Renamed');
    expect(text).not.toContain('secret-link');
    expect(m.contacts.bumpLastActivity).not.toHaveBeenCalled();
  });

  it('a contact change moves the row to the new contact and bumps that contact', async () => {
    const m = build(mirrored());
    await m.mirror.sync(tx, ORG, appt({ contactId: 6 }));
    expect(m.meetings.updateFromBooking).toHaveBeenCalledWith(
      tx,
      ORG,
      900,
      expect.objectContaining({ contactId: 6 }),
    );
    expect(m.contacts.bumpLastActivity).toHaveBeenCalledWith(tx, ORG, 6);
    expect(m.meetings.upsertFromBooking).not.toHaveBeenCalled();
  });

  it('a worker with no request context writes its audit row as the system; a request keeps its own context', async () => {
    const seen: Array<string | undefined> = [];
    const m = build(mirrored({ title: 'old' }));
    m.audit.record.mockImplementation(async () => {
      seen.push(RequestContextStore.peek()?.actorType);
    });
    await m.mirror.sync(tx, ORG, appt());
    await RequestContextStore.run(
      { requestId: 'r', orgId: ORG, actorType: 'user', actorId: 1, userId: 1 },
      async () => {
        const again = build(mirrored({ title: 'old' }));
        again.audit.record.mockImplementation(async () => {
          seen.push(RequestContextStore.peek()?.actorType);
        });
        await again.mirror.sync(tx, ORG, appt());
      },
    );
    expect(seen).toEqual(['system', 'user']);
  });
});

describe('AppointmentMeetingMirror.forget', () => {
  it('removes the row of an appointment that is going away, and does nothing when there is none', async () => {
    const withRow = build(mirrored());
    await withRow.mirror.forget(tx, ORG, appt());
    expect(withRow.meetings.deleteById).toHaveBeenCalledWith(tx, ORG, 900);
    const without = build(undefined);
    await without.mirror.forget(tx, ORG, appt());
    expect(without.meetings.deleteById).not.toHaveBeenCalled();
  });
});
