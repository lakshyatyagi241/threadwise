import { describe, expect, it } from 'vitest';
import { LOST_REASON_MAX, resolveLostReason, type ReasonOption } from './lost-reasons';

const catalogue: ReasonOption[] = [
  { value: 'r:1', label: 'Price too high', id: 'uuid-1' },
  { value: 'p:timing', label: 'Bad timing' },
];

describe('lost reason', () => {
  it('needs a choice', () => {
    expect(resolveLostReason('', catalogue, '')).toBeNull();
    expect(resolveLostReason('r:missing', catalogue, '')).toBeNull();
  });

  it('sends the id of a catalogue reason', () => {
    expect(resolveLostReason('r:1', catalogue, '')).toEqual({ lostReasonId: 'uuid-1' });
  });

  it('sends the label of a preset as text', () => {
    expect(resolveLostReason('p:timing', catalogue, '')).toEqual({ lostReason: 'Bad timing' });
    expect(resolveLostReason('p:blank', [{ value: 'p:blank', label: '  ' }], '')).toBeNull();
  });

  it('asks for text when the reason is other', () => {
    expect(resolveLostReason('other', catalogue, '   ')).toBeNull();
    expect(resolveLostReason('other', catalogue, ' Merged with another vendor ')).toEqual({
      lostReason: 'Merged with another vendor',
    });
    const long = resolveLostReason('other', catalogue, 'x'.repeat(500));
    expect(long && 'lostReason' in long && long.lostReason).toHaveLength(LOST_REASON_MAX);
  });
});
