import { isOutsideBusinessHours } from '../../common/business-hours';

/**
 * The arithmetic of the waiting queue's timers (Auto-assignment > Waiting queue). Pure: no database, no clock of its own.
 *
 * A timer counts the minutes a chat has waited, and only the minutes the destination team is OPEN: a chat that arrives on Friday evening
 * for a team that closes at 18:00 has not "waited 30 minutes" on Monday at 09:05. A team with no opening hours is always open, and so is
 * a chat with no team. The clock starts when the chat entered the queue (`conversations.handling_since`) and is not restarted when the
 * chat is offered to another team: the customer has been waiting all that time, whoever's queue it sits in.
 */

/** Past this many minutes of real time the open-hours walk looks at every 5th minute (a chat that has waited days needs no exact count). */
const COARSE_AFTER_MINUTES = 3 * 24 * 60;
const COARSE_STEP = 5;

export interface TeamOpening {
  hours: unknown;
  timezone: string | null;
}

/**
 * Minutes waited between `since` and `now`, counting only open time, capped at `needed` (the walk stops as soon as the answer is known,
 * which bounds the work to the longest timer, a day). `team` null or without hours: every minute counts.
 */
export function waitedOpenMinutes(
  since: Date,
  now: Date,
  team: TeamOpening | null,
  needed: number,
): number {
  const elapsed = Math.floor((now.getTime() - since.getTime()) / 60_000);
  if (elapsed <= 0) return 0;
  if (!team || team.hours === null || team.hours === undefined) return Math.min(elapsed, needed);
  const step = elapsed > COARSE_AFTER_MINUTES ? COARSE_STEP : 1;
  let open = 0;
  // Minute m is the one that starts m minutes after `since`: it counts when the team is open at its start.
  for (let m = 0; m < elapsed; m += step) {
    const at = new Date(since.getTime() + m * 60_000);
    if (!isOutsideBusinessHours(team.hours, team.timezone ?? 'UTC', at)) {
      open += Math.min(step, elapsed - m);
      if (open >= needed) return needed;
    }
  }
  return Math.min(open, needed);
}

export type QueueStep = 'remind' | 'offer' | 'final';

export interface TimerConfig {
  remindMinutes: number | null;
  overflowMinutes: number | null;
  overflowTeamId: number | null;
  unclaimedMinutes: number | null;
  unclaimedAction: 'keep' | 'message' | 'bot';
}

export interface TimerProgress {
  remindedAt: Date | null;
  offeredAt: Date | null;
  finalAt: Date | null;
}

/** The longest timer that has not run yet: how many open minutes the walk has to count to decide every step. */
export function longestPending(cfg: TimerConfig, done: TimerProgress): number {
  const pending: number[] = [];
  if (cfg.remindMinutes !== null && done.remindedAt === null) pending.push(cfg.remindMinutes);
  if (cfg.overflowMinutes !== null && cfg.overflowTeamId !== null && done.offeredAt === null)
    pending.push(cfg.overflowMinutes);
  if (cfg.unclaimedMinutes !== null && cfg.unclaimedAction !== 'keep' && done.finalAt === null)
    pending.push(cfg.unclaimedMinutes);
  return pending.length === 0 ? 0 : Math.max(...pending);
}

/** Which steps are due after `waited` open minutes, in the order they run (remind, offer, final). Each runs once: `done` says which did. */
export function dueSteps(cfg: TimerConfig, done: TimerProgress, waited: number): QueueStep[] {
  const out: QueueStep[] = [];
  if (cfg.remindMinutes !== null && done.remindedAt === null && waited >= cfg.remindMinutes)
    out.push('remind');
  if (
    cfg.overflowMinutes !== null &&
    cfg.overflowTeamId !== null &&
    done.offeredAt === null &&
    waited >= cfg.overflowMinutes
  )
    out.push('offer');
  if (
    cfg.unclaimedMinutes !== null &&
    cfg.unclaimedAction !== 'keep' &&
    done.finalAt === null &&
    waited >= cfg.unclaimedMinutes
  )
    out.push('final');
  return out;
}

/** `{{name}}`-style variables of the message to the customer. An unknown one renders empty, as everywhere else in the product. */
export function renderQueueMessage(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_, k: string) => vars[k.toLowerCase()] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** The names the message can use (documented in the settings screen). */
export const QUEUE_MESSAGE_VARIABLES = ['name', 'first_name'] as const;
