import {
  BUSINESS_HOURS_DAY_KEYS,
  businessHoursDaySchema,
  type BusinessHoursDay,
  type BusinessHoursDays,
  type BusinessHoursDayInput,
} from '@crm/contracts';
import { parseBusinessHours } from '../../common/business-hours';

/**
 * Pure rules of the business-hours settings (TW-TIB2-001), kept apart from the service so the rules that decide what is shown and
 * saved are unit-testable without a database.
 */

/** Reference's default: Monday to Friday 09:00-18:00, Saturday and Sunday closed. Shown until a schedule is saved. */
export function defaultBusinessHoursDays(): BusinessHoursDays {
  const day = (enabled: boolean): BusinessHoursDayInput => ({
    enabled,
    from: '09:00',
    to: '18:00',
  });
  return {
    mon: day(true),
    tue: day(true),
    wed: day(true),
    thu: day(true),
    fri: day(true),
    sat: day(false),
    sun: day(false),
  };
}

/**
 * The days as they should be shown: a saved window that is well formed is kept, anything else (a missing day, a malformed time, a
 * closing time not after the opening one) falls back to the default for that day, as Reference's form does.
 */
export function readBusinessHoursDays(raw: unknown): BusinessHoursDays {
  const stored = parseBusinessHours(raw)?.days ?? {};
  const fallback = defaultBusinessHoursDays();
  const out = {} as BusinessHoursDays;
  for (const key of BUSINESS_HOURS_DAY_KEYS) {
    const parsed = businessHoursDaySchema.safeParse(stored[key]);
    out[key] = parsed.success ? parsed.data : fallback[key];
  }
  return out;
}

/**
 * Who may change the workspace time zone (Reference: the owner only; anyone else's value is ignored on save). A workspace that names no
 * owner has nobody the rule can point at, so whoever may manage routing (Owner and Admin by default) may set it.
 */
export function mayEditTimezone(ownerUuid: string | null, actorUuid: string | null): boolean {
  if (ownerUuid === null) return true;
  return actorUuid !== null && ownerUuid === actorUuid;
}

/**
 * The JSON text written to `workspace_settings.business_hours`: the new days over whatever else is stored with the schedule (the
 * outside-hours reply and the anti-spam keys Reference keeps there, which this slice does not own yet).
 */
export function mergeBusinessHours(priorRaw: unknown, days: BusinessHoursDays): string {
  const prior = parseBusinessHours(priorRaw) ?? {};
  return JSON.stringify({ ...prior, days });
}

export function sameDays(a: BusinessHoursDays, b: BusinessHoursDays): boolean {
  return BUSINESS_HOURS_DAY_KEYS.every((k: BusinessHoursDay) => {
    const x = a[k];
    const y = b[k];
    return x.enabled === y.enabled && x.from === y.from && x.to === y.to;
  });
}
