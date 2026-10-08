import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown';

describe('safeHref', () => {
  it('keeps http, https and mailto only', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      '/relative/path',
      '//evil.example',
      'ftp://x',
      '',
    ])
      expect(safeHref(bad)).toBeNull();
  });
});

describe('parseInline', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.io)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'bold', v: 'b' },
      { t: 'text', v: ' ' },
      { t: 'italic', v: 'c' },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'link', v: 'e', href: 'https://x.io/' },
    ]);
  });

  it('leaves a link with an unsafe address as the literal text', () => {
    const out = parseInline('[click](javascript:alert(1))');
    expect(out.every((p) => p.t === 'text')).toBe(true);
    expect(out.map((p) => p.v).join('')).toBe('[click](javascript:alert(1))');
  });

  it('keeps raw HTML as literal text (the renderer escapes it)', () => {
    const out = parseInline('<img src=x onerror=alert(1)> and <b>bold</b>');
    expect(out.every((p) => p.t === 'text')).toBe(true);
    expect(out.map((p) => p.v).join('')).toBe('<img src=x onerror=alert(1)> and <b>bold</b>');
  });

  it('does not treat snake_case words as italics', () => {
    expect(parseInline('use sent_total and read_rate')).toEqual([
      { t: 'text', v: 'use sent_total and read_rate' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('reads paragraphs, lists, quotes and headings', () => {
    const blocks = parseMarkdown(
      ['# Title', '', 'one', 'two', '', '- a', '- b', '', '1. x', '2. y', '', '> quoted'].join(
        '\n',
      ),
    );
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote']);
    const ul = blocks[2];
    expect(ul?.t === 'ul' && ul.items).toHaveLength(2);
  });

  it('puts body headings below the section heading', () => {
    const [h1, h2, h4] = parseMarkdown('# A\n\n## B\n\n#### C');
    expect(h1?.t === 'h' && h1.level).toBe(4);
    expect(h2?.t === 'h' && h2.level).toBe(4);
    expect(h4?.t === 'h' && h4.level).toBe(6);
  });

  it('keeps fenced code verbatim, including markup', () => {
    const [code] = parseMarkdown('```\n<script>alert(1)</script>\n**x**\n```');
    expect(code).toEqual({ t: 'code', v: '<script>alert(1)</script>\n**x**' });
  });

  it('produces only plain data: no block carries markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">hi</div>');
    expect(JSON.stringify(blocks)).not.toMatch(/"href"/);
    expect(blocks.every((b) => b.t === 'p')).toBe(true);
  });

  it('copes with empty and ragged input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\r\n\r\n')).toEqual([]);
    expect(() => parseMarkdown('**unclosed `code [link](')).not.toThrow();
  });
});
