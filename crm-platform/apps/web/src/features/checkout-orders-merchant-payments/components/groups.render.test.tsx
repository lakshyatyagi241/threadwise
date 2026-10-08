import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/groups',
  useSearchParams: () => new URLSearchParams(),
}));

import { GroupsScreen } from './groups-screen';

const LOCALES = ['en', 'ar'] as const;
const READ = { 'store.groups.read': 'all' } as const;
const MANAGE = { ...READ, 'store.groups.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const group = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  jid: `12036302${n}@g.us`,
  subject: `Family ${n}`,
  size: 12 + n,
  devicePhone: '919876543210',
  groupCode: null,
  syncedAt: '2026-10-02T10:00:00.000Z',
  rowVersion: 1,
  ...over,
});

const page = (rows: unknown[], hasMore = false) => ({
  pages: [{ data: rows, page: { hasMore, nextCursor: hasMore ? 'c1' : null } }],
  pageParams: [undefined],
});
const LIST_KEY = [...CHK_KEYS.groups, { q: undefined }];
const SUMMARY = { total: 2, coded: 1, botNumber: '919876543210' };

const render = (
  perms: Record<string, 'all'>,
  seed: Array<readonly [readonly unknown[], unknown]>,
  locale: 'en' | 'ar',
) =>
  renderAccount(
    <ToastProvider>
      <GroupsScreen />
    </ToastProvider>,
    { locale, ...as(perms), seed },
  );

describe('GroupsScreen', () => {
  for (const locale of LOCALES) {
    it(`shows the summary, the rows and the code editor for a manager in ${locale}`, () => {
      const html = render(
        MANAGE,
        [
          [LIST_KEY, page([group(1, { groupCode: 'ACME' }), group(2)])],
          [CHK_KEYS.groupSummary, SUMMARY],
        ],
        locale,
      );
      expect(html).toContain('Family 1');
      expect(html).toContain('+919876543210');
      expect(html).toContain('12036302');
      expect(html).toContain('value="ACME"');
      expect(html).toContain('type="submit"');
      // the ordering link is offered for the group that has a code
      expect(html).toContain('<svg');
    });
  }

  it('a reader sees the code as text, with no input and no save button', () => {
    const html = render(
      READ,
      [
        [LIST_KEY, page([group(1, { groupCode: 'ACME' })])],
        [CHK_KEYS.groupSummary, SUMMARY],
      ],
      'en',
    );
    expect(html).toContain('ACME');
    expect(html).not.toContain('value="ACME"');
    expect(html).not.toContain('type="submit"');
  });

  it('without the read right it says so and loads nothing', () => {
    const html = render({}, [], 'en');
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('<table');
  });

  for (const locale of LOCALES) {
    it(`an empty directory says no groups yet and points at Channels in ${locale}`, () => {
      const html = render(
        MANAGE,
        [
          [LIST_KEY, page([])],
          [CHK_KEYS.groupSummary, { total: 0, coded: 0, botNumber: null }],
        ],
        locale,
      );
      expect(html).toContain('href="/channels"');
      expect(html).not.toContain('<table');
      if (locale === 'en') {
        expect(html).toContain('No groups yet');
        expect(html).toContain('No WhatsApp number is connected.');
      }
    });
  }

  it('shows the loading skeleton while the list has not arrived', () => {
    const html = renderAccount(
      <ToastProvider>
        <GroupsScreen />
      </ToastProvider>,
      {
        ...as(MANAGE),
        seed: [[CHK_KEYS.groupSummary, SUMMARY]],
      },
    );
    expect(html).toContain('Loading groups');
  });

  it('shows Load more while another page exists', () => {
    const html = render(
      MANAGE,
      [
        [LIST_KEY, page([group(1)], true)],
        [CHK_KEYS.groupSummary, SUMMARY],
      ],
      'en',
    );
    expect(html).toContain('Load more');
  });
});
