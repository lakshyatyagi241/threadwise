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
  readMinutes: 1,
  fallback: false,
  ...over,
});

describe('HelpHome', () => {
  it('groups guides by area, Getting started first, and links each to its page', () => {
    const out = html(
      <HelpHome
        entries={[entry('start', { area: 'getting-started' }), entry('deals', { area: 'sales' })]}
      />,
    );
    expect(out).toContain('href="/help/start"');
    expect(out).toContain('href="/help/deals"');
    expect(out.indexOf('>Sales<')).toBeGreaterThan(-1);
    // Getting started leads the whole list; the other areas follow in menu order
    expect(out.indexOf('area-getting-started')).toBeLessThan(out.indexOf('area-sales'));
    expect(out).toContain('About deals');
  });

  it('has a labelled search box with the Cmd/Ctrl+K hint, and the count of guides shown', () => {
    const out = html(<HelpHome entries={[entry('a'), entry('b')]} />);
    expect(out).toMatch(/<input[^>]*type="search"/);
    expect(out).toContain('aria-label="Search help"');
    expect(out).toContain('⌘K');
    expect(out).toMatch(/role="status"[^>]*>2 guides<\/span>/);
  });

  it('has a rail row per area with its count, and "All guides" first', () => {
    const out = html(
      <HelpHome entries={[entry('a', { area: 'sales' }), entry('b', { area: 'inbox' })]} />,
    );
    expect(out).toContain('href="/help?area=sales"');
    expect(out).toContain('href="/help?area=inbox"');
    expect(out.indexOf('All guides')).toBeLessThan(out.indexOf('href="/help?area=inbox"'));
    expect(out).toContain('Need a human?');
    expect(out).toContain('href="/support"');
  });

  it('shows one area when the rail picked it, and every guide when the area is unknown', () => {
    const entries = [entry('a', { area: 'sales' }), entry('b', { area: 'inbox' })];
    const one = html(<HelpHome entries={entries} area="inbox" />);
    expect(one).toContain('href="/help/b"');
    expect(one).not.toContain('href="/help/a"');
    expect(one).toContain('aria-current="page"');
    const all = html(<HelpHome entries={entries} area="nonsense" />);
    expect(all).toContain('href="/help/a"');
    expect(all).toContain('href="/help/b"');
  });

  it('puts the popular guides under the search box, and each card says its read time', () => {
    const out = html(
      <HelpHome
        entries={[
          entry('connect-first-whatsapp-number', { area: 'getting-started', readMinutes: 3 }),
        ]}
      />,
    );
    expect(out).toContain('Popular');
    expect(out).toContain('3 min read');
  });

  it('says so when there are no guides at all', () => {
    const out = html(<HelpHome entries={[]} />);
    expect(out).toContain('No guides yet');
    expect(out).not.toContain('href="/help/');
  });
});
