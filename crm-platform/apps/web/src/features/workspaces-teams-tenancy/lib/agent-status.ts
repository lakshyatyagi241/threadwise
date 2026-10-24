import type { AgentStatus } from '@crm/contracts';

/**
 * What the status pill, the account-menu row and the Inbox notice say, from the server's answer (`GET /workspace/members/me/availability`).
 * One place so the three never word the same state differently. The words: Available, Away (the person chose it), On leave until <date>,
 * and Away outside working hours (their schedule did it).
 */
export type StatusTone = 'available' | 'away' | 'leave';

export type StatusWord = 'available' | 'away' | 'onLeaveUntil' | 'onLeaveOpen' | 'awayHours';

export interface StatusView {
  tone: StatusTone;
  word: StatusWord;
  /** The last day away, for `onLeaveUntil`. */
  leaveUntil: string | null;
}

type Minimal = Pick<AgentStatus, 'state'> &
  Partial<Pick<AgentStatus, 'reason' | 'leaveUntil' | 'status'>>;

export function statusView(s: Minimal): StatusView {
  // An older answer carries only `status`: online = Available, anything else = Away.
  const available = s.state !== undefined ? s.state === 'available' : s.status === 'online';
  if (available) return { tone: 'available', word: 'available', leaveUntil: null };
  if (s.reason === 'leave') {
    return s.leaveUntil
      ? { tone: 'leave', word: 'onLeaveUntil', leaveUntil: s.leaveUntil }
      : { tone: 'leave', word: 'onLeaveOpen', leaveUntil: null };
  }
  if (s.reason === 'schedule') return { tone: 'away', word: 'awayHours', leaveUntil: null };
  return { tone: 'away', word: 'away', leaveUntil: null };
}

/** The Inbox's "Outside of working hours" notice: Away because of the schedule, and the plan has the automation. */
export function showsOutsideHoursNotice(s: Pick<AgentStatus, 'reason' | 'features'>): boolean {
  return s.reason === 'schedule' && s.features.automation;
}

/** The menu offers the opposite of what the person is now: Available -> "Set as away", anything else -> "Set as available". */
export function nextManualStatus(s: Minimal): 'online' | 'offline' {
  return statusView(s).tone === 'available' ? 'offline' : 'online';
}
