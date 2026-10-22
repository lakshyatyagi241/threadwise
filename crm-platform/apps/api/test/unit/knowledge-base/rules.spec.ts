import { describe, expect, it } from 'vitest';
import {
  isSearchable,
  normalise,
  pickPassages,
  queryText,
  sourceText,
  toVectorLiteral,
} from '../../../src/modules/knowledge-base/kb.rules';

const p = (label: string, score: number) => ({ label, text: `${label} text`, score });

describe('pickPassages (top-3 with a floor and a band)', () => {
  it('returns nothing when no passage reaches the floor', () => {
    expect(pickPassages([p('a', 0.2), p('b', 0.1)], 0.3)).toEqual([]);
  });

  it('takes at most three, best first', () => {
    const out = pickPassages([p('d', 0.58), p('a', 0.6), p('c', 0.59), p('b', 0.595)], 0.3);
    expect(out.map((r) => r.label)).toEqual(['a', 'b', 'c']);
  });

  it('leaves out a weak passage that sits far below the best one (no blending)', () => {
    const out = pickPassages([p('best', 0.7), p('close', 0.65), p('weak', 0.35)], 0.3);
    expect(out.map((r) => r.label)).toEqual(['best', 'close']);
  });

  it('keeps one passage when the best stands alone', () => {
    expect(pickPassages([p('only', 0.5), p('far', 0.3)], 0.3).map((r) => r.label)).toEqual([
      'only',
    ]);
  });

  it('respects a different model floor', () => {
    expect(pickPassages([p('a', 0.5)], 0.55)).toEqual([]);
  });
});

describe('query and vector helpers', () => {
  it('queryText collapses whitespace and cuts at the cap', () => {
    expect(queryText('  where   is\nmy order ')).toBe('where is my order');
    expect(Array.from(queryText('x'.repeat(5000)))).toHaveLength(2000);
  });

  it('isSearchable ignores an emoji, a lone mark and one character', () => {
    expect(isSearchable('ok')).toBe(true);
    expect(isSearchable('?')).toBe(false);
    expect(isSearchable('👍👍')).toBe(false);
    expect(isSearchable('a')).toBe(false);
  });

  it('normalise gives a unit vector and leaves zero alone', () => {
    expect(Math.hypot(...normalise([3, 4]))).toBeCloseTo(1, 6);
    expect(normalise([0, 0])).toEqual([0, 0]);
  });

  it('toVectorLiteral is pgvector text and replaces non-finite numbers', () => {
    expect(toVectorLiteral([0.5, 1, Number.NaN])).toBe('[0.5,1,0]');
  });
});

describe('sourceText', () => {
  it('reads a Q&A entry as question and answer, others as their content', () => {
    expect(sourceText({ kind: 'qa', content: null, question: ' Hours? ', answer: ' 9-5 ' })).toBe(
      'Q: Hours?\nA: 9-5',
    );
    expect(sourceText({ kind: 'text', content: ' Hello ', question: null, answer: null })).toBe(
      'Hello',
    );
    expect(sourceText({ kind: 'url', content: null, question: null, answer: null })).toBe('');
  });
});
