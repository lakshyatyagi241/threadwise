import { describe, expect, it } from 'vitest';
import { degradeDocLinks, leadParagraph, plainText } from './blocks';
import type { HelpBlock, HelpInline } from './types';

const text = (v: string): HelpInline => ({ t: 'text', v });
const p = (v: string): HelpBlock => ({ t: 'p', inline: [text(v)] });
const h = (id: string, level: 2 | 3 = 2): HelpBlock => ({ t: 'h', level, id, text: id });

describe('plainText', () => {
  it('joins the runs of a paragraph', () => {
    expect(
      plainText([text('Add '), { t: 'bold', v: 'people' }, text(' in '), { t: 'code', v: 'CSV' }]),
    ).toBe('Add people in CSV');
    expect(plainText([{ t: 'link', v: 'Contacts', href: '/contacts' }])).toBe('Contacts');
  });
});

describe('leadParagraph', () => {
  const blocks = [
    p('Intro paragraph.'),
    h('setup'),
    p('Setup text.'),
    h('detail', 3),
    p('Detail text.'),
    h('next'),
    p('Next text.'),
  ];

  it('without an anchor returns the first paragraph of the doc', () => {
    expect(leadParagraph(blocks)).toBe('Intro paragraph.');
  });

  it('with an anchor returns the paragraph under that heading', () => {
    expect(leadParagraph(blocks, 'setup')).toBe('Setup text.');
    expect(leadParagraph(blocks, 'detail')).toBe('Detail text.');
  });

  it('stops at the next heading of the same or a higher level', () => {
    expect(leadParagraph([h('a'), h('b'), p('Under b.')], 'a')).toBeNull();
    expect(leadParagraph([h('a'), h('sub', 3), p('Under sub.')], 'a')).toBe('Under sub.');
  });

  it('returns null for a missing anchor or a doc with no paragraph', () => {
    expect(leadParagraph(blocks, 'gone')).toBeNull();
    expect(leadParagraph([h('a')])).toBeNull();
  });

  it('trims to 240 characters with an ellipsis', () => {
    const out = leadParagraph([p('x'.repeat(300))]);
    expect(out).toHaveLength(240);
    expect(out!.endsWith('…')).toBe(true);
    expect(leadParagraph([p('x'.repeat(240))])).toHaveLength(240);
  });
});

describe('degradeDocLinks', () => {
  const blocks: HelpBlock[] = [
    {
      t: 'p',
      inline: [
        { t: 'doc', v: 'Deals', doc: 'deals' },
        text(' and '),
        { t: 'doc', v: 'Tasks', doc: 'tasks' },
      ],
    },
    { t: 'ul', items: [[{ t: 'doc', v: 'Deals', doc: 'deals' }]] },
    { t: 'note', inline: [{ t: 'doc', v: 'Deals', doc: 'deals' }] },
  ];

  it('turns a link to an invisible doc into plain text and keeps visible ones', () => {
    const out = degradeDocLinks(blocks, new Set(['tasks']));
    expect(out[0]).toEqual({
      t: 'p',
      inline: [text('Deals'), text(' and '), { t: 'doc', v: 'Tasks', doc: 'tasks' }],
    });
    expect(out[1]).toEqual({ t: 'ul', items: [[text('Deals')]] });
    expect(out[2]).toEqual({ t: 'note', inline: [text('Deals')] });
  });

  it('leaves everything when every target is visible', () => {
    expect(degradeDocLinks(blocks, new Set(['deals', 'tasks']))).toEqual(blocks);
  });
});
