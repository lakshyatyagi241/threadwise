import {
  SIMULATOR_DEFAULTS,
  type ChannelSettings,
  type ChannelSettingsPatch,
} from '@crm/contracts';

/**
 * Per-channel settings with their defaults, as a pure function so the rules are testable without a database.
 *
 * `metered` decides whether sends through the channel count toward the plan's monthly messages and charge the wallet. The simulator is
 * never metered, whatever a client sends: it is a development tool and must not spend a customer's allowance or balance. Email is the
 * same (`email_mailboxes` is its limit).
 */
export function normalizeSettings(kind: string, stored: unknown): ChannelSettings {
  const s = (
    typeof stored === 'object' && stored !== null ? stored : {}
  ) as Partial<ChannelSettings>;
  // An email is not billed per message (the plan limits mailboxes instead), whatever a client sends.
  if (kind === 'email') return { metered: false };
  if (kind !== 'simulator') return { metered: s.metered ?? true };
  return {
    metered: false,
    simulator: {
      latencyMs: { ...SIMULATOR_DEFAULTS.latencyMs, ...s.simulator?.latencyMs },
      window: s.simulator?.window ?? SIMULATOR_DEFAULTS.window,
    },
  };
}

/** Applies a partial patch over the current settings (the nested simulator object one level down) and normalises the result. */
export function mergeSettings(
  kind: string,
  current: ChannelSettings,
  patch: ChannelSettingsPatch | undefined,
): ChannelSettings {
  if (!patch) return normalizeSettings(kind, current);
  return normalizeSettings(kind, {
    metered: patch.metered ?? current.metered,
    simulator: {
      latencyMs: { ...current.simulator?.latencyMs, ...patch.simulator?.latencyMs },
      window: patch.simulator?.window ?? current.simulator?.window,
    },
  });
}
