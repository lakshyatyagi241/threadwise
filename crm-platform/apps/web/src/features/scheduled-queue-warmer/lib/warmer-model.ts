import {
  warmerProfileInputSchema,
  type WarmerNumber,
  type WarmerProfileInput,
} from '@crm/contracts';

/** The pure half of the warmer screen (TW-SCHED-008 to 012): a number's profile as form text, back to a request, and the rollups. */

export const NUMBER_FIELDS = [
  'dailyBase',
  'stepPct',
  'stepDays',
  'maxDaily',
  'gapMin',
  'gapMax',
  'activeStart',
  'activeEnd',
] as const;
export type NumberField = (typeof NUMBER_FIELDS)[number];

/** The bounds the inputs carry, the same as the contract's. */
export const FIELD_BOUNDS: Record<NumberField, { min: number; max: number }> = {
  dailyBase: { min: 1, max: 5000 },
  stepPct: { min: 0, max: 200 },
  stepDays: { min: 1, max: 60 },
  maxDaily: { min: 1, max: 100000 },
  gapMin: { min: 0, max: 3600 },
  gapMax: { min: 0, max: 3600 },
  activeStart: { min: 0, max: 23 },
  activeEnd: { min: 0, max: 24 },
};

export interface WarmerForm extends Record<NumberField, string> {
  enabled: boolean;
  spintax: boolean;
}

export function profileToForm(p: WarmerProfileInput): WarmerForm {
  return {
    enabled: p.enabled,
    spintax: p.spintax,
    dailyBase: String(p.dailyBase),
    stepPct: String(p.stepPct),
    stepDays: String(p.stepDays),
    maxDaily: String(p.maxDaily),
    gapMin: String(p.gapMin),
    gapMax: String(p.gapMax),
    activeStart: String(p.activeStart),
    activeEnd: String(p.activeEnd),
  };
}

export type FormResult =
  | { ok: true; value: WarmerProfileInput }
  | { ok: false; errors: Partial<Record<NumberField, string>> };

/** The form as the request. A blank or fractional box is an error on that field; the contract's other bounds and rules apply. */
export function formToProfile(f: WarmerForm): FormResult {
  const raw: Record<string, unknown> = { enabled: f.enabled, spintax: f.spintax };
  for (const k of NUMBER_FIELDS) raw[k] = f[k].trim() === '' ? NaN : Number(f[k]);
  const parsed = warmerProfileInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<NumberField, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as NumberField | undefined;
    if (key && (NUMBER_FIELDS as readonly string[]).includes(key) && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return { ok: false, errors };
}

export type Tone = 'success' | 'warning' | 'danger';

/** 70 and up is safe to ramp, 40 to 69 careful, below that risky (the reference's colours). */
export const healthTone = (h: number): Tone =>
  h >= 70 ? 'success' : h >= 40 ? 'warning' : 'danger';

export interface Rollup {
  warming: number;
  connected: number;
  budget: number;
  sent: number;
  avgHealth: number;
}

/** The four tiles: budget and sent count only the numbers that are warming, health averages them all. */
export function rollup(items: WarmerNumber[]): Rollup {
  const on = items.filter((n) => n.profile.enabled);
  return {
    warming: on.length,
    connected: items.length,
    budget: on.reduce((a, n) => a + n.budget, 0),
    sent: on.reduce((a, n) => a + n.sentToday, 0),
    avgHealth: items.length
      ? Math.round(items.reduce((a, n) => a + n.health, 0) / items.length)
      : 0,
  };
}

export type Engine = 'waba' | 'twilio' | 'baileys';
export const engineOf = (e: string): Engine =>
  e === 'waba' ? 'waba' : e === 'twilio' ? 'twilio' : 'baileys';
