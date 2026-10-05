import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpProvider } from './context';
import { HelpTip, PageHelpTip, tipHref } from './help-tip';
import type { HelpIndexEntry } from './types';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));
vi.mock('./actions', () => ({ getHelpTip: vi.fn() }));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'help-center.json'), 'utf8'),
) as Record<string, unknown>;
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
const html = (el: ReactElement, entries: HelpIndexEntry[]) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <HelpProvider entries={entries}>{el}</HelpProvider>
    </NextIntlClientProvider>,
  );

describe('tipHref', () => {
  it('links to the guide, and to a heading when there is an anchor', () => {
    expect(tipHref('contacts')).toBe('/help/contacts');
    expect(tipHref('contacts', 'duplicates')).toBe('/help/contacts#duplicates');
  });
});

describe('HelpTip', () => {
  it('renders nothing when its guide is not visible to this person', () => {
    expect(html(<HelpTip doc="gone" />, [entry('other')])).toBe('');
    expect(html(<HelpTip doc="gone" anchor="x" />, [])).toBe('');
  });

  it('renders one closed, named button for a visible guide', () => {
    const out = html(<HelpTip doc="deals" />, [entry('deals')]);
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('type="button"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('aria-label="Help: Guide deals"');
    expect(out).not.toContain('About deals');
  });
});

describe('PageHelpTip', () => {
  const entries = [entry('contacts', { routes: ['/contacts'] })];
  beforeEach(() => {
    nav.path = '/';
  });

  it('shows a tip on a screen that has a guide', () => {
    nav.path = '/contacts/42';
    expect(html(<PageHelpTip />, entries)).toContain('aria-label="Help: Guide contacts"');
  });

  it('shows nothing on a screen with no guide', () => {
    nav.path = '/somewhere-else';
    expect(html(<PageHelpTip />, entries)).toBe('');
  });

  it('shows nothing on the help pages themselves', () => {
    nav.path = '/help/contacts';
    expect(html(<PageHelpTip />, [entry('contacts', { routes: ['/help', '/contacts'] })])).toBe('');
  });
});
