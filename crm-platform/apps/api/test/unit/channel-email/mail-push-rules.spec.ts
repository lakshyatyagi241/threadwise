import { describe, expect, it } from 'vitest';
import { historyNotNewer } from '../../../src/modules/channel-email/mail-push-rules';

describe('historyNotNewer (replay and stale push ids)', () => {
  it('ignores an id at or behind the stored cursor', () => {
    expect(historyNotNewer('1000', '1000')).toBe(true);
    expect(historyNotNewer('999', '1000')).toBe(true);
  });
  it('syncs for a newer id, compared as numbers not strings', () => {
    expect(historyNotNewer('1001', '1000')).toBe(false);
    expect(historyNotNewer('10000', '9999')).toBe(false);
    expect(historyNotNewer('99999999999999999999', '99999999999999999998')).toBe(false);
  });
  it('syncs when either side is unknown or unparseable', () => {
    expect(historyNotNewer('1000', undefined)).toBe(false);
    expect(historyNotNewer('1000', null)).toBe(false);
    expect(historyNotNewer('abc', '1000')).toBe(false);
  });
});
