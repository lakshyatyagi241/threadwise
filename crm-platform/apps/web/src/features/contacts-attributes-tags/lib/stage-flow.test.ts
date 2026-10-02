import { describe, expect, it } from 'vitest';
import type { StatusOptionResponse } from '@crm/contracts';
import { stageChoices } from './option-sets';
import {
  OTHER_REASON,
  answerFromContact,
  flagsOf,
  isLostStage,
  lostReasonChoices,
  lostReasonPayload,
  lostReasonProblem,
  meaningOf,
} from './stage-flow';
import { stageSeeds } from './stage-model';

const opt = (over: Partial<StatusOptionResponse>): StatusOptionResponse => ({
  id: 'a',
  moduleKey: 'contacts',
  optionGroup: 'lifecycle_stage',
  value: 'x',
  label: 'X',
  color: null,
  position: 0,
  isDefault: false,
  isActive: true,
  isWon: false,
  isLost: false,
  stageOptionId: null,
  rowVersion: 1,
  ...over,
});

describe('stage meaning', () => {
  it('reads and writes the two flags as one choice', () => {
    expect(meaningOf({ isWon: false, isLost: false })).toBe('none');
    expect(meaningOf({ isWon: true, isLost: false })).toBe('won');
    expect(meaningOf({ isWon: false, isLost: true })).toBe('lost');
    expect(flagsOf('none')).toEqual({ isWon: false, isLost: false });
    expect(flagsOf('won')).toEqual({ isWon: true, isLost: false });
    expect(flagsOf('lost')).toEqual({ isWon: false, isLost: true });
  });

  it('a stage choice carries the flags, and only a flagged lost stage asks for a reason', () => {
    const choices = stageChoices([
      opt({ value: 'open_deal' }),
      opt({ id: 'b', value: 'closed_lost', isLost: true, position: 1 }),
      opt({ id: 'c', value: 'closed_won', isWon: true, position: 2 }),
    ]);
    expect(isLostStage(choices, 'closed_lost')).toBe(true);
    expect(isLostStage(choices, 'closed_won')).toBe(false);
    expect(isLostStage(choices, 'open_deal')).toBe(false);
    expect(isLostStage(choices, 'missing')).toBe(false);
    expect(isLostStage(choices, undefined)).toBe(false);
    // The platform's own "lost" is not flagged until an admin flags it: nothing changes for a workspace that did not opt in.
    expect(isLostStage(stageChoices(undefined), 'lost')).toBe(false);
  });

  it('a new workspace seeded from the platform stages gets enrolled as won and lost as lost', () => {
    const seeds = stageSeeds();
    expect(seeds.find((s) => s.value === 'enrolled')?.isWon).toBe(true);
    expect(seeds.find((s) => s.value === 'lost')?.isLost).toBe(true);
    expect(seeds.filter((s) => s.isWon && s.isLost)).toEqual([]);
  });
});

describe('lost reasons', () => {
  const reasons = lostReasonChoices([
    opt({ id: '1', optionGroup: 'lost_reason', value: 'price', label: 'Price', position: 1 }),
    opt({ id: '2', optionGroup: 'lost_reason', value: 'timing', label: 'Timing', position: 0 }),
    opt({ id: '3', optionGroup: 'lost_reason', value: 'gone', label: 'Gone', isActive: false }),
    opt({ id: '4', optionGroup: 'lifecycle_stage', value: 'new' }),
  ]);

  it('lists the active lost-reason options in order', () => {
    expect(reasons.map((r) => r.value)).toEqual(['timing', 'price']);
    expect(lostReasonChoices(undefined)).toEqual([]);
  });

  it('asks for a pick, or for words when "other" is chosen or there is nothing to pick', () => {
    expect(lostReasonProblem({ pick: '', text: '' }, true)).toBe('pick');
    expect(lostReasonProblem({ pick: 'price', text: '' }, true)).toBeNull();
    expect(lostReasonProblem({ pick: OTHER_REASON, text: '  ' }, true)).toBe('text');
    expect(lostReasonProblem({ pick: OTHER_REASON, text: 'Moved' }, true)).toBeNull();
    expect(lostReasonProblem({ pick: '', text: '' }, false)).toBe('text');
    expect(lostReasonProblem({ pick: '', text: 'No budget' }, false)).toBeNull();
  });

  it('sends a picked reason as lostReason and written words as otherLostReason, clearing the other on updates', () => {
    expect(lostReasonPayload({ pick: 'price', text: 'ignored' }, true)).toEqual({
      lostReason: 'price',
      otherLostReason: null,
    });
    expect(lostReasonPayload({ pick: OTHER_REASON, text: ' Moved abroad ' }, true)).toEqual({
      otherLostReason: 'Moved abroad',
      lostReason: null,
    });
    expect(lostReasonPayload({ pick: '', text: 'No budget' }, false)).toEqual({
      otherLostReason: 'No budget',
      lostReason: null,
    });
    // A create has nothing to clear, so the null keys are left out.
    expect(lostReasonPayload({ pick: 'price', text: '' }, true, false)).toEqual({
      lostReason: 'price',
    });
    expect(lostReasonPayload({ pick: OTHER_REASON, text: 'x' }, true, false)).toEqual({
      otherLostReason: 'x',
    });
  });

  it('starts from what a lost contact already has', () => {
    expect(answerFromContact({ lostReason: 'price', otherLostReason: null }, reasons)).toEqual({
      pick: 'price',
      text: '',
    });
    expect(answerFromContact({ lostReason: null, otherLostReason: 'Moved' }, reasons)).toEqual({
      pick: OTHER_REASON,
      text: 'Moved',
    });
    // A reason that is no longer an option is kept as words rather than lost.
    expect(answerFromContact({ lostReason: 'retired', otherLostReason: null }, reasons)).toEqual({
      pick: OTHER_REASON,
      text: 'retired',
    });
    expect(answerFromContact({ lostReason: null, otherLostReason: null }, reasons)).toEqual({
      pick: '',
      text: '',
    });
  });
});
