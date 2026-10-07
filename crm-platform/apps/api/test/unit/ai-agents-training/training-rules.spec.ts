import { describe, expect, it } from 'vitest';
import {
  clampContent,
  copyName,
  copySlug,
  decodeEntities,
  extensionOf,
  pageText,
  slugBase,
  stripHtml,
  tokensEstimate,
  uniqueSlug,
} from '../../../src/modules/ai-agents-training/training-rules';

describe('tokensEstimate (WD-AIAG-006: about one token per four characters, rounded up)', () => {
  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 2],
    [400, 100],
    [401, 101],
  ])('%i characters is %i tokens', (chars, tokens) => {
    expect(tokensEstimate(chars)).toBe(tokens);
  });
});

describe('slugs (WD-AIAG-002)', () => {
  it('lower-cases words and joins them with a dash', () => {
    expect(slugBase('Pricing Concierge')).toBe('pricing-concierge');
    expect(slugBase('  Über  Support!! ')).toBe('uber-support');
  });

  it('a name with no letters or digits gets a random assistant- slug', () => {
    expect(slugBase('!!!')).toMatch(/^assistant-[0-9a-f]{6}$/);
    expect(slugBase('日本語')).toMatch(/^assistant-[0-9a-f]{6}$/);
  });

  it('never ends in a dash after the length cut', () => {
    const s = slugBase(`${'a'.repeat(59)} b`);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });

  it('takes the first free number: base, base-2, base-3', () => {
    expect(uniqueSlug('faq', new Set())).toBe('faq');
    expect(uniqueSlug('faq', new Set(['faq']))).toBe('faq-2');
    expect(uniqueSlug('faq', new Set(['faq', 'faq-2', 'faq-4']))).toBe('faq-3');
  });

  it('a duplicate keeps the slug and adds copy plus four hex characters', () => {
    expect(copySlug('faq')).toMatch(/^faq-copy-[0-9a-f]{4}$/);
    expect(copyName('FAQ bot')).toBe('FAQ bot (copy)');
  });
});

describe('page text (WD-AIAG-007: scripts and styles are not knowledge)', () => {
  it('drops script, style and comment blocks, then every tag, then collapses whitespace', () => {
    const html = `<html><head><style>body{color:red}</style><script>var secret = 1;</script></head>
      <body><!-- hidden --><h1>Refund   policy</h1><p>Refunds take&nbsp;3-5 days &amp; are free.</p></body></html>`;
    expect(pageText(html)).toBe('Refund policy Refunds take 3-5 days & are free.');
  });

  it('cuts a very long page at 80 000 characters', () => {
    expect(pageText(`<p>${'x '.repeat(100_000)}</p>`).length).toBeLessThanOrEqual(80_000);
  });

  it('a page of markup only has no text', () => {
    expect(pageText('<div><img src="a.png"></div><script>1</script>')).toBe('');
  });

  it('decodes numeric and named entities and leaves unknown ones alone', () => {
    expect(decodeEntities('&#65;&#x42; &lt;b&gt; &unknown;')).toBe('AB <b> &unknown;');
    expect(decodeEntities('&#0; &#99999999;')).toBe('&#0; &#99999999;');
  });

  it('an uploaded HTML file keeps its line breaks (only tags go)', () => {
    expect(stripHtml('<p>one</p>\n<p>two</p>').trim()).toContain('\n');
  });
});

describe('file helpers (WD-AIAG-008)', () => {
  it('reads the extension case-insensitively and ignores directories', () => {
    expect(extensionOf('Handbook.PDF')).toBe('pdf');
    expect(extensionOf('C:\\docs\\a.b.docx')).toBe('docx');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });

  it('cuts extracted text at 200 000 characters and trims it', () => {
    expect(clampContent(`  ${'a'.repeat(250_000)}  `).length).toBe(200_000);
    expect(clampContent('  hi \n')).toBe('hi');
  });
});
