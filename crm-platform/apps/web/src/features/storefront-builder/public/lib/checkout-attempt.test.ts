import { describe, expect, it } from 'vitest';
import { checkoutAttempt } from './checkout-attempt';

describe('checkoutAttempt', () => {
  it('mints a key for the first submit', () => {
    const next = keySequence(['k1']);
    const a = checkoutAttempt(null, '{"n":"a"}', next.fn);
    expect(a).toEqual({ key: 'k1', fingerprint: '{"n":"a"}' });
  });

  it('reuses the key when a retry sends the same payload', () => {
    const next = keySequence(['k1', 'k2']);
    const first = checkoutAttempt(null, '{"n":"a"}', next.fn);
    const retry = checkoutAttempt(first, '{"n":"a"}', next.fn);
    expect(retry.key).toBe('k1');
    expect(next.calls()).toBe(1);
  });

  it('mints a new key when the payload changed since the last attempt', () => {
    const next = keySequence(['k1', 'k2']);
    const first = checkoutAttempt(null, '{"n":"a"}', next.fn);
    const edited = checkoutAttempt(first, '{"n":"b"}', next.fn);
    expect(edited.key).toBe('k2');
  });
});

function keySequence(keys: string[]) {
  let i = 0;
  return { fn: () => keys[i++] ?? 'overflow', calls: () => i };
}
