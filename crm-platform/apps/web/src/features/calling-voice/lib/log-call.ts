import {
  CALL_MAX_DURATION_SEC,
  CALL_NOTES_MAX,
  type CallLogPrefill,
  type CallOutcome,
  type LogCallInput,
} from '@crm/contracts';

/** Pure helpers of the "Log a call" form: the values a person typed become the request, and what is wrong is named by a stable key. */

export type LogCallProblem = 'noWho' | 'badWhen' | 'futureWhen' | 'badMinutes' | 'noDue' | 'badDue';

export interface LogCallForm {
  contactId?: string;
  phone: string;
  direction: LogCallInput['direction'];
  outcome: CallOutcome;
  /** `YYYY-MM-DDTHH:mm`, the person's own clock (the value of a datetime-local input). */
  when: string;
  /** The length in minutes as typed; empty means not known. */
  minutes: string;
  notes: string;
  followUp: { due: string } | null;
  source?: CallLogPrefill['source'];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date as the value of a datetime-local input, on the person's own clock. */
export const localDateTimeValue = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Tomorrow at nine: where a follow-up starts. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

const instant = (local: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function buildLogCallInput(
  f: LogCallForm,
  now: Date = new Date(),
): { ok: true; input: LogCallInput } | { ok: false; problem: LogCallProblem } {
  const phone = f.phone.trim();
  if (!f.contactId && phone === '') return { ok: false, problem: 'noWho' };

  const when = instant(f.when);
  if (!when) return { ok: false, problem: 'badWhen' };
  if (when.getTime() > now.getTime() + 5 * 60_000) return { ok: false, problem: 'futureWhen' };

  let durationSec = 0;
  if (f.minutes.trim() !== '') {
    const minutes = Number(f.minutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes * 60 > CALL_MAX_DURATION_SEC) {
      return { ok: false, problem: 'badMinutes' };
    }
    durationSec = Math.round(minutes * 60);
  }

  let followUp: LogCallInput['followUp'];
  if (f.followUp) {
    if (f.followUp.due.trim() === '') return { ok: false, problem: 'noDue' };
    const due = instant(f.followUp.due);
    if (!due) return { ok: false, problem: 'badDue' };
    followUp = { dueAt: due.toISOString() };
  }

  const notes = f.notes.trim().slice(0, CALL_NOTES_MAX);
  return {
    ok: true,
    input: {
      ...(f.contactId ? { contactId: f.contactId } : {}),
      ...(phone ? { customerPhone: phone } : {}),
      direction: f.direction,
      outcome: f.outcome,
      startedAt: when.toISOString(),
      durationSec,
      ...(notes ? { notes } : {}),
      source: f.source ?? 'manual',
      ...(followUp ? { followUp } : {}),
      suggestStageNudge: false,
    },
  };
}
