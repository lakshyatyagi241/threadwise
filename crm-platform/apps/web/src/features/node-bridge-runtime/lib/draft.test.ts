import { describe, expect, it } from 'vitest';
import { draftFromPacing, toPacingBody } from './draft';

const base = draftFromPacing({ msgGap: 3, batchesGap: 50, bwMsgGap: 5, enableBatches: false });

describe('pacing draft (WD-NODE-029)', () => {
  it('starts from the saved values and sends them back with the version', () => {
    expect(toPacingBody(base, 4)).toEqual({
      body: { msgGap: 3, batchesGap: 50, bwMsgGap: 5, enableBatches: false, rowVersion: 4 },
    });
  });

  it('accepts the limits and names the first field outside them', () => {
    expect(
      'body' in toPacingBody({ ...base, msgGap: '600', batchesGap: '10000', bwMsgGap: '1440' }, 0),
    ).toBe(true);
    expect(toPacingBody({ ...base, msgGap: '0' }, 0)).toEqual({ error: 'msgGap' });
    expect(toPacingBody({ ...base, batchesGap: '10001' }, 0)).toEqual({ error: 'batchesGap' });
    expect(toPacingBody({ ...base, bwMsgGap: '1441' }, 0)).toEqual({ error: 'bwMsgGap' });
  });

  it('refuses blanks, decimals and text instead of coercing them', () => {
    for (const bad of ['', ' ', '2.5', 'abc', '-1', '1e3']) {
      expect(toPacingBody({ ...base, msgGap: bad }, 0), JSON.stringify(bad)).toEqual({
        error: 'msgGap',
      });
    }
  });
});
