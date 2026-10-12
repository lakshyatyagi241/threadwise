import type { LscSettings, UpdateLscSettingsInput } from '@crm/contracts';

export interface SettingsForm {
  enabled: boolean;
  autoScore: boolean;
  chatDigest: boolean;
  stageSuggestions: boolean;
}

export const formFromSettings = (s: LscSettings): SettingsForm => ({
  enabled: s.enabled,
  autoScore: s.autoScore,
  chatDigest: s.chatDigest,
  stageSuggestions: s.stageSuggestions,
});

export const settingsDirty = (a: SettingsForm, b: SettingsForm): boolean =>
  a.enabled !== b.enabled ||
  a.autoScore !== b.autoScore ||
  a.chatDigest !== b.chatDigest ||
  a.stageSuggestions !== b.stageSuggestions;

/**
 * The first save has no row yet (rowVersion is null) and sends none; every later save must send the version it read, so a
 * change made meanwhile by someone else is answered with 409 instead of being overwritten.
 */
export function toSettingsInput(
  form: SettingsForm,
  s: Pick<LscSettings, 'rowVersion' | 'chatDigestAvailable'>,
): UpdateLscSettingsInput {
  return {
    enabled: form.enabled,
    autoScore: form.autoScore,
    // Reading conversations is a pilot: a workspace outside it never sends the two switches (the API refuses turning them on).
    ...(s.chatDigestAvailable
      ? { chatDigest: form.chatDigest, stageSuggestions: form.chatDigest && form.stageSuggestions }
      : {}),
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
