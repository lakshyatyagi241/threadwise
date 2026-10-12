import { describe, expect, it } from 'vitest';
import { FAQ_LIMITS, type FaqEntry, type FaqFlowNode } from '@crm/contracts';
import {
  chunkTexts,
  draftFromEntry,
  emptyDraft,
  isDirty,
  mapServerProblems,
  parseVariationLines,
  stepDisplayName,
  stepIsMissing,
  stepOptionLabel,
  stepOptions,
  stepSelectValue,
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
      flowNodeId: null,
      flowNodeLabel: null,
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

describe('the step a flow answer starts at', () => {
  const nodes: FaqFlowNode[] = [
    { id: 'trig-1', type: 'trigger', label: '' },
    { id: 'a1b2c3d4-0000-4000-8000-000000000000', type: 'message', label: '' },
    { id: 'n-ask', type: 'ask', label: 'Order number' },
    { id: 'n-odd', type: 'future_node', label: '  ' },
  ];
  const flowDraft = {
    ...emptyDraft({ question: 'Refund?' }),
    answerType: 'flow' as const,
    flowId: FLOW,
  };

  it('lists the steps as "<type name> · <label or short id>" and leaves the trigger to the flow start', () => {
    expect(stepOptions(nodes).map((o) => o.label)).toEqual([
      'Send message · #a1b2c3',
      'Ask question · Order number',
      'future_node · #n-odd',
    ]);
    expect(stepOptions(nodes).every((o) => !o.start && o.value !== '')).toBe(true);
    expect(stepOptions([{ id: 't', type: 'trigger', label: '' }])).toEqual([]);
    expect(stepOptionLabel({ id: 'x', type: 'ask', label: ' Name ' })).toBe('Ask question · Name');
  });
  it('names a saved step by the catalogue when the API fell back to the raw type', () => {
    expect(stepDisplayName('message')).toBe('Send message');
    expect(stepDisplayName('Order number')).toBe('Order number');
  });
  it('shows the trigger as the flow start and any other saved step as itself', () => {
    expect(stepSelectValue(null, nodes)).toBe('');
    expect(stepSelectValue('trig-1', nodes)).toBe('');
    expect(stepSelectValue('n-ask', nodes)).toBe('n-ask');
    expect(stepSelectValue('gone', nodes)).toBe('gone');
    expect(stepSelectValue('trig-1', undefined)).toBe('trig-1');
  });

  it('is part of the draft, the dirty check and the saved body', () => {
    const entry = {
      question: 'Refund?',
      answerType: 'flow',
      answerText: null,
      flowId: FLOW,
      flowName: 'Refunds',
      flowNodeId: 'n-ask',
      flowNodeLabel: 'Order number',
      category: null,
      status: 'active',
      thresholdOverride: null,
    } as unknown as FaqEntry;
    const d = draftFromEntry(entry);
    expect(d.flowNodeId).toBe('n-ask');
    expect(isDirty(d, d)).toBe(false);
    expect(isDirty({ ...d, flowNodeId: null }, d)).toBe(true);
    expect(toUpdateInput(d, 3)).toMatchObject({ flowId: FLOW, flowNodeId: 'n-ask', rowVersion: 3 });
    expect(toCreateInput(d, [])).toMatchObject({ flowNodeId: 'n-ask' });
  });
  it('sends no step for the flow start, for a text answer and while no flow is chosen', () => {
    expect(toUpdateInput(flowDraft, 1).flowNodeId ?? null).toBeNull();
    const text = {
      ...flowDraft,
      answerType: 'text' as const,
      answerText: 'Hi',
      flowNodeId: 'n-ask',
    };
    expect(toUpdateInput(text, 1).flowNodeId ?? null).toBeNull();
    const noFlow = { ...flowDraft, flowId: null, flowNodeId: 'n-ask' };
    expect(
      toCreateInput({ ...noFlow, answerType: 'text', answerText: 'x' }, []).flowNodeId ?? null,
    ).toBeNull();
  });
  it('maps a too-long step id to the step field and a server problem on flowNodeId to the form', () => {
    const long = { ...flowDraft, flowNodeId: 'x'.repeat(FAQ_LIMITS.flowNodeId + 1) };
    expect(validateDraft(long)).toEqual({ flowNodeId: 'tooLong' });
    expect(
      mapServerProblems([{ path: 'flowNodeId', message: 'Pick a step that is in this flow.' }]),
    ).toEqual({ fields: { flowNodeId: 'Pick a step that is in this flow.' }, other: [] });
  });

  describe('stepIsMissing', () => {
    const saved = { flowId: FLOW, flowNodeId: 'n-gone', flowNodeLabel: null };
    const chosen = { ...flowDraft, flowNodeId: 'n-gone' };
    it('trusts the loaded steps first: an id they do not list is gone', () => {
      expect(stepIsMissing(chosen, null, nodes)).toBe(true);
      expect(stepIsMissing({ ...chosen, flowNodeId: 'n-ask' }, saved, nodes)).toBe(false);
      expect(stepIsMissing({ ...chosen, flowNodeId: 'trig-1' }, null, nodes)).toBe(false);
    });
    it('before the steps arrive, goes by the saved entry having no name for the step', () => {
      expect(stepIsMissing(chosen, saved, undefined)).toBe(true);
      expect(stepIsMissing(chosen, { ...saved, flowNodeLabel: 'Ask question' }, undefined)).toBe(
        false,
      );
      expect(stepIsMissing(chosen, null, undefined)).toBe(false);
      // Another flow was picked since: what the entry saved says nothing about it.
      expect(stepIsMissing({ ...chosen, flowId: 'other' }, saved, undefined)).toBe(false);
    });
    it('is false with no step chosen, no flow or a text answer', () => {
      expect(stepIsMissing({ ...flowDraft, flowNodeId: null }, saved, nodes)).toBe(false);
      expect(stepIsMissing({ ...chosen, flowId: null }, saved, nodes)).toBe(false);
      expect(stepIsMissing({ ...chosen, answerType: 'text' }, saved, nodes)).toBe(false);
    });
  });
});
