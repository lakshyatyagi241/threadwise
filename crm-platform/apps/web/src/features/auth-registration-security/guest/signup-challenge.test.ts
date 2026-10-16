import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIGNUP_STAGE_KEY,
  clearSignupStage,
  loadSignupStage,
  parseSignupStage,
  saveSignupStage,
  toStoredSignupStage,
  type KeyValueStore,
} from './signup-challenge';

function fakeStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('signup stage storage', () => {
  let store: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    store = fakeStore();
    clearSignupStage(store);
  });

  it('turns the API response into absolute deadlines', () => {
    const c = toStoredSignupStage(
      {
        token: 'abc',
        maskedEmail: 'a••••a@example.com',
        expiresInSeconds: 300,
        resendCooldownSeconds: 60,
        codeLength: 6,
      },
      1_000_000,
    );
    expect(c).toEqual({
      token: 'abc',
      maskedEmail: 'a••••a@example.com',
      codeLength: 6,
      expiresAt: 1_300_000,
      resendAt: 1_060_000,
    });
  });

  it('round-trips and clears', () => {
    const c = { token: 'x', maskedEmail: 'm', codeLength: 6, expiresAt: 1, resendAt: 2 };
    saveSignupStage(c, store);
    expect(store.data.has(SIGNUP_STAGE_KEY)).toBe(true);
    expect(loadSignupStage(store)).toEqual(c);
    clearSignupStage(store);
    expect(loadSignupStage(store)).toBeNull();
  });

  it('treats corrupt or foreign data as no stage', () => {
    store.setItem(SIGNUP_STAGE_KEY, '{not json');
    expect(loadSignupStage(store)).toBeNull();
    store.setItem(SIGNUP_STAGE_KEY, JSON.stringify({ token: '', codeLength: 'x' }));
    expect(loadSignupStage(store)).toBeNull();
  });

  it('never stores anything but the non-secret fields', () => {
    saveSignupStage(
      { token: 'x', maskedEmail: 'm', codeLength: 6, expiresAt: 1, resendAt: 2 },
      store,
    );
    expect(Object.keys(JSON.parse(store.data.get(SIGNUP_STAGE_KEY)!)).sort()).toEqual([
      'codeLength',
      'expiresAt',
      'maskedEmail',
      'resendAt',
      'token',
    ]);
  });

  it('parseSignupStage returns null for null input', () => {
    expect(parseSignupStage(null)).toBeNull();
  });
});
