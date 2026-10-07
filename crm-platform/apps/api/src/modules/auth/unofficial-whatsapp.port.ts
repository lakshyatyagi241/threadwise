/**
 * The two-level gate for the unofficial WhatsApp engine (personal numbers over Baileys, channel `whatsapp_qr`, the
 * `devices` table). A leaf port file: a token and a type, so any module can inject the switch without importing the auth
 * domain's internals or entering an import cycle. Bound in AuthModule (global) to `UnofficialWhatsappSwitch`.
 *
 * Owner decision 2026-10-06: the engine is off for every workspace until a platform super admin allows that workspace. EFFECTIVE
 * access for a workspace = the platform switch is on AND the workspace is on the allow-list (`unofficial_whatsapp_workspaces`).
 * Every per-request and per-row decision uses `isEnabledFor(orgId)` / `assertEnabledFor(orgId)` with the orgId of the request or
 * of the row; `isEnabled()` answers only the platform question (admin screens, worker-wide).
 */
export interface UnofficialWhatsappGate {
  /** The PLATFORM kill-switch only (off unless a super admin turned it on). Reads the 5 s `platform_settings` snapshot. Not an access decision for a workspace. */
  isEnabled(): Promise<boolean>;
  /** Throws 422 `WA_UNOFFICIAL_DISABLED` when the platform switch is off. Prefer `assertEnabledFor` for anything a workspace does. */
  assertEnabled(): Promise<void>;
  /** Platform switch on AND this workspace allowed. Cached about 5 s, dropped at once on a write made on this instance. */
  isEnabledFor(orgId: number): Promise<boolean>;
  /** Throws 422 `WA_UNOFFICIAL_DISABLED` unless `isEnabledFor(orgId)`. For user actions that target the engine. */
  assertEnabledFor(orgId: number): Promise<void>;
  /**
   * The allow-list (org ids) when the platform switch is on, an empty set when it is off. For background sweeps that read rows of
   * many workspaces and must decide per row without one query per row.
   */
  enabledOrgIds(): Promise<ReadonlySet<number>>;
}

export const UNOFFICIAL_WHATSAPP_GATE = Symbol('UNOFFICIAL_WHATSAPP_GATE');

/** The engine id the switch governs (`devices`, `whatsapp_qr`). */
export const UNOFFICIAL_ENGINE = 'baileys';
/** The inbox channel kind of that engine's devices. */
export const UNOFFICIAL_ENGINE_CHANNEL_KIND = 'whatsapp_qr';
