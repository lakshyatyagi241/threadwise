import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpHome } from './help-home';
import type { HelpIndexEntry } from './types';

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

describe('HelpHome', () => {
  it('groups guides by area in menu order and links each to its page', () => {
    const out = html(
      <HelpHome
        entries={[entry('start', { area: 'getting-started' }), entry('deals', { area: 'sales' })]}
      />,
    );
    expect(out).toContain('href="/help/start"');
    expect(out).toContain('href="/help/deals"');
    expect(out.indexOf('>Sales<')).toBeGreaterThan(-1);
    expect(out.indexOf('>Sales<')).toBeLessThan(out.indexOf('>Getting started<'));
    expect(out).toContain('About deals');
  });

  it('has a labelled search box with the Cmd/Ctrl+K hint, and no result count until a search', () => {
    const out = html(<HelpHome entries={[entry('a'), entry('b')]} />);
    expect(out).toMatch(/<input[^>]*type="search"/);
    expect(out).toContain('aria-label="Search help"');
    expect(out).toContain('⌘K');
    expect(out).toMatch(/role="status"[^>]*><\/p>/);
  });

  it('offers a card per area that jumps to its section', () => {
    const out = html(
      <HelpHome entries={[entry('a', { area: 'sales' }), entry('b', { area: 'inbox' })]} />,
    );
    expect(out).toContain('href="#area-sales"');
    expect(out).toContain('href="#area-inbox"');
    expect(out).toContain('1 guide');
  });

  it('says so when there are no guides at all', () => {
    const out = html(<HelpHome entries={[]} />);
    expect(out).toContain('No guides yet');
    expect(out).not.toContain('href="/help/');
  });
});
