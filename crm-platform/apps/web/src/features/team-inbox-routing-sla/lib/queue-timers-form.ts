import {
  AWAY_MAX_MINUTES,
  QUEUE_TIMER_MAX_MINUTES,
  type AwayRules,
  type QueueTimers,
  type QueueUnclaimedAction,
} from '@crm/contracts';

/** The Waiting queue section as the person edits it: three optional steps and two away rules, each with its minutes. */
export interface QueueForm {
  remind: boolean;
  remindMinutes: string;
  overflow: boolean;
  overflowMinutes: string;
  overflowTeamId: string;
  final: boolean;
  finalMinutes: string;
  finalAction: Exclude<QueueUnclaimedAction, 'keep'>;
  message: string;
  returnAway: boolean;
  autoOffline: boolean;
  autoOfflineMinutes: string;
}

export type QueueProblem =
  | 'remindMinutes'
  | 'overflowMinutes'
  | 'overflowTeam'
  | 'finalMinutes'
  | 'finalMessage'
  | 'offlineMinutes';

export const DEFAULT_AWAY: AwayRules = { returnUnanswered: false, autoOfflineMinutes: null };

const text = (n: number | null, fallback: string) => (n === null ? fallback : String(n));

export function formFromTimers(t: QueueTimers, away: AwayRules = DEFAULT_AWAY): QueueForm {
  return {
    remind: t.remindMinutes !== null,
    remindMinutes: text(t.remindMinutes, '10'),
    overflow: t.overflowMinutes !== null && t.overflowTeamId !== null,
    overflowMinutes: text(t.overflowMinutes, '20'),
    overflowTeamId: t.overflowTeamId ?? '',
    final: t.unclaimedMinutes !== null && t.unclaimedAction !== 'keep',
    finalMinutes: text(t.unclaimedMinutes, '30'),
    finalAction: t.unclaimedAction === 'bot' ? 'bot' : 'message',
    message: t.unclaimedMessage,
    returnAway: away.returnUnanswered,
    autoOffline: away.autoOfflineMinutes !== null,
    autoOfflineMinutes: text(away.autoOfflineMinutes, '30'),
  };
}

const minutesOk = (v: string, max: number = QUEUE_TIMER_MAX_MINUTES): boolean => {
  const n = Number(v);
  return /^\d+$/.test(v.trim()) && n >= 1 && n <= max;
};

/** What stops a save: a step that is on needs sensible minutes, the overflow needs a team, a message needs its text. */
export function queueProblems(f: QueueForm): QueueProblem[] {
  const out: QueueProblem[] = [];
  if (f.remind && !minutesOk(f.remindMinutes)) out.push('remindMinutes');
  if (f.overflow && !minutesOk(f.overflowMinutes)) out.push('overflowMinutes');
  if (f.overflow && f.overflowTeamId === '') out.push('overflowTeam');
  if (f.final && !minutesOk(f.finalMinutes)) out.push('finalMinutes');
  if (f.final && f.finalAction === 'message' && f.message.trim() === '') out.push('finalMessage');
  if (f.autoOffline && !minutesOk(f.autoOfflineMinutes, AWAY_MAX_MINUTES))
    out.push('offlineMinutes');
  return out;
}

/** The request: a step that is off sends its minutes as null (and its companion cleared), so switching one off really switches it off. */
export function toQueueInput(f: QueueForm): QueueTimers {
  return {
    remindMinutes: f.remind ? Number(f.remindMinutes) : null,
    overflowMinutes: f.overflow ? Number(f.overflowMinutes) : null,
    overflowTeamId: f.overflow ? f.overflowTeamId : null,
    unclaimedMinutes: f.final ? Number(f.finalMinutes) : null,
    unclaimedAction: f.final ? f.finalAction : 'keep',
    unclaimedMessage: f.final && f.finalAction === 'message' ? f.message.trim() : '',
  };
}

export function toAwayInput(f: QueueForm): AwayRules {
  return {
    returnUnanswered: f.returnAway,
    autoOfflineMinutes: f.autoOffline ? Number(f.autoOfflineMinutes) : null,
  };
}

export function sameForm(a: QueueForm, b: QueueForm): boolean {
  return (
    JSON.stringify([toQueueInput(a), toAwayInput(a)]) ===
    JSON.stringify([toQueueInput(b), toAwayInput(b)])
  );
}
