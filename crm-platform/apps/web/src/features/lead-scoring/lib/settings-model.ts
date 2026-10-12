import type { LscSettings, UpdateLscSettingsInput } from '@crm/contracts';

export interface SettingsForm {
  enabled: boolean;
  autoScore: boolean;
}

export const formFromSettings = (s: LscSettings): SettingsForm => ({
  enabled: s.enabled,
  autoScore: s.autoScore,
});

export const settingsDirty = (a: SettingsForm, b: SettingsForm): boolean =>
  a.enabled !== b.enabled || a.autoScore !== b.autoScore;

/**
 * The first save has no row yet (rowVersion is null) and sends none; every later save must send the version it read, so a
 * change made meanwhile by someone else is answered with 409 instead of being overwritten.
 */
export function toSettingsInput(
  form: SettingsForm,
  s: Pick<LscSettings, 'rowVersion'>,
): UpdateLscSettingsInput {
  return {
    enabled: form.enabled,
    autoScore: form.autoScore,
    ...(s.rowVersion !== null ? { rowVersion: s.rowVersion } : {}),
  };
}

/** What the status banner says: the platform switch beats a missing key, which beats the workspace's own switch. */
export type Readiness = 'platformOff' | 'noKey' | 'off' | 'ready';

export function readiness(
  s: Pick<LscSettings, 'enabled' | 'platformEnabled' | 'keySource'>,
): Readiness {
  if (!s.platformEnabled) return 'platformOff';
  if (s.keySource === 'none') return 'noKey';
  return s.enabled ? 'ready' : 'off';
}
