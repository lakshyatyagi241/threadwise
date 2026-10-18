import type { ContactMeetingResponse } from '@crm/contracts';

/**
 * A meeting row can be the mirror of a booking (an appointment): `source: 'booking'`. Such a row is changed on the appointment, never
 * in the Meetings list, and carries the appointment's current status.
 */

/** The row mirrors a booking that still exists (one whose appointment was deleted is an ordinary row). */
export const isLinkedBooking = (m: ContactMeetingResponse): boolean =>
  m.source === 'booking' && !!m.appointmentId;

/** A booking the appointment closed without it happening: it keeps its row, tagged, and never counts as still to come. */
export const isClosedBooking = (m: ContactMeetingResponse): boolean =>
  m.status === 'cancelled' || m.status === 'declined';

/**
 * Where the call is joined: the booking's own join link, else a web address typed into the place (older rows). `href` is safe to link
 * (http or https only); `text` is what the row shows, as it was written.
 */
export function joinLinkOf(
  m: ContactMeetingResponse,
  asLink: (v: string | null | undefined) => string | null,
): { href: string; text: string } | null {
  const own = asLink(m.joinUrl);
  if (own) return { href: own, text: m.joinUrl!.trim() };
  const placed = asLink(m.location);
  return placed ? { href: placed, text: m.location!.trim() } : null;
}
