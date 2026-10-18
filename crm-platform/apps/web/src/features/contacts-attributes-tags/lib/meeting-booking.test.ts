import { describe, expect, it } from 'vitest';
import type { ContactMeetingResponse } from '@crm/contracts';
import { isClosedBooking, isLinkedBooking, joinLinkOf } from './meeting-booking';
import { asLink } from './meeting-inline';

const meeting = (over: Partial<ContactMeetingResponse> = {}): ContactMeetingResponse => ({
  id: '6c1e1a7f-0000-4000-8000-000000000001',
  contactId: '294dca7c-5806-4548-9035-dcca9befc7b1',
  title: 'Demo',
  startsAt: '2026-10-20T10:00:00.000Z',
  endsAt: null,
  location: null,
  createdBy: null,
  rowVersion: 1,
  createdAt: '2026-10-16T09:30:00.000Z',
  updatedAt: '2026-10-16T09:30:00.000Z',
  ...over,
});

describe('booking rows', () => {
  it('a row is a linked booking only while its appointment exists', () => {
    expect(isLinkedBooking(meeting())).toBe(false);
    expect(isLinkedBooking(meeting({ source: 'manual', appointmentId: null }))).toBe(false);
    expect(isLinkedBooking(meeting({ source: 'booking', appointmentId: 'a-1' }))).toBe(true);
    // The appointment was deleted: nothing left to manage it on.
    expect(isLinkedBooking(meeting({ source: 'booking', appointmentId: null }))).toBe(false);
  });

  it('only cancelled and declined close a booking', () => {
    for (const status of ['cancelled', 'declined'] as const) {
      expect(isClosedBooking(meeting({ status })), status).toBe(true);
    }
    for (const status of [
      'pending',
      'confirmed',
      'completed',
      'no_show',
      null,
      undefined,
    ] as const) {
      expect(isClosedBooking(meeting({ status })), String(status)).toBe(false);
    }
  });

  it('the join link is the booking link first, then a web address in the place; never a script or a plain place', () => {
    expect(
      joinLinkOf(
        meeting({ joinUrl: 'https://meet.example.com/a', location: 'https://other.test/b' }),
        asLink,
      ),
    ).toEqual({ href: 'https://meet.example.com/a', text: 'https://meet.example.com/a' });
    expect(joinLinkOf(meeting({ location: ' https://other.test/b ' }), asLink)).toEqual({
      href: 'https://other.test/b',
      text: 'https://other.test/b',
    });
    expect(
      joinLinkOf(meeting({ joinUrl: 'javascript:alert(1)', location: 'Room 4' }), asLink),
    ).toBeNull();
    expect(joinLinkOf(meeting({ location: 'Room 4' }), asLink)).toBeNull();
  });
});
