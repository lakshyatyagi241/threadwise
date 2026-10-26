import { parseLegalHtml } from './legal-html';

const text = (runs: { text: string }[]) => runs.map((run) => run.text).join('');

describe('parseLegalHtml', () => {
  it('reads paragraphs, with the whitespace between tags collapsed', () => {
    const blocks = parseLegalHtml('<p>By using   Desk\n you agree.</p>\n<p>Second one.</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => (b.t === 'p' ? text(b.runs) : ''))).toEqual([
      'By using Desk you agree.',
      'Second one.',
    ]);
  });

  it('keeps bold, italic and underline as written, nested or not', () => {
    const [block] = parseLegalHtml('<p>a <strong>b <em>c</em></strong> <u>d</u> e</p>');
    expect(block?.t === 'p' && block.runs).toEqual([
      { text: 'a ' },
      { text: 'b ', bold: true },
      { text: 'c', bold: true, italic: true },
      { text: ' ' },
      { text: 'd', underline: true },
      { text: ' e' },
    ]);
  });

  it('keeps only https and mail links, and shows any other as plain text', () => {
    const [block] = parseLegalHtml(
      '<p><a href="https://example.com/x">site</a> <a href="mailto:a@b.co">mail</a> <a href="javascript:alert(1)">bad</a> <a href="/rel">rel</a></p>',
    );
    const runs = block?.t === 'p' ? block.runs : [];
    expect(runs.filter((r) => r.href).map((r) => r.href)).toEqual([
      'https://example.com/x',
      'mailto:a@b.co',
    ]);
    expect(text(runs)).toBe('site mail bad rel');
  });

  it('numbers an ordered list, bullets an unordered one, and indents a nested one', () => {
    const blocks = parseLegalHtml(
      '<ol><li>One</li><li>Two<ul><li>Inner</li></ul></li></ol><ul><li>Dot</li></ul>',
    );
    expect(blocks.map((b) => (b.t === 'li' ? [b.marker, b.depth, text(b.runs)] : b.t))).toEqual([
      ['1.', 0, 'One'],
      ['2.', 0, 'Two'],
      ['•', 1, 'Inner'],
      ['•', 0, 'Dot'],
    ]);
  });

  it("puts a paragraph inside a list item under the item's own bullet, once", () => {
    const blocks = parseLegalHtml('<ul><li><p>First</p><p>More</p></li></ul>');
    expect(blocks.map((b) => (b.t === 'li' ? [b.marker, text(b.runs)] : b.t))).toEqual([
      ['•', 'First'],
      ['', 'More'],
    ]);
  });

  it('reads headings, quotes, rules and line breaks', () => {
    const blocks = parseLegalHtml('<h2>Title</h2><blockquote>Quoted</blockquote><hr><p>a<br>b</p>');
    expect(blocks.map((b) => b.t)).toEqual(['h', 'quote', 'rule', 'p']);
    expect(blocks[0]).toMatchObject({ t: 'h', level: 2 });
    expect(blocks[3]?.t === 'p' && text(blocks[3].runs)).toBe('a\nb');
  });

  it('decodes character references, and leaves an unknown one alone', () => {
    const [block] = parseLegalHtml('<p>Tom &amp; Jerry &lt;3 &#169; &#x2014; &bogus;</p>');
    expect(block?.t === 'p' && text(block.runs)).toBe('Tom & Jerry <3 © — &bogus;');
  });

  it('drops scripts and styles with their text, and unknown tags but not their text', () => {
    const blocks = parseLegalHtml(
      '<p>Hi<script>alert(1)</script><style>p{}</style> <blink>there</blink></p>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.t === 'p' && text(blocks[0].runs)).toBe('Hi there');
  });

  it('reads a table row as one line with the cells apart, and survives unclosed tags', () => {
    const blocks = parseLegalHtml('<table><tr><td>A</td><td>B</td></tr></table><p>Open <b>bold');
    expect(blocks[0]?.t === 'p' && text(blocks[0].runs)).toBe('A | B');
    expect(blocks[1]?.t === 'p' && text(blocks[1].runs)).toBe('Open bold');
  });

  it('gives nothing for empty or whitespace-only input', () => {
    expect(parseLegalHtml('')).toEqual([]);
    expect(parseLegalHtml('  <p> </p> \n ')).toEqual([]);
  });
});
