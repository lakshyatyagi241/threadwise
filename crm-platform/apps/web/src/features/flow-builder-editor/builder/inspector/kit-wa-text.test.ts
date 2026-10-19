import { describe, expect, it } from 'vitest';
import { renderWaText } from './kit';

/**
 * `renderWaText` turns a flow author's WhatsApp text into HTML for the builder's message previews (bold, italic, strike, code, line
 * breaks) and the result goes into `dangerouslySetInnerHTML` at four preview sinks (QA task 31). It is safe only because it HTML-escapes
 * the author's text BEFORE adding its own tags, so these tests pin both halves: nothing the author types becomes markup, and the
 * formatting still works.
 */
describe('renderWaText: nothing the author types becomes markup', () => {
  const HOSTILE = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><svg/onload=alert(1)>',
    "' onmouseover='alert(1)",
    '<a href="javascript:alert(1)">x</a>',
    '</div><iframe src="//evil.test"></iframe>',
    '&lt;already&gt;',
  ];

  it.each(HOSTILE)('escapes %j', (input) => {
    const out = renderWaText(input);
    // The only tags the output may contain are the ones the function adds itself.
    expect(out).not.toMatch(/<(?!\/?(?:b|i|s|code|br)\b)/);
    // And no tag carries an event-handler attribute.
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
  });

  it('escapes the five HTML metacharacters', () => {
    expect(renderWaText(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('escapes first, so the ampersand of an entity is itself escaped and never decoded', () => {
    expect(renderWaText('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  it('escapes markup typed inside a formatting span too', () => {
    expect(renderWaText('*<img src=x onerror=alert(1)>*')).toBe(
      '<b>&lt;img src=x onerror=alert(1)&gt;</b>',
    );
  });

  it('turns null, undefined and numbers into text, never into an error or markup', () => {
    expect(renderWaText(null)).toBe('');
    expect(renderWaText(undefined)).toBe('');
    expect(renderWaText(42)).toBe('42');
    expect(renderWaText({ toString: () => '<b>x</b>' })).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('renderWaText: the formatting still works', () => {
  it('bold, italic, strikethrough and code', () => {
    expect(renderWaText('*bold*')).toBe('<b>bold</b>');
    expect(renderWaText('_italic_')).toBe('<i>italic</i>');
    expect(renderWaText('~gone~')).toBe('<s>gone</s>');
    expect(renderWaText('```mono```')).toBe('<code>mono</code>');
  });

  it('line breaks', () => {
    expect(renderWaText('one\ntwo')).toBe('one<br>two');
  });

  it('plain text is unchanged', () => {
    expect(renderWaText('Hello, how can we help?')).toBe('Hello, how can we help?');
  });

  it('an unmatched marker is left as text', () => {
    expect(renderWaText('5 * 3 = 15')).toBe('5 * 3 = 15');
  });
});
