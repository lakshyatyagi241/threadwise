import { z } from 'zod';

/**
 * Age rules (BL-211, spec docs/specs/privacy-and-data-governance.md section 11.10): the pure date arithmetic and the age gate that the
 * form builder, the website chat widget and the flow Ask node share, so one answer is judged the same way everywhere. No I/O, no clock
 * of its own: every function takes `now`.
 *
 * Why the arithmetic looks careful. A birthday is a calendar date and a person lives in some time zone we rarely know. A minor must never
 * lose the flag a day early, so "today" for an age check is the EARLIEST calendar date anywhere on Earth right now (UTC minus 12 hours,
 * Baker Island): the birthday has certainly started for everyone once that date reaches it. A date of birth is accepted up to the LATEST
 * calendar date on Earth (UTC plus 14 hours), so a newborn in Kiribati is not refused.
 */

/** The age treated as the line when nothing else says (a workspace with no profile, or on the generic one). */
export const DEFAULT_MINOR_AGE = 18;
/** A form or a flow may set its own age between these (inclusive): 21 covers a shop that sells to adults only. */
export const MIN_GATE_AGE = 1;
export const MAX_GATE_AGE = 21;
/** A date of birth earlier than this, or an age above `MAX_PLAUSIBLE_AGE`, is a typing mistake. */
export const MIN_BIRTH_YEAR = 1900;
export const MAX_PLAUSIBLE_AGE = 120;

/** How a question asks: a date of birth, a whole-number age, or the box "I confirm I am at least N years old". */
export const AGE_GATE_MODES = ['dob', 'age', 'declaration'] as const;
export const ageGateModeSchema = z.enum(AGE_GATE_MODES);
export type AgeGateMode = z.infer<typeof ageGateModeSchema>;

/**
 * What happens to an under-age answer:
 *  - `block`    nothing is stored; the visitor is told neutrally that this cannot be accepted.
 *  - `flag`     accepted; the contact is flagged as a minor (source `dob`) and the marketing agreement of this submission is not recorded.
 *  - `guardian` as `flag`, and a parent or guardian's name and contact are asked for (forms only).
 */
export const AGE_GATE_ACTIONS = ['block', 'flag', 'guardian'] as const;
export const ageGateActionSchema = z.enum(AGE_GATE_ACTIONS);
export type AgeGateAction = z.infer<typeof ageGateActionSchema>;

/** The age gate of a form or of a widget's intake form. Off by default: nothing asks for an age unless a person turns it on. */
export const ageGateSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: ageGateModeSchema.default('declaration'),
    /** The age a person must have reached. Null: the workspace's minor age (`workspaceMinorAge`). */
    minAge: z.number().int().min(MIN_GATE_AGE).max(MAX_GATE_AGE).nullable().default(null),
    whenUnder: ageGateActionSchema.default('block'),
  })
  .strict();
export type AgeGate = z.infer<typeof ageGateSchema>;

export const OFF_AGE_GATE: AgeGate = {
  enabled: false,
  mode: 'declaration',
  minAge: null,
  whenUnder: 'block',
};

/** The threshold a gate uses: its own, else the workspace's. */
export function gateMinAge(gate: Pick<AgeGate, 'minAge'>, workspaceAge: number): number {
  return gate.minAge ?? workspaceAge;
}

// --- dates ------------------------------------------------------------------------------------------------------------------

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDay {
  y: number;
  m: number;
  d: number;
}

/** `2010-02-30` is not a day; `2010-2-3` is not an ISO day either. */
export function parseIsoDay(raw: unknown): CalendarDay | null {
  if (typeof raw !== 'string') return null;
  const m = ISO_DAY.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
export const isoDay = (c: CalendarDay): string => `${pad(c.y, 4)}-${pad(c.m, 2)}-${pad(c.d, 2)}`;

const HOUR_MS = 3_600_000;
const dayOfInstant = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The earliest calendar date on Earth now: the "today" every age check uses (see the file header). */
export function earliestToday(now: Date): string {
  return dayOfInstant(now.getTime() - 12 * HOUR_MS);
}

/** The latest calendar date on Earth now: a date of birth after it is in the future everywhere. */
export function latestToday(now: Date): string {
  return dayOfInstant(now.getTime() + 14 * HOUR_MS);
}

/** Whole years between a birth day and a day (the birthday counts on its own day). */
export function ageOnDay(birthIso: string, todayIso: string): number {
  const b = parseIsoDay(birthIso)!;
  const t = parseIsoDay(todayIso)!;
  const had = t.m > b.m || (t.m === b.m && t.d >= b.d);
  return t.y - b.y - (had ? 0 : 1);
}

/**
 * A date of birth that can be believed: a real day, not before 1900, not in the future anywhere, and not more than 120 years ago.
 * A 29 February is fine.
 */
export function isPlausibleBirthDate(raw: unknown, now: Date): raw is string {
  const c = parseIsoDay(raw);
  if (!c || c.y < MIN_BIRTH_YEAR) return false;
  const day = isoDay(c);
  if (day > latestToday(now)) return false;
  return ageOnDay(day, latestToday(now)) <= MAX_PLAUSIBLE_AGE;
}

/** `2008-02-29` plus 18 years is 1 March 2026 (a person born on a leap day comes of age on the 1st: the later, never the earlier, day). */
export function addYears(iso: string, years: number): string {
  const c = parseIsoDay(iso)!;
  const y = c.y + years;
  const leapDayMissing = c.m === 2 && c.d === 29 && !isLeap(y);
  return leapDayMissing ? isoDay({ y, m: 3, d: 1 }) : isoDay({ y, m: c.m, d: c.d });
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The same day `years` earlier (29 February to 28 February when the earlier year has none). */
export function subYears(iso: string, years: number): string {
  const c = parseIsoDay(iso)!;
  const y = c.y - years;
  const leapDayMissing = c.m === 2 && c.d === 29 && !isLeap(y);
  return leapDayMissing ? isoDay({ y, m: 2, d: 28 }) : isoDay({ y, m: c.m, d: c.d });
}

/**
 * The birth day a person must have been born ON OR BEFORE to have reached `minAge` right now. Anyone born AFTER it is under `minAge`:
 * the cut-off the SQL filters and the sweep use (`date_of_birth > cutoff`), the same answer as `isUnderAge` for every day.
 */
export function minorBornAfter(minAge: number, now: Date): string {
  return subYears(earliestToday(now), minAge);
}

/** Is a person born on `birthIso` below `minAge` right now? */
export function isUnderAge(birthIso: string, minAge: number, now: Date): boolean {
  return ageOnDay(birthIso, earliestToday(now)) < minAge;
}

/** The day a flag from a date of birth lapses: the birthday on which the person reaches `minAge`. */
export function minorUntilForBirth(birthIso: string, minAge: number): string {
  return addYears(birthIso, minAge);
}

/**
 * The day a flag from a bare age lapses. Someone who says they are N is between N and N+1 years old, so they reach `minAge` at the
 * latest `minAge - N` years from today: the flag is kept until then and never lifted early.
 */
export function minorUntilForAge(age: number, minAge: number, now: Date): string {
  return addYears(earliestToday(now), Math.max(0, minAge - age));
}

/** An age typed or said: a whole number from 0 to 120. `"17"`, `17` and `" 17 "` pass; `17.5`, `"abc"` and `-1` do not. */
export function parseAgeAnswer(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_PLAUSIBLE_AGE) return null;
  if (typeof raw === 'string' && !/^\s*\d{1,3}\s*$/.test(raw)) return null;
  return n;
}

/**
 * A date of birth on the wire: an ISO day that can be believed (see `isPlausibleBirthDate`). Shared by the contact write, the REST v1
 * body and the form builder's answer so every door refuses the same impossible dates.
 */
export const birthDateSchema = z
  .string()
  .trim()
  .refine((v) => isPlausibleBirthDate(v, new Date()), 'must be a real date of birth (YYYY-MM-DD)');

// --- the verdict ------------------------------------------------------------------------------------------------------------

export interface AgeAnswer {
  mode: AgeGateMode;
  /** `dob`: an ISO day. */
  dob?: unknown;
  /** `age`: a whole number. */
  age?: unknown;
  /** `declaration`: the box was ticked. */
  confirmed?: unknown;
}

export type AgeVerdict =
  /** The answer cannot be read (a missing or impossible value). The caller reports the field as invalid, neutrally. */
  | { kind: 'invalid' }
  | {
      kind: 'adult';
      mode: AgeGateMode;
      minAge: number;
      /** `dob` mode only: the birth day to keep on the contact. */
      dob?: string;
    }
  | {
      kind: 'under';
      mode: AgeGateMode;
      minAge: number;
      dob?: string;
      /** When the flag lapses (null for a declaration: nothing is known about the person's real age, so the flag does not lapse by itself). */
      minorUntil: string | null;
    };

/** Judges one answer against `minAge`. Pure: the same answer and clock always give the same verdict. */
export function judgeAgeAnswer(answer: AgeAnswer, minAge: number, now: Date): AgeVerdict {
  switch (answer.mode) {
    case 'dob': {
      if (!isPlausibleBirthDate(answer.dob, now)) return { kind: 'invalid' };
      const dob = isoDay(parseIsoDay(answer.dob)!);
      return isUnderAge(dob, minAge, now)
        ? { kind: 'under', mode: 'dob', minAge, dob, minorUntil: minorUntilForBirth(dob, minAge) }
        : { kind: 'adult', mode: 'dob', minAge, dob };
    }
    case 'age': {
      const age = parseAgeAnswer(answer.age);
      if (age === null) return { kind: 'invalid' };
      return age < minAge
        ? { kind: 'under', mode: 'age', minAge, minorUntil: minorUntilForAge(age, minAge, now) }
        : { kind: 'adult', mode: 'age', minAge };
    }
    case 'declaration':
      return answer.confirmed === true
        ? { kind: 'adult', mode: 'declaration', minAge }
        : { kind: 'under', mode: 'declaration', minAge, minorUntil: null };
  }
}
