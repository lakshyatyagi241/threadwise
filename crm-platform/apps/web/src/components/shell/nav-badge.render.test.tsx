import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedNavItem } from '@/features/_registry/types';
import ar from '../../../messages/ar/shell.json';
import en from '../../../messages/en/shell.json';
import { NavCountsContext, type NavCounts } from './nav-badges';
import type { NavSection } from './nav-model';
import { NavDrawer, NavPanel, NavRail } from './nav-rail';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

const item = (over: Partial<ResolvedNavItem> & Pick<ResolvedNavItem, 'id' | 'group'>) =>
  ({
    labelKey: 'labels.inbox',
    href: `/${over.id}`,
    icon: 'inbox',
    locked: false,
    comingSoon: false,
    ...over,
  }) as ResolvedNavItem;

const INBOX = item({ id: 'inbox', group: 'inbox', counter: 'inbox-unread' });
const OTHER = item({
  id: 'contacts',
  group: 'audience',
  labelKey: 'labels.contacts',
  icon: 'contacts',
});
const TEAM = item({
  id: 'team-chat',
  group: 'inbox',
  labelKey: 'labels.team',
  icon: 'team',
  href: '/team-chat',
});

const messages = (locale: 'en' | 'ar') => ({
  ...(locale === 'en' ? en : ar),
  labels:
    locale === 'en'
      ? { inbox: 'Team inbox', contacts: 'Contacts', team: 'Team chat' }
      : { inbox: 'صندوق الفريق', contacts: 'جهات الاتصال', team: 'دردشة الفريق' },
});

const render = (el: ReactElement, counts: NavCounts, locale: 'en' | 'ar' = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages(locale) as never}>
      <NavCountsContext.Provider value={counts}>{el}</NavCountsContext.Provider>
    </NextIntlClientProvider>,
  );

const single: NavSection[] = [
  { group: 'inbox', items: [INBOX] },
  { group: 'audience', items: [OTHER] },
];
const grouped: NavSection[] = [{ group: 'inbox', items: [INBOX, TEAM] }, ...single.slice(1)];

describe('the Inbox badge in the labelled panel (drawer)', () => {
  const panel = (counts: NavCounts, locale: 'en' | 'ar' = 'en') =>
    render(<NavPanel sections={single} activeId={undefined} />, counts, locale);

  it('shows the unread count on the Inbox entry only', () => {
    const out = panel({ 'inbox-unread': 7 });
    expect(out).toMatch(/data-testid="nav-count"[^>]*><span aria-hidden="true">7<\/span>/);
    expect((out.match(/data-testid="nav-count"/g) ?? []).length).toBe(1);
    expect(out).toContain('7 unread');
  });

  it('caps at 99+ and hides at 0 or while the number is unknown', () => {
    expect(panel({ 'inbox-unread': 250 })).toContain('>99+<');
    expect(panel({ 'inbox-unread': 0 })).not.toContain('nav-count');
    expect(panel({})).not.toContain('nav-count');
  });

  it('reads in Arabic with the right plural for a screen reader', () => {
    const out = panel({ 'inbox-unread': 3 }, 'ar');
    expect(out).toContain('3 غير مقروءة');
    expect(out).toContain('صندوق الفريق');
    expect(panel({ 'inbox-unread': 2 }, 'ar')).toContain('اثنان غير مقروءين');
  });

  it('does not badge a locked or coming-soon Inbox entry', () => {
    const locked = [{ group: 'inbox' as const, items: [{ ...INBOX, locked: true }] }];
    const soon = [{ group: 'inbox' as const, items: [{ ...INBOX, comingSoon: true }] }];
    expect(
      render(<NavPanel sections={locked} activeId={undefined} />, { 'inbox-unread': 5 }),
    ).not.toContain('nav-count');
    expect(
      render(<NavPanel sections={soon} activeId={undefined} />, { 'inbox-unread': 5 }),
    ).not.toContain('nav-count');
  });

  it('keeps the New pill for an entry with no counter', () => {
    const sections: NavSection[] = [{ group: 'audience', items: [{ ...OTHER, badge: 'new' }] }];
    const out = render(<NavPanel sections={sections} activeId={undefined} />, {
      'inbox-unread': 5,
    });
    expect(out).toContain('>New<');
    expect(out).not.toContain('nav-count');
  });
});

describe('the Inbox badge on the slim rail', () => {
  const rail = (sections: NavSection[], counts: NavCounts, locale: 'en' | 'ar' = 'en') =>
    render(<NavRail sections={sections} activeId={undefined} />, counts, locale);

  it('puts the count on the Inbox icon when the Inbox is a plain link, and names it in the label', () => {
    const out = rail(single, { 'inbox-unread': 12 });
    expect(out).toContain('aria-label="Team inbox, 12 unread"');
    expect(out).toMatch(/data-testid="rail-count"[^>]*>12</);
  });

  it('puts the group sum on the group icon when the Inbox shares a group with other screens', () => {
    const out = rail(grouped, { 'inbox-unread': 4 });
    expect(out).toContain('aria-label="Inbox &amp; Chat, 4 unread"');
    expect(out).toMatch(/data-testid="rail-count"[^>]*>4</);
  });

  it('shows nothing at 0 and nothing without a provider value, and never "0"', () => {
    for (const counts of [{ 'inbox-unread': 0 }, {}] as NavCounts[]) {
      const out = rail(single, counts);
      expect(out).not.toContain('rail-count');
      expect(out).toContain('aria-label="Team inbox"');
    }
  });

  it('caps the rail count at 99+', () => {
    expect(rail(single, { 'inbox-unread': 1000 })).toMatch(/data-testid="rail-count"[^>]*>99\+</);
  });

  it('is mirrored by logical positioning (end, never right) so it sits on the correct corner in Arabic', () => {
    const out = rail(single, { 'inbox-unread': 5 }, 'ar');
    const badge = out.match(/<span[^>]*data-testid="rail-count"[^>]*>/)?.[0] ?? '';
    expect(badge).toContain('-end-1');
    expect(badge).not.toMatch(/\b(?:right|left)-/);
    expect(out).toContain('5 غير مقروءة');
  });
});

describe('the Inbox badge in the phone drawer', () => {
  it('shows the same count when the drawer is open', () => {
    const out = render(
      <NavDrawer
        open
        onClose={() => undefined}
        sections={single}
        activeId={undefined}
        returnFocusTo={{ current: null }}
      />,
      { 'inbox-unread': 9 },
    );
    expect(out).toContain('9 unread');
  });
});
