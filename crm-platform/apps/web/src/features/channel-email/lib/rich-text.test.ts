import { describe, expect, it } from 'vitest';
import {
  fillSignatureVariables,
  htmlToText,
  isBlankHtml,
  safeHref,
  sanitizeHtml,
  textToHtml,
} from './rich-text';

describe('sanitizeHtml', () => {
  it('keeps the formatting the composer makes', () => {
    const html =
      '<p>Hi <b>there</b> <i>you</i> <u>all</u></p><ul><li>one</li></ul><blockquote>q</blockquote>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('removes scripts with their content, handlers, styles and unknown tags', () => {
    const out = sanitizeHtml(
      '<p onclick="x()" style="color:red">a</p><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><iframe src="//e"></iframe><span>t</span>',
    );
    expect(out).toBe('<p>a</p>t');
    expect(out).not.toMatch(/alert|onerror|onclick|script|style/i);
  });

  it('keeps only web, mail and phone links, and makes them safe to open', () => {
    expect(sanitizeHtml('<a href="https://x.io/a?b=1&c=2">go</a>')).toBe(
      '<a href="https://x.io/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">go</a>',
    );
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="  JaVa\nScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="jav&#x61;script&colon;alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="data:text/html,<script>1</script>">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="mailto:a@b.co">m</a>')).toContain('href="mailto:a@b.co"');
  });

  it('cannot be tricked by broken or nested markup', () => {
    expect(sanitizeHtml('<scr<script>ipt>alert(1)</script>')).not.toMatch(/<script/i);
    expect(sanitizeHtml('<p>a<img src=x onerror=alert(1)//')).not.toMatch(/onerror/);
    expect(sanitizeHtml('<a href="x" onmouseover="alert(1)">x</a>')).not.toMatch(/onmouseover/);
    expect(sanitizeHtml('<!--<script>alert(1)</script>-->ok')).toBe('ok');
    expect(sanitizeHtml('<svg><script>alert(1)</script></svg>after')).toBe('after');
    expect(sanitizeHtml('<p>1 < 2</p>')).toBe('<p>1 &lt; 2</p>');
  });

  it('closes what was left open and ignores stray closers', () => {
    expect(sanitizeHtml('<p><b>a</i>b')).toBe('<p><b>ab</b></p>');
    expect(sanitizeHtml('</div>x')).toBe('x');
  });
});

describe('text conversions', () => {
  it('turns text into paragraphs, escaped', () => {
    expect(textToHtml('a <b>\nc\n\nd')).toBe('<p>a &lt;b&gt;<br>c</p><p>d</p>');
  });

  it('reads HTML back as plain text with lists, quotes and links', () => {
    const text = htmlToText(
      '<p>Hello</p><ul><li>one</li><li>two</li></ul><blockquote>old<br>text</blockquote><p><a href="https://x.io">site</a></p>',
    );
    expect(text).toBe('Hello\n- one\n- two\n\n> old\n> text\nsite (https://x.io)');
  });

  it('knows when the editor is empty', () => {
    expect(isBlankHtml('')).toBe(true);
    expect(isBlankHtml('<div><br></div>')).toBe(true);
    expect(isBlankHtml('<p>&nbsp;</p>')).toBe(true);
    expect(isBlankHtml('<p>x</p>')).toBe(false);
  });
});

describe('signature variables', () => {
  it('fills name, title and phone, escaped, and drops unknown ones', () => {
    expect(
      fillSignatureVariables('<p>{{name}} / {{ title }} / {{phone}} {{x}}</p>', {
        name: 'A <b>',
        title: 'Lead',
        phone: '+1',
      }),
    ).toBe('<p>A &lt;b&gt; / Lead / +1 </p>');
  });
});

describe('safeHref', () => {
  it('rejects everything but web, mail and phone', () => {
    expect(safeHref('https://a.io')).toBe('https://a.io');
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
  });
});
