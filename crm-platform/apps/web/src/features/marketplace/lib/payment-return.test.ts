import { describe, expect, it } from 'vitest';
import { paymentReturnOutcome } from './payment-return';

describe('the outcome of a payment in the address', () => {
  it('knows the four outcomes and nothing else', () => {
    for (const o of ['success', 'pending', 'failed', 'cancelled'])
      expect(paymentReturnOutcome(o)).toBe(o);
    for (const bad of [null, undefined, '', 'proof', 'notfound', 'SUCCESS', '<script>'])
      expect(paymentReturnOutcome(bad)).toBeNull();
  });
});
