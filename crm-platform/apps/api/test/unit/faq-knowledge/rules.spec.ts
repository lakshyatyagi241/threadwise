import { describe, expect, it } from 'vitest';
import {
  TRIGRAM_MIN,
  answerId,
  bestPerFaq,
  candidateFlows,
  decide,
  isMatchable,
  normalise,
  parseSuggestions,
  pickAttempt,
  queryText,
  sameKey,
  suggestionPrompt,
  tidy,
  toCandidates,
  toVectorLiteral,
  type FlowAttempt,
  type FlowBinding,
  type Scored,
} from '../../../src/modules/faq-knowledge/faq.rules';

const row = (faqId: number, score: number, over: Partial<Scored> = {}): Scored => ({
  faqId,
  faqUuid: `00000000-0000-4000-8000-${String(faqId).padStart(12, '0')}`,
  question: `Question ${faqId}`,
  status: 'active',
  thresholdOverride: null,
  text: `variation of ${faqId}`,
  score,
  ...over,
});

describe('text rules', () => {
  it('tidy collapses whitespace and trims', () => {
    expect(tidy('  where \n is\t my   order ')).toBe('where is my order');
  });

  it('tidy drops a NUL a customer message could carry (Postgres text cannot hold it)', () => {
    expect(tidy('or\u0000der')).toBe('order');
    expect(queryText('a\u0000')).toBe('a');
  });

  it('sameKey ignores case and spacing, the way the unique index does', () => {
    expect(sameKey('  Track  My ORDER ')).toBe(sameKey('track my order'));
    expect(sameKey('track my order')).not.toBe(sameKey('track my orders'));
  });

  it.each([
    ['hi', true],
    ['ok', true],
    ['a', false],
    ['', false],
    ['   ', false],
    ['?', false],
    ['??!!', false],
    ['👍', false],
    ['👍👍', false],
    ['12', true],
    ['नमस्ते', true],
    ['mera order kaha hai', true],
  ])('isMatchable(%j) is %s', (text, expected) => {
    expect(isMatchable(text)).toBe(expected);
  });

  it('queryText cuts at the cap by characters, not bytes', () => {
    const long = 'é'.repeat(1500);
    expect(Array.from(queryText(long))).toHaveLength(1000);
    expect(queryText('  a   b ')).toBe('a b');
  });
});

describe('vectors', () => {
  it('toVectorLiteral is pgvector text form with six decimals and no NaN', () => {
    expect(toVectorLiteral([0.1234567891, -1, 0])).toBe('[0.123457,-1,0]');
    expect(toVectorLiteral([Number.NaN, Infinity])).toBe('[0,0]');
  });

  it('normalise makes unit length and leaves a zero vector alone', () => {
    const v = normalise([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });
});

describe('bestPerFaq', () => {
  it('keeps each FAQ once, at its best variation, best first', () => {
    const out = bestPerFaq([
      row(1, 0.4),
      row(2, 0.9),
      row(1, 0.7, { text: 'better' }),
      row(3, 0.5),
    ]);
    expect(out.map((r) => [r.faqId, r.score])).toEqual([
      [2, 0.9],
      [1, 0.7],
      [3, 0.5],
    ]);
    expect(out[1]!.text).toBe('better');
  });

  it('breaks a tie on the lower id so the choice is stable', () => {
    expect(bestPerFaq([row(5, 0.6), row(2, 0.6)]).map((r) => r.faqId)).toEqual([2, 5]);
  });

  it('is empty for no rows', () => {
    expect(bestPerFaq([])).toEqual([]);
  });
});

describe('decide', () => {
  const opts = { threshold: 0.45, minMargin: 0, exact: false };

  it('no candidates means no_faqs', () => {
    expect(decide([], opts).outcome).toBe('no_faqs');
  });

  it('answers at exactly the threshold and refuses just under it', () => {
    expect(decide([row(1, 0.45)], opts).outcome).toBe('answered');
    expect(decide([row(1, 0.4499)], opts).outcome).toBe('below_threshold');
  });

  it('an exact match answers whatever the bar or margin', () => {
    const d = decide([row(1, 1), row(2, 1)], { threshold: 0.99, minMargin: 0.5, exact: true });
    expect(d.outcome).toBe('answered');
    expect(d.winner!.faqId).toBe(1);
  });

  it("a FAQ's own threshold overrides the workspace's, both ways", () => {
    expect(decide([row(1, 0.6, { thresholdOverride: 0.8 })], opts).outcome).toBe('below_threshold');
    expect(decide([row(1, 0.3, { thresholdOverride: 0.2 })], opts).outcome).toBe('answered');
    expect(decide([row(1, 0.6, { thresholdOverride: 0.8 })], opts).threshold).toBe(0.8);
  });

  it('a margin refuses an ambiguous message, and lets a clear lead through', () => {
    const m = { threshold: 0.45, minMargin: 0.1, exact: false };
    expect(decide([row(1, 0.7), row(2, 0.65)], m).outcome).toBe('low_margin');
    expect(decide([row(1, 0.7), row(2, 0.5)], m).outcome).toBe('answered');
    // Exactly the margin is enough.
    expect(decide([row(1, 0.7), row(2, 0.6)], { ...m, minMargin: 0.1 }).outcome).toBe('answered');
  });

  it('a margin does not apply to a lone FAQ', () => {
    expect(decide([row(1, 0.7)], { threshold: 0.45, minMargin: 0.4, exact: false }).outcome).toBe(
      'answered',
    );
  });

  it('margin 0 switches the check off', () => {
    expect(decide([row(1, 0.7), row(2, 0.7)], opts).outcome).toBe('answered');
  });

  it('threshold is checked before margin', () => {
    expect(
      decide([row(1, 0.3), row(2, 0.29)], { threshold: 0.45, minMargin: 0.1, exact: false })
        .outcome,
    ).toBe('below_threshold');
  });

  it('reports the runner-up score', () => {
    expect(decide([row(1, 0.9), row(2, 0.4)], opts).secondScore).toBe(0.4);
    expect(decide([row(1, 0.9)], opts).secondScore).toBeNull();
  });

  it('the trigram bar is stricter than the default vector bar', () => {
    expect(TRIGRAM_MIN).toBeGreaterThan(0.45);
  });
});

describe('toCandidates', () => {
  it('shows the best five with rounded scores and the matching variation', () => {
    const ranked = Array.from({ length: 8 }, (_, i) => row(i + 1, 0.9 - i * 0.05));
    const out = toCandidates(ranked);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({
      question: 'Question 1',
      score: 0.9,
      matchedText: 'variation of 1',
      status: 'active',
    });
    expect(out[0]!.faqId).toBe(ranked[0]!.faqUuid);
  });
});

describe('suggestions', () => {
  it('the prompt carries the question, what exists and the count, and asks for JSON', () => {
    const p = suggestionPrompt('Where is my order?', ['Track my order'], 7);
    expect(p.user).toContain('Where is my order?');
    expect(p.user).toContain('Track my order');
    expect(p.user).toContain('Write 7 new variations');
    expect(p.system).toContain('JSON');
  });

  it('parses the JSON answer and drops repeats of the question, of what exists, and of itself', () => {
    const text = JSON.stringify({
      variations: [
        'Order status',
        'where is my order?',
        'WHERE IS MY ORDER?',
        'Order  Status',
        'parcel late',
        '',
        5,
        'when will it come',
      ],
    });
    expect(parseSuggestions(text, ['Where is my order?'], 10)).toEqual([
      'Order status',
      'parcel late',
      'when will it come',
    ]);
  });

  it('never returns more than asked', () => {
    const text = JSON.stringify({ variations: ['a1', 'b2', 'c3', 'd4'] });
    expect(parseSuggestions(text, [], 2)).toEqual(['a1', 'b2']);
  });

  it('falls back to lines when the model ignored the format', () => {
    const text = '1. first one\n- second one\n"third one",\n\n';
    expect(parseSuggestions(text, [], 5)).toEqual(['first one', 'second one', 'third one']);
  });

  it('drops a suggestion longer than a variation may be', () => {
    const text = JSON.stringify({ variations: ['x'.repeat(501), 'ok'] });
    expect(parseSuggestions(text, [], 5)).toEqual(['ok']);
  });

  it('survives garbage', () => {
    expect(parseSuggestions('', [], 5)).toEqual([]);
    expect(parseSuggestions('{"variations": "no"}', [], 5)).toEqual([]);
  });
});

describe('answerId', () => {
  it('is a valid version 5 uuid, stable for a seed and different for another', () => {
    const a = answerId('11111111-1111-4111-8111-111111111111');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(answerId('11111111-1111-4111-8111-111111111111')).toBe(a);
    expect(answerId('22222222-2222-4222-8222-222222222222')).not.toBe(a);
  });
});

describe('candidateFlows: which flows may answer on a channel', () => {
  const kinds = { simulator: ['simulator'], waba: ['whatsapp_cloud'], baileys: ['whatsapp_qr'] };
  const f = (
    id: number,
    provider: string,
    triggerChannelId: number | null = null,
  ): FlowBinding => ({
    id,
    provider,
    triggerChannelId,
  });
  const ch = { channelId: 10, channelKind: 'simulator' };

  it('a flow tied to no channel answers on every channel of its engine kind, and on no other', () => {
    expect(candidateFlows([f(1, 'simulator')], ch, kinds, null)).toEqual([1]);
    expect(candidateFlows([f(1, 'waba')], ch, kinds, null)).toEqual([]);
    expect(candidateFlows([f(1, 'telegram-unknown')], ch, kinds, null)).toEqual([]);
  });

  it('a flow tied to a channel answers there only, whatever its engine says', () => {
    expect(candidateFlows([f(1, 'waba', 10)], ch, kinds, null)).toEqual([1]);
    expect(candidateFlows([f(1, 'simulator', 11)], ch, kinds, null)).toEqual([]);
  });

  it('orders by flow id, and puts the live run flow first when it is a candidate', () => {
    const flows = [
      f(9, 'simulator'),
      f(3, 'simulator'),
      f(5, 'simulator', 10),
      f(7, 'simulator', 99),
    ];
    expect(candidateFlows(flows, ch, kinds, null)).toEqual([3, 5, 9]);
    expect(candidateFlows(flows, ch, kinds, 9)).toEqual([9, 3, 5]);
    // A live run in a flow that cannot answer here does not add it.
    expect(candidateFlows(flows, ch, kinds, 7)).toEqual([3, 5, 9]);
    expect(candidateFlows(flows, ch, kinds, 404)).toEqual([3, 5, 9]);
  });

  it('nothing in, nothing out; a flow listed twice is one candidate', () => {
    expect(candidateFlows([], ch, kinds, 1)).toEqual([]);
    expect(candidateFlows([f(2, 'simulator'), f(2, 'simulator')], ch, kinds, null)).toEqual([2]);
  });
});

describe('pickAttempt: the flow that speaks for a message', () => {
  const a = (
    flowId: number,
    outcome: FlowAttempt['outcome'],
    score: number | null,
  ): FlowAttempt => ({
    flowId,
    outcome,
    score,
  });

  it('the best answered score wins, even when another flow scored higher without answering', () => {
    const picked = pickAttempt(
      [a(1, 'below_threshold', 0.9), a(2, 'answered', 0.6), a(3, 'answered', 0.7)],
      null,
    );
    expect(picked?.flowId).toBe(3);
  });

  it('a tie goes to the live run flow, then to the lowest flow id', () => {
    const tie = [a(5, 'answered', 0.8), a(2, 'answered', 0.8), a(9, 'answered', 0.8)];
    expect(pickAttempt(tie, 9)?.flowId).toBe(9);
    expect(pickAttempt(tie, null)?.flowId).toBe(2);
    expect(pickAttempt(tie, 404)?.flowId).toBe(2);
  });

  it('scores are compared at four decimals (the number on screen decides)', () => {
    expect(pickAttempt([a(2, 'answered', 0.80001), a(1, 'answered', 0.80004)], null)?.flowId).toBe(
      1,
    );
    expect(pickAttempt([a(2, 'answered', 0.8001), a(1, 'answered', 0.8)], null)?.flowId).toBe(2);
  });

  it('when none answered the nearest candidate speaks; a flow with no score ranks last', () => {
    expect(
      pickAttempt(
        [a(1, 'no_faqs', null), a(2, 'below_threshold', 0.3), a(3, 'low_margin', 0.4)],
        null,
      )?.flowId,
    ).toBe(3);
    expect(pickAttempt([a(1, 'provider_error', null), a(2, 'no_faqs', null)], 2)?.flowId).toBe(2);
  });

  it('no attempts, no speaker', () => {
    expect(pickAttempt([], 1)).toBeNull();
  });
});
