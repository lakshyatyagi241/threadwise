import type { NotificationType } from '@crm/contracts';
import { groupLabel } from './group-notification-rules';

/**
 * Who is told, and what the bell row says, for the groups of a PERSONAL WhatsApp number (the unofficial engine): people asking to join,
 * and the number being removed from a group. The sibling of `group-notification-rules.ts` (official groups, BL-099). Pure functions over
 * ids and facts already read from the database, so every rule is unit-tested without one.
 *
 * Privacy: the events carry no phone number and neither do these rows or their pushes. A join request is a count; a group is named by its
 * subject (the group's own name). The invite code never appears. The rows are in-app only by default (`push` is off in the catalogue).
 */

/** The permission that lets a person act on a personal group's join requests; the audience of both notifications. */
export const PERM_DEVICE_GROUPS_MANAGE = 'wa.groups.manage';

export const DEVICE_GROUP_NOTIFY_EVENTS = [
  'whatsapp.device_group.join_request',
  'whatsapp.device_group.left',
] as const;

export type DeviceGroupNoticeType = Extract<
  NotificationType,
  'device_group_join_request' | 'device_group_removed'
>;

/**
 *  - `requested`  new people asked to join (`handled` absent or null): the collapsing row grows by `added`;
 *  - `settled`    the queue shrank (approved, rejected, revoked): no new row, the unread request rows close when it is empty;
 *  - `removed`    someone else removed the number (`removed: true`); a number that left on its own, or that left through the screen, is not news.
 */
export type DeviceGroupNotice =
  | { kind: 'requested'; type: 'device_group_join_request'; count: number }
  | { kind: 'settled' }
  | { kind: 'removed'; type: 'device_group_removed' };

const whole = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

export function deviceGroupNoticeFor(
  eventType: string,
  payload: Record<string, unknown>,
): DeviceGroupNotice | null {
  if (eventType === 'whatsapp.device_group.join_request') {
    const handled = payload.handled;
    if (handled === undefined || handled === null) {
      const count = whole(payload.added) ?? 1;
      return count > 0 ? { kind: 'requested', type: 'device_group_join_request', count } : null;
    }
    return typeof handled === 'string' ? { kind: 'settled' } : null;
  }
  if (eventType === 'whatsapp.device_group.left') {
    return payload.removed === true ? { kind: 'removed', type: 'device_group_removed' } : null;
  }
  return null;
}

/** One unread join-request row per person and group: the next requests raise its count. */
export const deviceGroupRequestCollapseKey = (groupUuid: string): string => `dgjr:${groupUuid}`;
/** Ends in the outbox event id, which the collapsing writer reads back to tell a redelivery from a new event. */
export const deviceGroupRequestKey = (groupUuid: string, eventId: string): string =>
  `dgjr:${groupUuid}:${eventId}`;
export const deviceGroupRemovedKey = (groupUuid: string, eventId: string): string =>
  `dgrm:${groupUuid}:${eventId}`;

export function deviceGroupRequestCopy(
  subject: string | null | undefined,
  count: number,
): { title: string; body: string } {
  const name = groupLabel(subject);
  return count > 1
    ? {
        title: `${count} people want to join ${name}`,
        body: 'Open Groups to approve or reject them.',
      }
    : {
        title: `Someone wants to join ${name}`,
        body: 'Open Groups to approve or reject the request.',
      };
}

/** A removal is a useful abuse or ban signal, so the row names the group and the number's label (never its digits). */
export function deviceGroupRemovedCopy(
  subject: string | null | undefined,
  deviceName: string | null | undefined,
): { title: string; body: string } {
  const name = groupLabel(subject);
  const line = (deviceName ?? '').replace(/\s+/g, ' ').trim();
  return {
    title: `Removed from ${name}`,
    body: line
      ? `${line} was removed from this group by someone else. The conversation is kept, read-only.`
      : 'This number was removed from the group by someone else. The conversation is kept, read-only.',
  };
}
