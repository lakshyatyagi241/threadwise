import { describe, expect, it } from 'vitest';
import { chunkText } from '../../../src/modules/knowledge-base/kb-chunker';
import { MAX_CHUNKS_PER_SOURCE } from '../../../src/modules/knowledge-base/kb.rules';

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n\n ')).toEqual([]);
  });

  it('keeps a short note as one passage', () => {
    expect(chunkText('We are open 9 to 5.\n\nClosed on Sundays.')).toEqual([
      'We are open 9 to 5.\n\nClosed on Sundays.',
    ]);
  });

  it('puts every FAQ question with its answer in a passage of its own', () => {
    const faq =
      'Q: Where is my order?\nA: Ships in 2 days.\n\nQ: Can I return it?\nA: Within 30 days.\n\nQ: Do you ship abroad?\nA: Yes.';
    expect(chunkText(faq, 900, 120)).toEqual([
      'Q: Where is my order?\nA: Ships in 2 days.',
      'Q: Can I return it?\nA: Within 30 days.',
      'Q: Do you ship abroad?\nA: Yes.',
    ]);
  });

  it('splits long text on sentence ends and repeats a little context at each cut', () => {
    const sentence = 'The store opens at nine and closes at five every weekday. ';
    const out = chunkText(sentence.repeat(40), 300, 60);
    expect(out.length).toBeGreaterThan(3);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(300 + 61);
    // The second passage starts with the end of the first.
    const lastWords = out[0]!.trim().split(' ').slice(-2).join(' ');
    expect(out[1]!.startsWith(lastWords) || out[1]!.includes(lastWords)).toBe(true);
  });

  it('cuts a long unbroken string by characters', () => {
    expect(chunkText('x'.repeat(2500), 900, 0).map((c) => c.length)).toEqual([900, 900, 700]);
  });

  it('never makes more passages than the cap', () => {
    const lots = Array.from(
      { length: MAX_CHUNKS_PER_SOURCE + 50 },
      (_, i) => `Q: q${i}\nA: a${i}`,
    ).join('\n\n');
    expect(chunkText(lots)).toHaveLength(MAX_CHUNKS_PER_SOURCE);
  });

  it('drops NUL and normalises line endings', () => {
    expect(chunkText('a\u0000b\r\nc')).toEqual(['ab\nc']);
  });
});
