import { describe, expect, it } from 'vitest';
import {
  decodeTupleCursor,
  encodeTupleCursor,
} from '../../../src/modules/marketing-site-cms/cms-rules';
import {
  fallbackArticleSlug,
  guidebookReadMinutes,
  renderMarkdown,
  safeMarkdownHref,
} from '../../../src/modules/marketing-site-cms/guidebook-rules';

describe('guidebook reading time (WD-CMS-047 rule 2)', () => {
  it('is ceil(words / 200) with a one minute floor', () => {
    expect(guidebookReadMinutes(null)).toBe(1);
    expect(guidebookReadMinutes('')).toBe(1);
    expect(guidebookReadMinutes('word '.repeat(200))).toBe(1);
    expect(guidebookReadMinutes('word '.repeat(201))).toBe(2);
    expect(guidebookReadMinutes('word '.repeat(1000))).toBe(5);
  });
});

describe('fallback slug (WD-CMS-045 rule 1)', () => {
  it('is article- plus six lowercase letters or digits', () => {
    expect(fallbackArticleSlug()).toMatch(/^article-[a-z0-9]{6}$/);
  });
});

describe('Markdown rendering (WD-CMS-048)', () => {
  it('renders headings, emphasis, lists, quotes, code and rules', () => {
    const html = renderMarkdown(
      '# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n```\nlet a = 1 < 2;\n```',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>let a = 1 &lt; 2;</code></pre>');
  });

  it('removes a script tag and any other raw HTML (acceptance: no script in the output)', () => {
    const html = renderMarkdown(
      'Hello <script>alert(1)</script> world\n\n<img src=x onerror=alert(1)>',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).toContain('Hello alert(1) world');
  });

  it('escapes what is left so the output holds only tags the renderer wrote', () => {
    expect(renderMarkdown('1 < 2 & "x"')).toBe('<p>1 &lt; 2 &amp; &quot;x&quot;</p>');
  });

  it('keeps safe links and drops javascript: and data: targets', () => {
    expect(renderMarkdown('[docs](https://example.com/a?x=1&y=2)')).toContain(
      '<a href="https://example.com/a?x=1&amp;y=2" rel="noopener noreferrer">docs</a>',
    );
    expect(renderMarkdown('[home](/pricing)')).toContain('href="/pricing"');
    const bad = renderMarkdown(
      '[x](javascript:alert(1)) [y](data:text/html;base64,AAAA) [z](//evil.test)',
    );
    expect(bad).not.toMatch(/href/i);
    expect(bad).toContain('x');
  });

  it('does not read Markdown inside code spans', () => {
    expect(renderMarkdown('`**not bold**`')).toBe('<p><code>**not bold**</code></p>');
  });

  it('safeMarkdownHref accepts relative, anchors, http(s) and mailto only', () => {
    expect(safeMarkdownHref('/a')).toBe('/a');
    expect(safeMarkdownHref('#top')).toBe('#top');
    expect(safeMarkdownHref('mailto:a@b.test')).toBe('mailto:a@b.test');
    expect(safeMarkdownHref('javascript:alert(1)')).toBeNull();
    expect(safeMarkdownHref('//evil.test')).toBeNull();
    expect(safeMarkdownHref('')).toBeNull();
  });
});

describe('tuple cursor', () => {
  it('round-trips and refuses anything malformed', () => {
    const c = encodeTupleCursor(['Billing', 3, 'Title', 42]);
    expect(decodeTupleCursor(c, 4)).toEqual(['Billing', 3, 'Title', 42]);
    expect(() => decodeTupleCursor(c, 3)).toThrow();
    expect(() => decodeTupleCursor('not-a-cursor', 2)).toThrow();
    expect(() => decodeTupleCursor(Buffer.from('{"a":1}').toString('base64url'), 1)).toThrow();
  });
});
