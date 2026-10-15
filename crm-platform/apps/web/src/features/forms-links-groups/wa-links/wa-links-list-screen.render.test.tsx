import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { WaChatLink, WaChatLinkList } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { WA_CHAT_LINK_KEYS } from '../api/wa-chat-links-hooks';
import { WaLinksListScreen } from './wa-links-list-screen';

const link = (over: Partial<WaChatLink> = {}): WaChatLink => ({
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Summer sale',
  slug: 'summer-sale',
  countryCode: '+1',
  phoneNumber: '5551234567',
  welcomeMessage: 'Hi! Tell me more about the sale.',
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  clickCount: 12,
  lastClickedAt: '2026-10-08T00:00:00.000Z',
  expiresAt: null,
  status: 'active',
  isLive: true,
  waUrl: 'https://wa.me/15551234567?text=Hi!%20Tell%20me%20more%20about%20the%20sale.',
  shortPath: '/l/summer-sale',
  createdAt: '2026-10-08T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

const list = (items: WaChatLink[]): WaChatLinkList => ({
  items,
  stats: {
    all: items.length,
    live: items.filter((l) => l.isLive).length,
    totalClicks: items.reduce((n, l) => n + l.clickCount, 0),
    avgClicksPerLink: items.length ? items.reduce((n, l) => n + l.clickCount, 0) / items.length : 0,
  },
  page: { nextCursor: null, hasMore: false, limit: 20 },
});

const ALL = {
  'wfl.links.read': 'all',
  'wfl.links.create': 'all',
  'wfl.links.manage': 'all',
  'wfl.links.delete': 'all',
} as const;

function render(links: WaChatLink[], opts: { locale?: 'en' | 'ar' } = {}) {
  const seed: Seed = [[WA_CHAT_LINK_KEYS.list('all'), list(links)]];
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <WaLinksListScreen />
    </ToastProvider>,
    { locale: opts.locale, session: makeSession({ permissions: ALL as never }), seed },
  );
}

describe('the WhatsApp Links list screen', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`draws the KPI tiles and the links table in ${locale}`, () => {
      const html = render(
        [link(), link({ id: '4444', name: 'Winter promo', status: 'paused', isLive: false })],
        {
          locale,
        },
      );
      expect(html).toContain('Summer sale');
      expect(html).toContain('Winter promo');
      expect(html).toContain('/l/summer-sale');
    });
  }

  it('shows the empty state with no links', () => {
    const html = render([]);
    expect(html).toContain('No links yet');
  });
});
