import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHALLENGE_KEY,
  cleanCode,
  clearChallenge,
  codePattern,
  loadChallenge,
  saveChallenge,
  toStoredChallenge,
  type KeyValueStore,
} from './otp-challenge';

function fakeStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('otp challenge storage', () => {
  let store: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    store = fakeStore();
    clearChallenge(store);
  });

  it('turns the API response into absolute deadlines', () => {
    const c = toStoredChallenge(
      {
        status: 'otp_required',
        challengeId: 'abc',
        maskedPhone: '+91 •••• ••21',
        expiresInSeconds: 300,
        resendCooldownSeconds: 60,
        codeLength: 6,
      },
      1_000_000,
    );
    expect(c).toEqual({
      challengeId: 'abc',
      maskedPhone: '+91 •••• ••21',
      codeLength: 6,
      expiresAt: 1_300_000,
      resendAt: 1_060_000,
    });
  });

  it('prefers the mask built from the typed number over the server text', () => {
    const response = {
      status: 'otp_required' as const,
      challengeId: 'abc',
      // A server that guessed a two-digit prefix for a +1 number.
      maskedPhone: '+14 •••• ••71',
      expiresInSeconds: 300,
      resendCooldownSeconds: 60,
      codeLength: 6,
    };
    expect(toStoredChallenge(response, 0, '+1 •••• ••71').maskedPhone).toBe('+1 •••• ••71');
    expect(toStoredChallenge(response, 0).maskedPhone).toBe('+14 •••• ••71');
    expect(toStoredChallenge(response, 0, '').maskedPhone).toBe('+14 •••• ••71');
  });

  it('round-trips and clears', () => {
    const c = { challengeId: 'x', maskedPhone: 'm', codeLength: 6, expiresAt: 1, resendAt: 2 };
    saveChallenge(c, store);
    expect(store.data.has(CHALLENGE_KEY)).toBe(true);
    expect(loadChallenge(store)).toEqual(c);
    clearChallenge(store);
    expect(loadChallenge(store)).toBeNull();
  });

  it('treats corrupt or foreign data as no challenge', () => {
    store.setItem(CHALLENGE_KEY, '{not json');
    expect(loadChallenge(store)).toBeNull();
    store.setItem(CHALLENGE_KEY, JSON.stringify({ challengeId: '', codeLength: 'x' }));
    expect(loadChallenge(store)).toBeNull();
  });

  it('never stores anything but the non-secret fields', () => {
    saveChallenge(
      { challengeId: 'x', maskedPhone: 'm', codeLength: 6, expiresAt: 1, resendAt: 2 },
      store,
    );
    expect(Object.keys(JSON.parse(store.data.get(CHALLENGE_KEY)!)).sort()).toEqual([
      'challengeId',
      'codeLength',
      'expiresAt',
      'maskedPhone',
      'resendAt',
    ]);
  });
});

describe('code input', () => {
  it('cleans pasted codes to digits within the length', () => {
    expect(cleanCode('123 456', 6)).toBe('123456');
    expect(cleanCode('12-34-56-78-90', 6)).toBe('123456');
    expect(cleanCode('abc', 6)).toBe('');
    expect(cleanCode('12345678', 20)).toBe('12345678');
  });
  it('validates against the configured length (4 to 8)', () => {
    expect(codePattern(6).test('123456')).toBe(true);
    expect(codePattern(6).test('12345')).toBe(false);
    expect(codePattern(4).test('1234')).toBe(true);
    expect(codePattern(99).test('12345678')).toBe(true);
  });
});
