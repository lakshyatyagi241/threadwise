import { describe, expect, it } from 'vitest';
import { attemptOf, fixtureOutcome } from '../../../src/modules/campaigns/fixture/whatsapp-fixture';

describe('the sandbox decides an outcome from the number and the attempt', () => {
  it('an ordinary number is delivered', () => {
    expect(fixtureOutcome('+919876543210', 'camp-1-2')).toEqual({ kind: 'delivered' });
  });

  it('...1049 hits the frequency cap (131049) on the original send, then is delivered by the first retry', () => {
    expect(fixtureOutcome('+919800001049', 'camp-1-2')).toMatchObject({
      kind: 'frequency_cap',
      code: '131049',
    });
    expect(fixtureOutcome('+919800001049', 'camp-1-2-r1')).toEqual({ kind: 'delivered' });
  });

  it('...2049 fails the original and the first retry; ...9049 never goes through', () => {
    expect(fixtureOutcome('+919800002049', 'camp-1-2-r1')).toMatchObject({ kind: 'frequency_cap' });
    expect(fixtureOutcome('+919800002049', 'camp-1-2-r2')).toEqual({ kind: 'delivered' });
    for (const r of ['camp-1-2', 'camp-1-2-r1', 'camp-1-2-r7']) {
      expect(fixtureOutcome('+919800009049', r)).toMatchObject({ kind: 'frequency_cap' });
    }
  });

  it('...0000 is undeliverable for good (a different error, so no retry); ...9999 is refused on the spot', () => {
    expect(fixtureOutcome('+919800000000', 'camp-1-2')).toMatchObject({
      kind: 'undeliverable',
      code: '131026',
    });
    expect(fixtureOutcome('+919800009999', 'camp-1-2')).toMatchObject({
      kind: 'rejected',
      code: '131030',
    });
  });

  it('reads the attempt from the reference suffix', () => {
    expect(attemptOf('camp-9-8')).toBe(0);
    expect(attemptOf('camp-9-8-r3')).toBe(3);
    expect(attemptOf('camptest-9-1700000000000-2')).toBe(0);
  });
});
