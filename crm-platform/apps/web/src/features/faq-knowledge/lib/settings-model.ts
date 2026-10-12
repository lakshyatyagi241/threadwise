import {
  FAQ_LIMITS,
  type FaqSettings,
  type FaqVerifyMode,
  type UpdateFaqSettingsInput,
} from '@crm/contracts';

export interface SettingsForm {
  enabled: boolean;
  threshold: number;
  minMargin: number;
  logQueries: boolean;
  verifyMode: FaqVerifyMode;
  verifyBand: number;
}

export const formFromSettings = (s: FaqSettings): SettingsForm => ({
  enabled: s.enabled,
  threshold: s.threshold,
  minMargin: s.minMargin,
  logQueries: s.logQueries,
  verifyMode: s.verifyMode,
  verifyBand: s.verifyBand,
});

/** Slider noise (0.1 + 0.2) is not a change. */
const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

export const settingsDirty = (a: SettingsForm, b: SettingsForm): boolean =>
  a.enabled !== b.enabled ||
  a.threshold !== b.threshold ||
  a.minMargin !== b.minMargin ||
  a.logQueries !== b.logQueries ||
  a.verifyMode !== b.verifyMode ||
  !sameNumber(a.verifyBand, b.verifyBand);

/** The first save has no row to lock against, so it sends no `rowVersion`; every later one sends the version it read. */
export function toSettingsInput(form: SettingsForm, current: FaqSettings): UpdateFaqSettingsInput {
  return {
    enabled: form.enabled,
    threshold: round2(form.threshold),
    minMargin: round2(form.minMargin),
    logQueries: form.logQueries,
    verifyMode: form.verifyMode,
    verifyBand: clampBand(form.verifyBand),
    ...(current.rowVersion === null ? {} : { rowVersion: current.rowVersion }),
  };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const clampThreshold = (n: number): number =>
  round2(Math.min(FAQ_LIMITS.thresholdMax, Math.max(FAQ_LIMITS.thresholdMin, n)));

/** The band the screens offer for the second check, in whole percents of score. */
export const clampBand = (n: number): number =>
  round2(Math.min(FAQ_LIMITS.verifyBandMax, Math.max(FAQ_LIMITS.verifyBandMin, n)));

/**
 * The scores that go to the second check: from the bar itself up to (not including) the bar plus the band, as whole percents.
 * A score cannot pass 100%, so the top of the range stops there.
 */
export function verifyRange(threshold: number, band: number): { from: number; to: number } {
  const from = Math.round(threshold * 100);
  return { from, to: Math.min(100, Math.round((threshold + clampBand(band)) * 100)) };
}

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
