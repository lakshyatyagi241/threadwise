import { unofficialDisabled } from '../../src/modules/auth';
import type { UnofficialWhatsappGate } from '../../src/modules/auth/unofficial-whatsapp.port';

/** A switch fixed to a value, for specs that build a service by hand. */
export const gate = (on: boolean): UnofficialWhatsappGate => ({
  isEnabled: async () => on,
  assertEnabled: async () => {
    if (!on) throw unofficialDisabled();
  },
});

export const GATE_ON = gate(true);
export const GATE_OFF = gate(false);
