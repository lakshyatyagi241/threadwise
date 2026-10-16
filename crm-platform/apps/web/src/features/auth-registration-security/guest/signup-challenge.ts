import type { SignupStartResponse } from '@crm/contracts';

/**
 * The non-secret part of a pending sign-up email check, kept for this browser tab only so a reload of
 * /signup/verify-email does not lose its place. Never holds a password or the code.
 */
export interface StoredSignupStage {
  token: string;
  maskedEmail: string;
  codeLength: number;
  /** Epoch ms when the code stops being accepted. */
  expiresAt: number;
  /** Epoch ms when "Resend" becomes available again. */
  resendAt: number;
}

export const SIGNUP_STAGE_KEY = 'crm.signup.email-stage';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Used when sessionStorage is missing or blocked (private mode, some embedded browsers). */
const memory = new Map<string, string>();
const memoryStore: KeyValueStore = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

let resolved: KeyValueStore | null = null;

export function defaultStore(): KeyValueStore {
  if (resolved) return resolved;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const probe = '__crm_probe__';
      window.sessionStorage.setItem(probe, '1');
      window.sessionStorage.removeItem(probe);
      resolved = window.sessionStorage;
      return resolved;
    }
  } catch {
    /* fall through to memory */
  }
  // Not cached when there is no window: on the server the answer must be re-evaluated in the browser.
  return memoryStore;
}

/** The stage as kept in the tab, from the `/auth/signup/start` response. */
export function toStoredSignupStage(res: SignupStartResponse, now: number): StoredSignupStage {
  return {
    token: res.token,
    maskedEmail: res.maskedEmail,
    codeLength: res.codeLength,
    expiresAt: now + res.expiresInSeconds * 1000,
    resendAt: now + res.resendCooldownSeconds * 1000,
  };
}

export function saveSignupStage(c: StoredSignupStage, store: KeyValueStore = defaultStore()): void {
  try {
    store.setItem(SIGNUP_STAGE_KEY, JSON.stringify(c));
  } catch {
    memoryStore.setItem(SIGNUP_STAGE_KEY, JSON.stringify(c));
  }
}

function isStored(v: unknown): v is StoredSignupStage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.token === 'string' &&
    o.token.length > 0 &&
    typeof o.maskedEmail === 'string' &&
    typeof o.codeLength === 'number' &&
    typeof o.expiresAt === 'number' &&
    typeof o.resendAt === 'number'
  );
}

/** The stored stage as text (a stable primitive, so it works as an external-store snapshot). */
export function readSignupStageRaw(store: KeyValueStore = defaultStore()): string | null {
  try {
    return store.getItem(SIGNUP_STAGE_KEY) ?? memoryStore.getItem(SIGNUP_STAGE_KEY);
  } catch {
    return null;
  }
}

export function parseSignupStage(raw: string | null): StoredSignupStage | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadSignupStage(store: KeyValueStore = defaultStore()): StoredSignupStage | null {
  return parseSignupStage(readSignupStageRaw(store));
}

export function clearSignupStage(store: KeyValueStore = defaultStore()): void {
  try {
    store.removeItem(SIGNUP_STAGE_KEY);
  } catch {
    /* nothing stored */
  }
  memoryStore.removeItem(SIGNUP_STAGE_KEY);
}
