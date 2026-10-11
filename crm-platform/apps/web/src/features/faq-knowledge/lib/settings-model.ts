import { FAQ_LIMITS, type FaqSettings, type UpdateFaqSettingsInput } from '@crm/contracts';

export interface SettingsForm {
  enabled: boolean;
  threshold: number;
  minMargin: number;
  logQueries: boolean;
}

export const formFromSettings = (s: FaqSettings): SettingsForm => ({
  enabled: s.enabled,
  threshold: s.threshold,
  minMargin: s.minMargin,
  logQueries: s.logQueries,
});

export const settingsDirty = (a: SettingsForm, b: SettingsForm): boolean =>
  a.enabled !== b.enabled ||
  a.threshold !== b.threshold ||
  a.minMargin !== b.minMargin ||
  a.logQueries !== b.logQueries;

/** The first save has no row to lock against, so it sends no `rowVersion`; every later one sends the version it read. */
export function toSettingsInput(form: SettingsForm, current: FaqSettings): UpdateFaqSettingsInput {
  return {
    enabled: form.enabled,
    threshold: round2(form.threshold),
    minMargin: round2(form.minMargin),
    logQueries: form.logQueries,
    ...(current.rowVersion === null ? {} : { rowVersion: current.rowVersion }),
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const clampThreshold = (n: number): number =>
  round2(Math.min(FAQ_LIMITS.thresholdMax, Math.max(FAQ_LIMITS.thresholdMin, n)));

export type PresetId = 'strict' | 'balanced' | 'forgiving';

/** A similarity scale belongs to its embedding model, so the presets hang off the model's recommended threshold. */
export function presetsFor(recommended: number): Record<PresetId, number> {
  return {
    strict: round2(Math.min(0.95, recommended + 0.1)),
    balanced: round2(recommended),
    forgiving: round2(Math.max(0.2, recommended - 0.1)),
  };
}

/** The preset whose number the threshold is on, or null when it is a custom value. */
export function activePreset(threshold: number, recommended: number): PresetId | null {
  const p = presetsFor(recommended);
  return (Object.keys(p) as PresetId[]).find((k) => Math.abs(p[k] - threshold) < 0.005) ?? null;
}
