import type { ConnectEmbeddedInput } from '@crm/contracts';

/**
 * The client half of Meta Embedded Signup (TW-WABA-005). Two things arrive separately and in either order: the OAuth `code`
 * from the `FB.login` callback, and the ids from the popup's `WA_EMBEDDED_SIGNUP` postMessage. The connect request is sent
 * once both are in. The ids are only hints: the server proves them against the token before using them.
 */

export type SignupMode = 'standard' | 'coexistence';

export interface SignupState {
  mode: SignupMode;
  code: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessId: string | null;
  /** True once Meta says this is a Business App (coexistence) onboarding, whichever button was pressed. */
  coexistence: boolean;
  /** Guards against a double POST when both channels complete. */
  submitted: boolean;
}

export const initialSignup = (mode: SignupMode = 'standard'): SignupState => ({
  mode,
  code: null,
  wabaId: null,
  phoneNumberId: null,
  businessId: null,
  coexistence: mode === 'coexistence',
  submitted: false,
});

export type SignupEvent =
  | { type: 'code'; code: string }
  | { type: 'session'; event: string; data: Record<string, unknown> };

export type SignupEffect =
  | { kind: 'none' }
  | { kind: 'submit'; input: ConnectEmbeddedInput }
  /** Standard mode and Meta returned a WABA without a number (`FINISH_ONLY_WABA`): nothing to connect. */
  | { kind: 'no-number' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string | null };

const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

/** `facebook.com` and its subdomains only: a look-alike host such as `evilfacebook.com` must not pass. */
export function isFacebookOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return host === 'facebook.com' || host.endsWith('.facebook.com');
}

/** Meta posts either an object or its JSON text; anything that is not a `WA_EMBEDDED_SIGNUP` message gives null. */
export function parseSignupMessage(
  raw: unknown,
): { event: string; data: Record<string, unknown> } | null {
  let msg = raw;
  if (typeof msg === 'string') {
    try {
      msg = JSON.parse(msg);
    } catch {
      return null;
    }
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as { type?: unknown; event?: unknown; data?: unknown };
  if (m.type !== 'WA_EMBEDDED_SIGNUP' || typeof m.event !== 'string') return null;
  const data =
    typeof m.data === 'object' && m.data !== null ? (m.data as Record<string, unknown>) : {};
  return { event: m.event, data };
}

function ready(s: SignupState): ConnectEmbeddedInput | null {
  if (s.submitted || !s.code) return null;
  // Standard needs the number too; a coexistence onboarding is complete with the WABA alone.
  if (s.coexistence ? !s.wabaId : !s.wabaId || !s.phoneNumberId) return null;
  return {
    code: s.code,
    ...(s.wabaId ? { wabaId: s.wabaId } : {}),
    ...(s.phoneNumberId ? { phoneNumberId: s.phoneNumberId } : {}),
    ...(s.businessId ? { businessId: s.businessId } : {}),
    coexistence: s.coexistence,
  };
}

function withSubmit(s: SignupState): { state: SignupState; effect: SignupEffect } {
  const input = ready(s);
  return input
    ? { state: { ...s, submitted: true }, effect: { kind: 'submit', input } }
    : { state: s, effect: { kind: 'none' } };
}

export function nextSignup(
  s: SignupState,
  ev: SignupEvent,
): { state: SignupState; effect: SignupEffect } {
  if (ev.type === 'code') return withSubmit({ ...s, code: ev.code });

  const { event, data } = ev;
  switch (event) {
    case 'FINISH':
    case 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING': {
      const coexistence =
        s.coexistence ||
        event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ||
        data.is_wa_login_user === true;
      return withSubmit({
        ...s,
        coexistence,
        wabaId: str(data.waba_id) ?? s.wabaId,
        phoneNumberId: str(data.phone_number_id) ?? s.phoneNumberId,
        businessId: str(data.business_id) ?? s.businessId,
      });
    }
    case 'FINISH_ONLY_WABA': {
      const next = {
        ...s,
        wabaId: str(data.waba_id) ?? s.wabaId,
        businessId: str(data.business_id) ?? s.businessId,
      };
      return s.coexistence ? withSubmit(next) : { state: next, effect: { kind: 'no-number' } };
    }
    case 'CANCEL':
      return { state: s, effect: { kind: 'cancelled' } };
    case 'ERROR':
      return { state: s, effect: { kind: 'error', message: str(data.error_message) } };
    default:
      return { state: s, effect: { kind: 'none' } };
  }
}

/** If the code arrived but no session message followed within this long, tell the user Meta returned no number. */
export const SESSION_WAIT_MS = 15_000;
