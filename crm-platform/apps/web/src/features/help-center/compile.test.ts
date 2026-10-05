import { describe, expect, it } from 'vitest';
import {
  AREA_IDS,
  compileRegistry,
  renderGenerated,
  slugify,
} from '../../../scripts/help-compile.mjs';
import { HELP_AREAS } from './types';

const BASE = [
  'id: contacts-overview',
  'title: Contacts',
  'summary: Your customer list.',
  'area: audience',
];
const file = (front: string[] = BASE, body = '## Getting started\n\nHello **world**.\n') =>
  ['---', ...front, '---', '', body].join('\n');
const one = (source: string, name = 'a.md') =>
  compileRegistry([{ domain: 'd', file: name, source }]);
const without = (key: string) => BASE.filter((l) => !l.startsWith(`${key}:`));
const failing = (source: string, rule: RegExp) =>
  expect(() => one(source)).toThrow(new RegExp(`d/help/a\\.md: .*${rule.source}`, 'i'));

describe('compileRegistry', () => {
  it('parses frontmatter and blocks', () => {
    const [doc] = one(
      file(
        [
          ...BASE,
          'order: 10',
          'documents: [nav:contacts, tile:contact-properties]',
          'gates:',
          '  planFeature: sales_pipeline',
          'keywords: [people, leads]',
        ],
        '## Getting started\n\nText.\n',
      ),
    );
    expect(doc.id).toBe('contacts-overview');
    expect(doc.domain).toBe('d');
    expect(doc.area).toBe('audience');
    expect(doc.order).toBe(10);
    expect(doc.documents).toEqual(['nav:contacts', 'tile:contact-properties']);
    expect(doc.gates).toEqual({ planFeature: 'sales_pipeline' });
    expect(doc.keywords).toEqual(['people', 'leads']);
    expect(doc.text.en.title).toBe('Contacts');
    expect(doc.text.en.summary).toBe('Your customer list.');
    expect(doc.text.en.blocks[0]).toEqual({
      t: 'h',
      level: 2,
      id: 'getting-started',
      text: 'Getting started',
    });
  });

  it('applies defaults for the optional keys', () => {
    const [doc] = one(file());
    expect(doc.order).toBe(100);
    expect(doc.audience).toBe('workspace');
    expect(doc.routes).toEqual([]);
    expect(doc.documents).toEqual([]);
    expect(doc.gates).toEqual({});
    expect(doc.keywords).toEqual([]);
  });

  it('handles CRLF files the same as LF files', () => {
    const src = file([...BASE, 'keywords: [a, b]'], '## One\n\n- x\n- y\n\n> Note.\n');
    expect(one(src.replace(/\n/g, '\r\n'))).toEqual(one(src));
  });

  it('keeps colons, hashes and quotes inside values and skips comment lines', () => {
    const summary = 'Contacts: add, import and group people #1 "fast"';
    const [doc] = one(
      file([
        'id: contacts-overview',
        'title: Contacts',
        '# a comment line',
        `summary: ${summary}`,
        'area: audience',
      ]),
    );
    expect(doc.text.en.summary).toBe(summary);
  });

  it('parses lists, a callout, bold, code, links and doc links', () => {
    const body = [
      '## Steps',
      '',
      'Intro with **bold** and `code` and [x](/contacts) and [y](help:other).',
      '',
      '- a',
      '- b',
      '',
      '1. one',
      '2. two',
      '',
      '> Careful here.',
      '',
    ].join('\n');
    const docs = compileRegistry([
      { domain: 'd', file: 'a.md', source: file(BASE, body) },
      {
        domain: 'd',
        file: 'b.md',
        source: file(['id: other', 'title: Other', 'summary: Other doc.', 'area: sales']),
      },
    ]);
    const blocks = docs.find((d) => d.id === 'contacts-overview')!.text.en.blocks;
    const text = (v: string) => ({ t: 'text', v });
    expect(blocks).toEqual([
      { t: 'h', level: 2, id: 'steps', text: 'Steps' },
      {
        t: 'p',
        inline: [
          text('Intro with '),
          { t: 'bold', v: 'bold' },
          text(' and '),
          { t: 'code', v: 'code' },
          text(' and '),
          { t: 'link', v: 'x', href: '/contacts' },
          text(' and '),
          { t: 'doc', v: 'y', doc: 'other' },
          text('.'),
        ],
      },
      { t: 'ul', items: [[text('a')], [text('b')]] },
      { t: 'ol', items: [[text('one')], [text('two')]] },
      { t: 'note', inline: [text('Careful here.')] },
    ]);
  });

  it('gives every heading a non-empty, unique id', () => {
    const slugs = (body: string) =>
      one(file(BASE, body))[0]!
        .text.en.blocks.filter((b) => b.t === 'h')
        .map((b) => b.id);
    expect(slugify('A & B')).toBe('a-b');
    expect(slugify('الإعداد')).toBe('');
    expect(slugs('## A & B\n\ntext\n')).toEqual(['a-b']);
    expect(slugs('## Setup\n\nx\n\n## Setup\n\ny\n\n### Setup\n\nz\n')).toEqual([
      'setup',
      'setup-2',
      'setup-3',
    ]);
    expect(slugs('## الإعداد\n\nx\n\n## ???\n\ny\n')).toEqual(['section-1', 'section-2']);
  });

  it('rejects what the restricted subset does not allow', () => {
    failing(file(without('id')), /id/);
    failing(file(['id: Bad_ID', ...without('id')]), /id/);
    failing(file([...without('summary'), `summary: ${'x'.repeat(161)}`]), /summary/);
    failing(file([...without('area'), 'area: nowhere']), /area/);
    failing(file(BASE, '# H1\n\ntext\n'), /heading/);
    failing(file(BASE, '#### H4\n\ntext\n'), /heading/);
    failing(file(BASE, '<div>raw</div>\n'), /HTML/);
    failing(file(BASE, 'See [x](https://a.com).\n'), /link/);
    failing(file(BASE, 'See [x](//a.com).\n'), /link/);
    failing(file(BASE, '![img](/a.png)\n'), /image/);
    failing(file(BASE, '| a | b |\n'), /table/);
    failing(file(BASE, '```\ncode\n```\n'), /code fence/);
    failing(file(BASE, 'See [x](help:nope).\n'), /help:nope/);
    failing(file([...BASE, 'gates:', '  planFeature: [a, b]']), /planFeature/);
  });

  it('rejects a duplicate id across files', () => {
    expect(() =>
      compileRegistry([
        { domain: 'd', file: 'a.md', source: file() },
        { domain: 'e', file: 'b.md', source: file() },
      ]),
    ).toThrow(/duplicate id/i);
  });

  it('merges a translation into the same doc', () => {
    const ar = file(
      ['id: contacts-overview', 'title: جهات الاتصال', 'summary: قائمة عملائك.'],
      '## البدء\n\nنص.\n',
    );
    const [doc] = compileRegistry([
      { domain: 'd', file: 'a.md', source: file() },
      { domain: 'd', file: 'a.ar.md', source: ar },
    ]);
    expect(doc.text.ar.title).toBe('جهات الاتصال');
    expect(doc.text.ar.summary).toBe('قائمة عملائك.');
    expect(doc.text.en.title).toBe('Contacts');
    expect(doc.area).toBe('audience');
  });

  it('rejects a translation without an English file or with another id', () => {
    const ar = file(['id: contacts-overview', 'title: x', 'summary: y']);
    expect(() => compileRegistry([{ domain: 'd', file: 'a.ar.md', source: ar }])).toThrow(
      /needs an English/,
    );
    const other = file(['id: other-id', 'title: x', 'summary: y']);
    expect(() =>
      compileRegistry([
        { domain: 'd', file: 'a.md', source: file() },
        { domain: 'd', file: 'a.ar.md', source: other },
      ]),
    ).toThrow(/id must match/);
  });
});

describe('areas', () => {
  it('are the same list the data model declares', () => {
    expect([...AREA_IDS]).toEqual([...HELP_AREAS]);
  });
});

describe('renderGenerated', () => {
  it('writes a typed module holding the docs as JSON', () => {
    const docs = one(file());
    const out = renderGenerated(docs);
    expect(
      out.startsWith('// GENERATED by scripts/gen-registry.mjs. Do not edit; do not commit.'),
    ).toBe(true);
    expect(out).toContain("import type { HelpDoc } from '../help-center/types';");
    const marker = 'export const HELP_DOCS: HelpDoc[] = ';
    expect(out).toContain(marker);
    const json = out.slice(out.indexOf(marker) + marker.length).replace(/;\s*$/, '');
    expect(JSON.parse(json)).toEqual(docs);
  });
});
