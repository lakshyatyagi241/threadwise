import { describe, expect, it } from 'vitest';
import { parseWhatsApp, type Block, type Inline } from './whatsapp-format';

/** The kinds of the top-level runs of a single plain line. */
function runsOf(text: string, variables = false): Inline[] {
  const [b] = parseWhatsApp(text, { variables });
  if (!b || b.kind !== 'line') throw new Error('expected a plain line');
  return b.runs;
}

const kinds = (runs: Inline[]) => runs.map((r) => r.kind);

describe('WhatsApp inline formatting', () => {
  it('parses bold, italic, strike and monospace', () => {
    expect(kinds(runsOf('*bold* _it_ ~gone~ ```code```'))).toEqual([
      'bold',
      'text',
      'italic',
      'text',
      'strike',
      'text',
      'code',
    ]);
  });

  it('keeps the text inside a marker and reads nested markers', () => {
    const [b] = runsOf('*bold _and italic_ here*');
    expect(b).toEqual({
      kind: 'bold',
      children: [
        { kind: 'text', text: 'bold ' },
        { kind: 'italic', children: [{ kind: 'text', text: 'and italic' }] },
        { kind: 'text', text: ' here' },
      ],
    });
  });

  it('does not nest a marker inside the same marker', () => {
    // `*a *` cannot close (a space before the marker), so the bold is `*b*`.
    expect(runsOf('*a *b* c*')).toEqual([
      { kind: 'text', text: '*a ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' c*' },
    ]);
  });

  it('needs a word boundary on both sides, as WhatsApp does', () => {
    expect(kinds(runsOf('snake_case_name'))).toEqual(['text']);
    expect(kinds(runsOf('2*3*4'))).toEqual(['text']);
    expect(kinds(runsOf('a*b*c'))).toEqual(['text']);
  });

  it('does not open on a space or close on one', () => {
    expect(kinds(runsOf('2 * 3 * 4'))).toEqual(['text']);
    expect(kinds(runsOf('*a *'))).toEqual(['text']);
  });

  it('leaves an unmatched marker as text', () => {
    expect(runsOf('*open only')).toEqual([{ kind: 'text', text: '*open only' }]);
  });

  it('shows the inside of a monospace block as it is', () => {
    expect(runsOf('```*not bold* _x_```')).toEqual([{ kind: 'code', text: '*not bold* _x_' }]);
  });

  it('keeps a multi-line monospace block together', () => {
    const blocks = parseWhatsApp('before ```line 1\n*x*\nline 3``` after');
    expect(blocks).toHaveLength(1);
    const [b] = blocks;
    expect(b).toEqual({
      kind: 'line',
      runs: [
        { kind: 'text', text: 'before ' },
        { kind: 'code', text: 'line 1\n*x*\nline 3' },
        { kind: 'text', text: ' after' },
      ],
    });
  });

  it('draws {{name}} only when variables are on', () => {
    expect(kinds(runsOf('hi {{name}}'))).toEqual(['text']);
    expect(kinds(runsOf('hi {{name}}', true))).toEqual(['text', 'var']);
  });

  it('keeps html as text', () => {
    expect(runsOf('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ]);
  });

  it('returns no blocks for an empty text', () => {
    expect(parseWhatsApp('')).toEqual([]);
  });
});

describe('WhatsApp block formatting', () => {
  it('groups quote lines into one quote', () => {
    const blocks = parseWhatsApp('> first\n> second\nafter');
    expect(blocks.map((b) => b.kind)).toEqual(['quote', 'line']);
    const [q] = blocks;
    expect(q && q.kind === 'quote' && q.items.length).toBe(2);
  });

  it('turns "- " and "* " lines into one bullet list', () => {
    const blocks: Block[] = parseWhatsApp('- milk\n* eggs');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('ul');
  });

  it('turns "1. " lines into one numbered list', () => {
    const [b] = parseWhatsApp('1. first\n2. *second*');
    expect(b?.kind).toBe('ol');
    if (b?.kind === 'ol') {
      expect(b.items).toHaveLength(2);
      expect(b.items[1]?.[0]?.kind).toBe('bold');
    }
  });

  it('does not take a bold line for a bullet', () => {
    const [b] = parseWhatsApp('*bold line*');
    expect(b?.kind).toBe('line');
  });

  it('keeps blank lines', () => {
    const blocks = parseWhatsApp('a\n\nb');
    expect(blocks.map((b) => b.kind)).toEqual(['line', 'line', 'line']);
  });

  it('ignores a trailing newline and reads CRLF', () => {
    expect(parseWhatsApp('a\r\nb\n')).toHaveLength(2);
  });
});
