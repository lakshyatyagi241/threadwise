import { describe, expect, it } from 'vitest';
import { createRoutingRuleSchema } from '@crm/contracts';
import {
  conditionsFromForm,
  editableOf,
  emptyForm,
  formFromRule,
  moveId,
  payloadFromForm,
  problemsOf,
  splitWords,
} from './form';
import { U1, U2, rule } from './fixtures';

describe('splitWords', () => {
  it('splits on commas and line breaks, trims and drops repeats', () => {
    expect(splitWords('Refund, invoice\nrefund ;  cancel,, ')).toEqual([
      'Refund',
      'invoice',
      'cancel',
    ]);
    expect(splitWords('')).toEqual([]);
  });
});

describe('problemsOf', () => {
  const ok = () => ({ ...emptyForm(), name: 'R', keywords: 'refund', userIds: [U1] });

  it('a new empty form needs a name, a condition and somebody to assign to', () => {
    expect(problemsOf(emptyForm(), [])).toEqual(['name', 'conditions', 'targets']);
  });
  it('a complete form has no problem', () => {
    expect(problemsOf(ok(), [])).toEqual([]);
  });
  it('the fallback needs no condition', () => {
    expect(problemsOf({ ...ok(), keywords: '', isFallback: true }, [])).toEqual([]);
  });
  it('a specific agent is exactly one person and no team', () => {
    expect(problemsOf({ ...ok(), strategy: 'specific', userIds: [U1, U2] }, [])).toEqual([
      'specific',
    ]);
    expect(
      problemsOf({ ...ok(), strategy: 'specific', userIds: [U1], teamIds: ['t'] }, []),
    ).toEqual(['specific']);
  });
  it('more than 20 words is refused here, as the API would', () => {
    const many = Array.from({ length: 21 }, (_, i) => `w${i}`).join(',');
    expect(problemsOf({ ...ok(), keywords: many }, [])).toContain('keywordsMany');
  });
});

describe('payloadFromForm', () => {
  it('builds exactly what the create contract accepts', () => {
    const f = {
      ...emptyForm(),
      name: '  Refunds ',
      description: ' note ',
      keywords: 'Refund, invoice',
      keywordMode: 'all' as const,
      languages: 'EN, ar',
      channelKinds: ['telegram'],
      businessHours: 'outside' as const,
      userIds: [U1, U2],
    };
    const payload = payloadFromForm(f, [], true);
    expect(payload).toMatchObject({
      name: 'Refunds',
      description: 'note',
      isActive: true,
      stopOnMatch: true,
      assign: { strategy: 'round_robin', userIds: [U1, U2], teamIds: [] },
    });
    expect(payload.conditions).toEqual({
      contact: null,
      channelKinds: ['telegram'],
      keywords: { mode: 'all', words: ['Refund', 'invoice'] },
      languages: ['en', 'ar'],
      businessHours: 'outside',
    });
    expect(createRoutingRuleSchema.safeParse(payload).success).toBe(true);
  });
});

describe('formFromRule and editableOf', () => {
  it('round-trips a saved rule into the form and back to the same conditions', () => {
    const r = rule();
    const f = formFromRule(r);
    expect(f).toMatchObject({
      name: 'Refund requests',
      keywords: 'refund, invoice',
      channelKinds: ['whatsapp_cloud'],
      userIds: [U1, U2],
    });
    expect(conditionsFromForm(f, [])).toEqual(r.conditions);
  });
  it('the engine firing a rule (counters and version) is not an edit', () => {
    const a = rule();
    const b = rule({
      firedCount: 99,
      rowVersion: 40,
      lastFiredAt: null,
      updatedAt: '2026-10-06T00:00:00.000Z',
    });
    expect(editableOf(a)).toBe(editableOf(b));
    expect(editableOf(a)).not.toBe(editableOf(rule({ name: 'Other' })));
  });
});

describe('moveId', () => {
  it('moves one item and leaves the list alone at the edges', () => {
    expect(moveId(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});
