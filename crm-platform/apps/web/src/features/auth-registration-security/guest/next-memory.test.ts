import { describe, expect, it } from 'vitest';
import { NEXT_KEY, rememberNext, takeNext } from './next-memory';
import type { KeyValueStore } from './otp-challenge';

function fakeStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('return path across the provider round trip', () => {
  it('keeps a safe path for one use', () => {
    const store = fakeStore();
    rememberNext('/contacts?tag=vip', store);
    expect(takeNext(store)).toBe('/contacts?tag=vip');
    expect(takeNext(store)).toBeNull();
  });

  it('does not store an unsafe path, and forgets an earlier one', () => {
    const store = fakeStore();
    rememberNext('/contacts', store);
    rememberNext('//evil.example', store);
    expect(store.data.has(NEXT_KEY)).toBe(false);
    expect(takeNext(store)).toBeNull();
  });

  it('re-checks what it reads back', () => {
    const store = fakeStore();
    store.setItem(NEXT_KEY, 'https://evil.example');
    expect(takeNext(store)).toBeNull();
    expect(store.data.has(NEXT_KEY)).toBe(false);
  });
});
