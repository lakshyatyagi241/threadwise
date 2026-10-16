import {
  LOST_REASON_MAX,
  OTHER,
  lostReasonToSend,
  resolveLostReason,
  toLostBody,
  type ReasonOption,
} from './lost-reasons';

const options: ReasonOption[] = [
  { value: 'r:1', label: 'Budget cut', id: 'reason-1' },
  { value: 'p:price', label: 'Price too high' },
];

describe('resolveLostReason', () => {
  it('has nothing before a choice is made', () => {
    expect(resolveLostReason('', options, '')).toBeNull();
  });

  it('sends a catalogue reason by its id', () => {
    expect(resolveLostReason('r:1', options, '')).toEqual({ lostReasonId: 'reason-1' });
  });

  it('sends a preset as its words', () => {
    expect(resolveLostReason('p:price', options, '')).toEqual({ lostReason: 'Price too high' });
  });

  it('needs words for "other", trimmed and cut to the limit', () => {
    expect(resolveLostReason(OTHER, options, '   ')).toBeNull();
    expect(resolveLostReason(OTHER, options, ' Went quiet ')).toEqual({ lostReason: 'Went quiet' });
    const long = resolveLostReason(OTHER, options, 'x'.repeat(300));
    expect(long && 'lostReason' in long ? long.lostReason : '').toHaveLength(LOST_REASON_MAX);
  });

  it('ignores a choice that is not on the list', () => {
    expect(resolveLostReason('r:gone', options, '')).toBeNull();
  });
});

describe('lostReasonToSend', () => {
  it('closes the deal with no reason when none was chosen and none is required', () => {
    expect(lostReasonToSend('', options, '', false)).toEqual({});
  });

  it('is not ready without a reason when one is required', () => {
    expect(lostReasonToSend('', options, '', true)).toBeNull();
  });

  it('is not ready with a started but empty "other", even when none is required', () => {
    expect(lostReasonToSend(OTHER, options, '', false)).toBeNull();
  });

  it('sends the reason that was given', () => {
    expect(lostReasonToSend('r:1', options, '', true)).toEqual({ lostReasonId: 'reason-1' });
  });
});

describe('toLostBody', () => {
  it('names the free text "reason", as the lost route does', () => {
    expect(toLostBody({ lostReasonId: 'a' })).toEqual({ lostReasonId: 'a' });
    expect(toLostBody({ lostReason: 'Slow' })).toEqual({ reason: 'Slow' });
    expect(toLostBody({})).toEqual({});
  });
});
