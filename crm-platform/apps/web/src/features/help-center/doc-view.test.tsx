import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocView } from './doc-view';
import type { HelpBlock, HelpIndexEntry } from './types';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'help-center.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const entry = (id: string, over: Partial<HelpIndexEntry> = {}): HelpIndexEntry => ({
  id,
  area: 'sales',
  order: 1,
  title: `Guide ${id}`,
  summary: `About ${id}`,
  keywords: [],
  routes: [],
  headings: [],
  fallback: false,
  ...over,
});
const h = (id: string, level: 2 | 3 = 2): HelpBlock => ({
  t: 'h',
  level,
  id,
  text: `Heading ${id}`,
});
const base = {
  id: 'deals',
  area: 'sales' as const,
  title: 'Deals',
  summary: 'Track opportunities.',
  blocks: [h('a'), { t: 'p' as const, inline: [{ t: 'text' as const, v: 'Body' }] }, h('b')],
  fallback: false,
  entries: [entry('deals')],
};

describe('DocView', () => {
  it('shows the breadcrumb, title and summary', () => {
    const out = html(<DocView {...base} />);
    expect(out).toMatch(/<a[^>]*href="\/help"[^>]*>[^<]*All help<\/a>/);
    expect(out).toMatch(/<h1[^>]*>Deals<\/h1>/);
    expect(out).toContain('Track opportunities.');
  });

  it('lists "On this page" only when there are at least two headings', () => {
    const two = html(<DocView {...base} />);
    expect(two).toContain('On this page');
    expect(two).toContain('href="#a"');
    expect(two).toContain('href="#b"');
    const one = html(<DocView {...base} blocks={[h('a')]} />);
    expect(one).not.toContain('On this page');
  });

  it('says when the guide is shown in English because it is not translated', () => {
    expect(html(<DocView {...base} fallback />)).toContain('not translated into your language');
    expect(html(<DocView {...base} />)).not.toContain('not translated into your language');
  });

  it('lists the guides of the same area in the sidebar, marks this one, and never shows another area', () => {
    const others = ['a', 'b'].map((id) => entry(`g-${id}`));
    const out = html(
      <DocView
        {...base}
        entries={[entry('deals'), ...others, entry('elsewhere', { area: 'inbox' })]}
      />,
    );
    expect(out).toContain('>Sales<');
    expect(out).toContain('href="/help/g-a"');
    expect(out).toContain('aria-current="page"');
    expect(out).not.toContain('href="/help/elsewhere"');
  });

  it('offers to open the documented screen when there is one', () => {
    expect(html(<DocView {...base} screenHref="/deals" />)).toMatch(
      /<a[^>]*href="\/deals"[^>]*>Open this screen<\/a>/,
    );
    expect(html(<DocView {...base} />)).not.toContain('Open this screen');
  });

  it('shows a link to a guide that is not visible as plain text', () => {
    const out = html(
      <DocView
        {...base}
        blocks={[{ t: 'p', inline: [{ t: 'doc', v: 'Hidden guide', doc: 'hidden' }] }]}
      />,
    );
    expect(out).toContain('Hidden guide');
    expect(out).not.toContain('href="/help/hidden"');
  });
});
