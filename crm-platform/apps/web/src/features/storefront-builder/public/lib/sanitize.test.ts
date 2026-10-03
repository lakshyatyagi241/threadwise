import { describe, expect, it } from 'vitest';
import { sanitizeHtml, stripTags } from './sanitize';

describe('sanitizeHtml', () => {
  it('removes script elements with their content', () => {
    expect(sanitizeHtml('<p>Hi</p><script>alert(1)</script>', 'rich')).toBe('<p>Hi</p>');
  });

  it('drops event handlers, styles and classes, keeps the tag', () => {
    expect(sanitizeHtml('<p onclick="x()" style="color:red" class="a">t</p>')).toBe('<p>t</p>');
    expect(sanitizeHtml('<img src="https://a/b.png" onerror="x()">')).toBe(
      '<img src="https://a/b.png" alt="" loading="lazy">',
    );
  });

  it('refuses javascript: links however they are written', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVa\tScRiPt:alert(1)',
      '&#106;avascript:alert(1)',
      'data:text/html,x',
      '//evil.test',
    ]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`)).toBe('<a>x</a>');
    }
    expect(sanitizeHtml('<a href="https://ok.test/?a=1&b=2">x</a>')).toBe(
      '<a href="https://ok.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it('drops iframes, svg and unknown tags but keeps their text', () => {
    expect(
      sanitizeHtml(
        '<iframe src="x">inner</iframe><custom>kept</custom><svg><script>1</script></svg>',
      ),
    ).toBe('kept');
  });

  it('allows only emphasis in the inline profile (hero)', () => {
    expect(
      sanitizeHtml('Fresh <em>drops</em><p>block</p><img src="https://x/y.png">', 'inline'),
    ).toBe('Fresh <em>drops</em>block');
  });

  it('closes what it opened and escapes stray brackets', () => {
    expect(sanitizeHtml('<b>bold <i>both')).toBe('<b>bold <i>both</i></b>');
    expect(sanitizeHtml('1 < 2 > 0 & done')).toBe('1 &lt; 2 &gt; 0 &amp; done');
    expect(sanitizeHtml('a &amp; b')).toBe('a &amp; b');
    expect(sanitizeHtml('<!-- c --><p>x</p>')).toBe('<p>x</p>');
    expect(sanitizeHtml(null)).toBe('');
  });

  it('survives hostile attribute syntax', () => {
    const out = sanitizeHtml('<p title="a" onmouseover=alert(1) "><b/onclick=x()>t</b></p>');
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).not.toMatch(/<script/i);
  });
});

describe('stripTags', () => {
  it('leaves plain text', () => {
    expect(stripTags('<p>Hello&nbsp;<b>World</b> &amp; co</p><script>x</script>')).toBe(
      'Hello World & co',
    );
    expect(stripTags(null)).toBe('');
  });
});
