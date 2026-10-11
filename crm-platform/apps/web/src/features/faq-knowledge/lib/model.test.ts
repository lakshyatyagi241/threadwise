import { describe, expect, it } from 'vitest';
import { FAQ_LIMITS } from '@crm/contracts';
import {
  chunkTexts,
  draftFromEntry,
  emptyDraft,
  isDirty,
  mapServerProblems,
  parseVariationLines,
  toCreateInput,
  toUpdateInput,
  validateDraft,
  variationKey,
  variationRoom,
} from './model';

const FLOW = '00000000-0000-4000-8000-000000000001';

describe('validateDraft', () => {
  it('asks for the question and the text answer', () => {
    expect(validateDraft(emptyDraft())).toEqual({ question: 'required', answerText: 'required' });
  });
  it('accepts a complete text FAQ', () => {
    expect(
      validateDraft({ ...emptyDraft({ question: 'Hours?' }), answerText: 'Nine to five' }),
    ).toEqual({});
  });
  it('puts a missing flow on the picker, not on the text answer', () => {
    const d = { ...emptyDraft({ question: 'Hours?' }), answerType: 'flow' as const };
    expect(validateDraft(d)).toEqual({ flowId: 'required' });
  });
  it('accepts a chosen flow and ignores the text typed earlier', () => {
    const d = {
      ...emptyDraft({ question: 'Hours?' }),
      answerType: 'flow' as const,
      flowId: FLOW,
      answerText: '',
    };
    expect(validateDraft(d)).toEqual({});
  });
  it('flags over-long fields and an out-of-range override', () => {
    const d = {
      ...emptyDraft({ question: 'q'.repeat(FAQ_LIMITS.question + 1) }),
      answerText: 'a'.repeat(FAQ_LIMITS.answerText + 1),
      category: 'c'.repeat(FAQ_LIMITS.category + 1),
      thresholdOverride: 1.5,
    };
    expect(validateDraft(d)).toEqual({
      question: 'tooLong',
      answerText: 'tooLong',
      category: 'tooLong',
      thresholdOverride: 'invalid',
    });
  });
});

describe('payloads', () => {
  it('sends the unused answer side as null and a blank category as null', () => {
    const d = {
      ...emptyDraft({ question: ' Hours? ' }),
      answerText: 'Nine',
      flowId: FLOW,
      category: '  ',
    };
    const input = toCreateInput(d, ['opening times'], FLOW);
    expect(input).toMatchObject({
      question: 'Hours?',
      answerType: 'text',
      answerText: 'Nine',
      flowId: null,
      category: null,
      variations: ['opening times'],
      resolveLogId: FLOW,
    });
  });
  it('an update carries the row version it read', () => {
    const d = { ...emptyDraft({ question: 'Q' }), answerType: 'flow' as const, flowId: FLOW };
    expect(toUpdateInput(d, 7)).toMatchObject({
      rowVersion: 7,
      answerType: 'flow',
      flowId: FLOW,
      answerText: null,
    });
  });
});

describe('draft helpers', () => {
  it('detects edits against the loaded draft', () => {
    const a = emptyDraft({ question: 'Q' });
    expect(isDirty(a, { ...a })).toBe(false);
    expect(isDirty(a, { ...a, status: 'paused' })).toBe(true);
  });
  it('builds a draft from a saved entry', () => {
    const d = draftFromEntry({
      id: 'x',
      question: 'Q',
      answerType: 'text',
      answerText: null,
      flowId: null,
      flowName: null,
      category: null,
      status: 'paused',
      thresholdOverride: 0.6,
      hitCount: 0,
      lastHitAt: null,
      variationCount: 1,
      readyCount: 1,
      pendingCount: 0,
      failedCount: 0,
      createdAt: '',
      updatedAt: '',
      rowVersion: 2,
      variations: [],
    });
    expect(d).toMatchObject({
      answerText: '',
      category: '',
      status: 'paused',
      thresholdOverride: 0.6,
    });
  });
  it('maps server field paths and keeps the rest', () => {
    const r = mapServerProblems([
      { path: 'question', message: 'taken' },
      { path: 'variations.2', message: 'bad' },
    ]);
    expect(r.fields).toEqual({ question: 'taken' });
    expect(r.other).toEqual(['bad']);
  });
});

describe('parseVariationLines', () => {
  it('drops bullets, blanks and duplicates (ignoring case and spacing)', () => {
    const b = parseVariationLines(
      '- Where is my parcel\n\n2. track  my ORDER\nwhere is my PARCEL\nTrack my order',
      ['Track my order'],
      10,
    );
    expect(b.fresh).toEqual(['Where is my parcel']);
    expect(b.duplicates).toHaveLength(3);
  });
  it('leaves out lines over the length limit and lines past the room', () => {
    const b = parseVariationLines(`${'x'.repeat(FAQ_LIMITS.variation + 1)}\na\nb\nc`, [], 2);
    expect(b.tooLong).toHaveLength(1);
    expect(b.fresh).toEqual(['a', 'b']);
    expect(b.overflow).toEqual(['c']);
  });
  it('splits into request-sized chunks and computes the room', () => {
    expect(
      chunkTexts(Array.from({ length: 120 }, (_, i) => String(i))).map((c) => c.length),
    ).toEqual([50, 50, 20]);
    expect(variationRoom(58, 60)).toBe(2);
    expect(variationRoom(70, 60)).toBe(0);
    expect(variationKey('  Hi   There ')).toBe('hi there');
  });
});
