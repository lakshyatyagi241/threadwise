import type { OtpRequired } from '@crm/contracts';

/**
 * The non-secret part of a pending sign-up code check, kept for this browser tab only so a
 * reload of /verify-otp does not lose its place (TW-AUTH-006). Never holds a password or the code.
 */
export interface StoredChallenge {
  challengeId: string;
  maskedPhone: string;
  codeLength: number;
  /** Epoch ms when the code stops being accepted. */
  expiresAt: number;
  /** Epoch ms when "Resend" becomes available again. */
  resendAt: number;
}

export const CHALLENGE_KEY = 'crm.signup.otp';

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

/**
 * The challenge as kept in the tab. `maskedPhone` overrides the server's text when the page built its own mask
 * from the number just typed (right for every calling-code length).
 */
export function toStoredChallenge(
  r: OtpRequired,
  now: number,
  maskedPhone?: string,
): StoredChallenge {
  return {
    challengeId: r.challengeId,
    maskedPhone: maskedPhone || r.maskedPhone,
    codeLength: r.codeLength,
    expiresAt: now + r.expiresInSeconds * 1000,
    resendAt: now + r.resendCooldownSeconds * 1000,
  };
}

export function saveChallenge(c: StoredChallenge, store: KeyValueStore = defaultStore()): void {
  try {
    store.setItem(CHALLENGE_KEY, JSON.stringify(c));
  } catch {
    memoryStore.setItem(CHALLENGE_KEY, JSON.stringify(c));
  }
}

function isStored(v: unknown): v is StoredChallenge {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.challengeId === 'string' &&
    o.challengeId.length > 0 &&
    typeof o.maskedPhone === 'string' &&
    typeof o.codeLength === 'number' &&
    typeof o.expiresAt === 'number' &&
    typeof o.resendAt === 'number'
  );
}

/** The stored challenge as text (a stable primitive, so it works as an external-store snapshot). */
export function readChallengeRaw(store: KeyValueStore = defaultStore()): string | null {
  try {
    return store.getItem(CHALLENGE_KEY) ?? memoryStore.getItem(CHALLENGE_KEY);
  } catch {
    return null;
  }
}

export function parseChallenge(raw: string | null): StoredChallenge | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadChallenge(store: KeyValueStore = defaultStore()): StoredChallenge | null {
  return parseChallenge(readChallengeRaw(store));
}

export function clearChallenge(store: KeyValueStore = defaultStore()): void {
  try {
    store.removeItem(CHALLENGE_KEY);
  } catch {
    /* nothing stored */
  }
  memoryStore.removeItem(CHALLENGE_KEY);
}

/** The code length clamps to what the API allows and the input accepts. */
export function codePattern(length: number): RegExp {
  const n = Math.min(8, Math.max(4, Math.trunc(length) || 6));
  return new RegExp(`^\\d{${n}}$`);
}

/** Digits only, trimmed to the code length (people paste "123 456" or "123-456"). */
export function cleanCode(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, Math.min(8, Math.max(4, Math.trunc(length) || 6)));
}
