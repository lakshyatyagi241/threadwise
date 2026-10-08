import type { NotificationType } from '@crm/contracts';

/**
 * Who is told, and what the bell row says, for the WhatsApp Groups notifications (BL-099, docs/specs/waba-groups-management.md 11 and
 * docs/specs/realtime-notifications.md): people asking to join a group of the business number, and Meta suspending or restoring a group.
 * Pure functions over ids and facts already read from the database, so every rule is unit-tested without one.
 *
 * Privacy: the events carry no phone number and neither do these rows. A join request is a count; a group is named by its subject (the
 * group's own name, which every member already sees). The invite link never appears in a row or a push.
 */

/** The permission that lets a person act on a group's join requests; the audience of every group notification. */
export const PERM_GROUPS_MANAGE = 'waba.groups.manage';
/** The plan feature that gates the Groups screen and, with it, these notifications. */
export const GROUPS_PLAN_FEATURE = 'waba_groups' as const;

export const GROUP_NOTIFY_EVENTS = [
  'whatsapp.group.join_request',
  'whatsapp.group.suspended',
] as const;

export type GroupNoticeType = Extract<
  NotificationType,
  'waba_group_join_request' | 'waba_group_suspended' | 'waba_group_suspension_cleared'
>;

/**
 * What an event stands for:
 *  - `requested`  new people asked to join (`handled` absent or null): the collapsing row grows by `count`;
 *  - `settled`    requests left the queue (approved, rejected, or revoked by the asker): no new row, the pending row is closed when the
 *                 queue is empty;
 *  - `suspended` / `cleared`  the group's flag flipped (`suspended: true|false`).
 */
export type GroupNotice =
  | { kind: 'requested'; type: 'waba_group_join_request'; count: number }
  | { kind: 'settled' }
  | { kind: 'suspended'; type: 'waba_group_suspended' }
  | { kind: 'cleared'; type: 'waba_group_suspension_cleared' };

const whole = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;

export function groupNoticeFor(
  eventType: string,
  payload: Record<string, unknown>,
): GroupNotice | null {
  if (eventType === 'whatsapp.group.join_request') {
    const handled = payload.handled;
    if (handled === undefined || handled === null) {
      const count = whole(payload.count) ?? 1;
      return count > 0 ? { kind: 'requested', type: 'waba_group_join_request', count } : null;
    }
    return typeof handled === 'string' ? { kind: 'settled' } : null;
  }
  if (eventType === 'whatsapp.group.suspended') {
    if (payload.suspended === true) return { kind: 'suspended', type: 'waba_group_suspended' };
    if (payload.suspended === false)
      return { kind: 'cleared', type: 'waba_group_suspension_cleared' };
  }
  return null;
}

/** "Restored" is only news to someone who heard about the suspension in this window. */
export const GROUP_RECOVERY_WINDOW_DAYS = 30;

/** One unread join-request row per person and group: the next requests raise its count. */
export const groupRequestCollapseKey = (groupUuid: string): string => `wgjr:${groupUuid}`;
/** Ends in the outbox event id, which the collapsing writer reads back to tell a redelivery from a new event. */
export const groupRequestKey = (groupUuid: string, eventId: string): string =>
  `wgjr:${groupUuid}:${eventId}`;
export const groupFlagKey = (groupUuid: string, eventId: string): string =>
  `wgs:${groupUuid}:${eventId}`;

const SUBJECT_MAX = 80;

/** The group's name for a title: its subject cut to 80 characters, one line; a group with no subject yet is "a WhatsApp group". */
export function groupLabel(subject: string | null | undefined): string {
  const flat = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return 'a WhatsApp group';
  return flat.length <= SUBJECT_MAX ? flat : `${flat.slice(0, SUBJECT_MAX - 1)}…`;
}

export function groupRequestCopy(
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

export function groupFlagCopy(
  type: 'waba_group_suspended' | 'waba_group_suspension_cleared',
  subject: string | null | undefined,
): { title: string; body: string } {
  const name = groupLabel(subject);
  return type === 'waba_group_suspended'
    ? {
        title: `${name} was suspended`,
        body: 'WhatsApp suspended this group. You cannot message it until they restore it.',
      }
    : {
        title: `${name} is active again`,
        body: 'WhatsApp restored this group. You can message it again.',
      };
}
