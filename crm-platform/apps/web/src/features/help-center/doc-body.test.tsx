import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocBody } from './doc-body';
import type { HelpBlock, HelpInline } from './types';

const text = (v: string): HelpInline => ({ t: 'text', v });
const render = (blocks: HelpBlock[], visible: string[] = []) =>
  renderToStaticMarkup(<DocBody blocks={blocks} visibleIds={new Set(visible)} />);

describe('DocBody', () => {
  it('renders headings with their anchor id and a focus target', () => {
    const out = render([
      { t: 'h', level: 2, id: 'setup', text: 'Setup' },
      { t: 'h', level: 3, id: 'detail', text: 'Detail' },
    ]);
    expect(out).toMatch(/<h2[^>]*id="setup"[^>]*tabindex="-1"[^>]*>Setup<\/h2>/);
    expect(out).toMatch(/<h3[^>]*id="detail"[^>]*>Detail<\/h3>/);
  });

  it('renders paragraphs, lists and a callout', () => {
    const out = render([
      {
        t: 'p',
        inline: [text('Hello '), { t: 'bold', v: 'world' }, text(' '), { t: 'code', v: 'x' }],
      },
      { t: 'ul', items: [[text('a')], [text('b')]] },
      { t: 'ol', items: [[text('one')]] },
      { t: 'note', inline: [text('Careful')] },
    ]);
    expect(out).toContain('<strong>world</strong>');
    expect(out).toContain('<code');
    expect(out).toMatch(/<ul[^>]*><li>a<\/li><li>b<\/li><\/ul>/);
    expect(out).toMatch(/<ol[^>]*><li>one<\/li><\/ol>/);
    expect(out).toMatch(/<div[^>]*role="note"[^>]*>Careful<\/div>/);
  });

  it('renders an app link and a link to a visible doc as anchors', () => {
    const out = render(
      [
        {
          t: 'p',
          inline: [
            { t: 'link', v: 'Contacts', href: '/contacts' },
            text(' '),
            { t: 'doc', v: 'Deals guide', doc: 'deals' },
          ],
        },
      ],
      ['deals'],
    );
    expect(out).toContain('href="/contacts"');
    expect(out).toContain('href="/help/deals"');
  });

  it('shows a link to a doc the person cannot see as plain text', () => {
    const out = render([{ t: 'p', inline: [{ t: 'doc', v: 'Deals guide', doc: 'deals' }] }], []);
    expect(out).toContain('Deals guide');
    expect(out).not.toContain('href=');
  });

  it('escapes text so markup in a doc can never run', () => {
    const out = render([{ t: 'p', inline: [text('<script>alert(1)</script>')] }]);
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});
