import { defaultStore, type KeyValueStore } from './otp-challenge';

/**
 * The non-secret answers of the sign-up form, kept for this browser tab so that going back from the code check
 * (wrong number, workspace address taken in the meantime) does not mean typing everything again. The password,
 * its confirmation and any code are never stored. The draft ends when the account exists.
 */
export interface SignupDraft {
  fullName: string;
  email: string;
  orgName: string;
  orgSlug: string;
  customSlug: boolean;
  phoneRaw: string;
  phoneIso: string;
  referral: string;
}

export const DRAFT_KEY = 'crm.signup.draft';

const STRING_FIELDS = [
  'fullName',
  'email',
  'orgName',
  'orgSlug',
  'phoneRaw',
  'phoneIso',
  'referral',
] as const;

export function saveDraft(draft: SignupDraft, store: KeyValueStore = defaultStore()): void {
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage blocked: the form simply starts empty next time */
  }
}

export function readDraftRaw(store: KeyValueStore = defaultStore()): string | null {
  try {
    return store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** A stored draft, or null for anything that is not a well-formed one. Unknown properties are dropped. */
export function parseDraft(raw: string | null): SignupDraft | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    const out: Partial<SignupDraft> = { customSlug: o.customSlug === true };
    for (const key of STRING_FIELDS) {
      const value = o[key];
      if (typeof value !== 'string' || value.length > 512) return null;
      out[key] = value;
    }
    return out as SignupDraft;
  } catch {
    return null;
  }
}

export function clearDraft(store: KeyValueStore = defaultStore()): void {
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    /* nothing stored */
  }
}
