import { describe, expect, it } from 'vitest';
import { summarize } from './release-summary';

describe('summarize (a PR description as a few plain sentences)', () => {
  it('drops headings and list marks and keeps the sentences', () => {
    const body =
      '## Summary\n\n- The picker sent one request per ticked channel.\n- It now sends one request for all of them.';
    expect(summarize(body)).toBe(
      'The picker sent one request per ticked channel. It now sends one request for all of them.',
    );
  });

  it('removes bold, code marks and link targets', () => {
    expect(summarize('Uses **bold**, `code` and [a link](https://example.com/x).')).toBe(
      'Uses bold, code and a link.',
    );
  });

  it('drops tables, quotes, code blocks and tool footers', () => {
    const body = [
      'Fixes the italic title.',
      '| a | b |',
      '> quoted',
      '```',
      'const x = 1;',
      '```',
      '🤖 Generated with Claude Code',
      'Co-Authored-By: someone',
    ].join('\n');
    expect(summarize(body)).toBe('Fixes the italic title.');
  });

  it('ends a line that has no punctuation with a full stop, so sentences do not run together', () => {
    expect(summarize('- first thing\n- second thing')).toBe('first thing. second thing.');
  });

  it('cuts a long description at the limit with an ellipsis', () => {
    const out = summarize('word '.repeat(200), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is empty when there is nothing to say', () => {
    expect(summarize('## Only a heading\n\n')).toBe('');
  });
});
