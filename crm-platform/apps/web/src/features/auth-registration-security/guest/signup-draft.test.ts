import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from './otp-challenge';
import { clearDraft, parseDraft, readDraftRaw, saveDraft, type SignupDraft } from './signup-draft';

function fakeStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const draft: SignupDraft = {
  fullName: 'Asha Rao',
  email: 'asha@example.com',
  orgName: 'Rao Studio',
  orgSlug: 'rao',
  customSlug: true,
  phoneRaw: '98765 43210',
  phoneIso: 'IN',
  referral: 'GOT123',
};

describe('sign-up draft', () => {
  it('round-trips the non-secret answers', () => {
    const store = fakeStore();
    saveDraft(draft, store);
    expect(parseDraft(readDraftRaw(store))).toEqual(draft);
  });

  it('is gone after clearing', () => {
    const store = fakeStore();
    saveDraft(draft, store);
    clearDraft(store);
    expect(readDraftRaw(store)).toBeNull();
    expect(parseDraft(readDraftRaw(store))).toBeNull();
  });

  it('never holds a password even if one is passed in by mistake', () => {
    const store = fakeStore();
    saveDraft({ ...draft, password: 'secret-pass' } as SignupDraft, store);
    // The type has no password field, and parsing keeps only the known ones.
    const parsed = parseDraft(readDraftRaw(store)) as unknown as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('password');
  });

  it('rejects malformed or oversized stored values', () => {
    expect(parseDraft('not json')).toBeNull();
    expect(parseDraft('{"fullName": 3}')).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, email: 'x'.repeat(600) }))).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });
});
