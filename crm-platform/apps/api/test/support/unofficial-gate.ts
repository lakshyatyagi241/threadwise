import { unofficialDisabled } from '../../src/modules/auth';
import type { UnofficialWhatsappGate } from '../../src/modules/auth/unofficial-whatsapp.port';

/**
 * A two-level switch fixed to a value, for specs that build a service by hand: `on` is the PLATFORM switch, `allowed` the
 * workspaces on the allow-list (every workspace by default, so a spec that only cares about the platform switch stays short).
 */
export const gate = (
  on: boolean,
  allowed: readonly number[] | 'all' = 'all',
): UnofficialWhatsappGate => {
  const orgAllowed = (orgId: number) => allowed === 'all' || allowed.includes(Number(orgId));
  return {
    isEnabled: async () => on,
    assertEnabled: async () => {
      if (!on) throw unofficialDisabled();
    },
    isEnabledFor: async (orgId) => on && orgAllowed(orgId),
    assertEnabledFor: async (orgId) => {
      if (!(on && orgAllowed(orgId))) throw unofficialDisabled();
    },
    // 'all' has no finite list: a spec that needs the SQL filter lists its workspaces.
    enabledOrgIds: async () => new Set(on && allowed !== 'all' ? allowed : []),
  };
};

export const GATE_ON = gate(true);
export const GATE_OFF = gate(false);
