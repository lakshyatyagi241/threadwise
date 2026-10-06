/**
 * The platform switch for the unofficial WhatsApp engine (personal numbers over Baileys, channel `whatsapp_qr`, the
 * `devices` table). A leaf port file: a token and a type, so any module can inject the switch without importing the auth
 * domain's internals or entering an import cycle. Bound in AuthModule (global) to `UnofficialWhatsappSwitch`.
 */
export interface UnofficialWhatsappGate {
  /** Platform-wide and off unless a super admin turned it on. Reads the 5 s `platform_settings` snapshot, so it is cheap to call per loop. */
  isEnabled(): Promise<boolean>;
  /** Throws 422 `WA_UNOFFICIAL_DISABLED` when the engine is off. For user actions that target it. */
  assertEnabled(): Promise<void>;
}

export const UNOFFICIAL_WHATSAPP_GATE = Symbol('UNOFFICIAL_WHATSAPP_GATE');

/** The engine id the switch governs (`devices`, `whatsapp_qr`). */
export const UNOFFICIAL_ENGINE = 'baileys';
/** The inbox channel kind of that engine's devices. */
export const UNOFFICIAL_ENGINE_CHANNEL_KIND = 'whatsapp_qr';
