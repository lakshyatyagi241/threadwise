import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type ReferralListResponse, type ReferralRow } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { initialFilters } from '../../lib/affiliate';
import { AffiliatePage, AffiliateView, type AffiliateViewProps } from './affiliate-page';
import { ErrorState, ShareHeader } from './parts';

const WEB = resolve(__dirname, '../../../../..');
const messages = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'coupons-credits-referral-currency.json'), 'utf8'),
) as Record<string, unknown>;

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const NOW = Date.parse('2026-10-06T12:00:00Z');
const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

const row = (n: number, over: Partial<ReferralRow> = {}): ReferralRow => ({
  id: id(n),
  createdAt: '2026-10-05T10:00:00.000Z',
  refereeName: 'Ada Lovelace',
  refereeEmail: 'ada@example.com',
  codeUsed: 'ABC234',
  creditsAwardedMinor: 250,
  status: 'paid',
  walletTxId: 'aaaaaaaa-2222-4222-8222-222222222222',
  ...over,
});

const response = (over: Partial<ReferralListResponse> = {}): ReferralListResponse => ({
  currency: 'USD',
  code: 'ABC234',
  link: 'https://app.test/signup?ref=ABC234',
  rewardMinor: 250,
  messagePriceMinor: 50,
  payPerMessage: false,
  filters: { range: '90d', bucket: 'weekly', q: null },
  data: [row(1), row(2, { creditsAwardedMinor: 0, status: 'pending', walletTxId: null })],
  page: { nextCursor: 'next', hasMore: true, limit: 20, total: 45 },
  stats: {
    signupsInRange: 45,
    signupsPrevious: 40,
    deltaPercent: 12,
    signupsLifetime: 60,
    signups30d: 9,
    creditsEarnedMinor: 12500,
    credits30dMinor: 2250,
    avgPerSignupMinor: 208,
  },
  volume: [
    { start: '2026-09-14', signups: 3, creditsMinor: 500 },
    { start: '2026-09-21', signups: 5, creditsMinor: 750 },
  ],
  topCodes: [
    { code: 'ABC234', signups: 30, creditsMinor: 7500 },
    { code: 'XYZ789', signups: 1, creditsMinor: 0 },
  ],
  payouts: [
    { id: id(9), amountMinor: 250, createdAt: '2026-10-05T10:00:00.000Z', balanceAfterMinor: 4250 },
  ],
  ...over,
});

const view = (data: ReferralListResponse, over: Partial<AffiliateViewProps> = {}) =>
  wrap(
    <AffiliateView
      data={data}
      locale="en"
      now={NOW}
      filters={initialFilters()}
      searchText=""
      pageIndex={0}
      busy={false}
      exporting={false}
      onCopy={() => undefined}
      onRange={() => undefined}
      onBucket={() => undefined}
      onSearch={() => undefined}
      onReset={() => undefined}
      onExport={() => undefined}
      onPrev={() => undefined}
      onNext={() => undefined}
      {...over}
    />,
  );

describe('affiliate screen: loading', () => {
  it('shows skeletons with a status for screen readers before the first answer', () => {
    const html = wrap(<AffiliatePage />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading your affiliate data');
    expect(html).toContain('animate-pulse');
  });
});

describe('affiliate screen: populated (TW-CPN-035, 037)', () => {
  const html = view(response());

  it('shows the code and the link in the header with a copy button', () => {
    expect(html).toContain('ABC234');
    expect(html).toContain('https://app.test/signup?ref=ABC234');
    expect(html).toContain('Copy link');
  });

  it('says a first payment earns the reward, in the platform currency', () => {
    expect(html).toContain('Each referred workspace that makes a first payment earns you $2.50.');
  });

  it('shows the four KPI cards (the code is not repeated there), with the delta coloured', () => {
    for (const label of [
      'Referrals in range',
      'Earned, lifetime',
      'Referrals, last 30 days',
      'Average per referral',
    ])
      expect(html).toContain(label);
    expect(html).not.toContain('Your code');
    expect(html).toContain('$125.00');
    expect(html).toContain('$22.50 earned in the last 30 days');
    expect(html).toContain('$2.08');
    expect(html).toContain('text-success');
    expect(html).toContain('+12% vs previous period');
  });

  it('colours a falling delta as a warning and a flat one as muted', () => {
    const down = view(response({ stats: { ...response().stats, deltaPercent: -8 } }));
    expect(down).toContain('-8% vs previous period');
    expect(down).toContain('text-danger');
    const flat = view(response({ stats: { ...response().stats, deltaPercent: 0 } }));
    expect(flat).toContain('0% vs previous period');
  });

  it('draws the volume chart with Daily, Weekly and Monthly tabs and the selected one marked', () => {
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-selected="true"[^>]*>Weekly</);
    expect(html).toContain('Daily');
    expect(html).toContain('Monthly');
    expect(html).toContain('role="img"');
  });

  it('lists the top codes with a bar no thinner than 2 percent', () => {
    expect(html).toContain('Top codes');
    expect(html).toContain('XYZ789');
    expect(html).toContain('width:100%');
    expect(html).toContain('width:3%');
  });

  it('lists recent payouts with the balance after', () => {
    expect(html).toContain('Recent payouts');
    expect(html).toContain('+$2.50');
    expect(html).toContain('Balance after $42.50');
  });

  it('shows an empty payouts panel when none was paid', () => {
    expect(view(response({ payouts: [] }))).toContain('No payouts yet.');
  });

  it('offers the four ranges with the last 90 days selected', () => {
    for (const r of ['Last 7 days', 'Last 30 days', 'Last 90 days', 'All time'])
      expect(html).toContain(r);
    expect(html).toMatch(/<option value="90d" selected/);
  });

  it('has a labelled search, a Reset button and an Export CSV button', () => {
    expect(html).toContain('for="aff-search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('Reset');
    expect(html).toContain('Export CSV');
  });

  it('shows the table with its columns, paid and pending rows and the wallet transaction', () => {
    for (const c of [
      'When',
      'Referee',
      'Code used',
      'Credits earned',
      'Status',
      'Wallet transaction',
    ])
      expect(html).toContain(`>${c}</th>`);
    expect(html).toContain('scope="col"');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('>AL<');
    expect(html).toContain('>Paid<');
    expect(html).toContain('>Pending<');
    expect(html).toContain('aaaaaaaa');
    expect(html).toContain('aria-label="No wallet transaction"');
  });

  it('falls back to a generic name when the referee has none', () => {
    const h = view(response({ data: [row(3, { refereeName: null, refereeEmail: null })] }));
    expect(h).toContain('Unnamed user');
  });

  it('shows "Showing 1-2 of 45" as a live region and enables Next only when there is more', () => {
    expect(html).toContain('Showing 1-2 of 45');
    expect(html).toContain('aria-live="polite"');
    const last = view(
      response({ page: { nextCursor: null, hasMore: false, limit: 20, total: 45 } }),
      { pageIndex: 2 },
    );
    expect(last).toContain('Showing 41-42 of 45');
  });

  it('keeps the table range right on a later page', () => {
    expect(view(response(), { pageIndex: 1 })).toContain('Showing 21-22 of 45');
  });
});

describe('affiliate screen: reward line (TW-CPN-037, TW-CPN-038)', () => {
  const header = (over: Partial<ReferralListResponse>) =>
    wrap(<ShareHeader data={response(over)} locale="en" onCopy={() => undefined} />);

  it('mentions covered messages only when the platform bills per message', () => {
    expect(header({ payPerMessage: true })).toContain('That covers 5 messages.');
    expect(header({ payPerMessage: false })).not.toContain('covers');
  });

  it('says the programme pays nothing when the reward is 0', () => {
    const h = header({ rewardMinor: 0 });
    expect(h).toContain('currently pays nothing');
    expect(h).not.toContain('first payment earns you');
  });

  it('shows NO-code fallback text when the user has no code yet', () => {
    expect(header({ code: '' })).toContain('No code yet');
  });

  it('never promises a percentage or a recurring commission', () => {
    for (const over of [{}, { payPerMessage: true }, { rewardMinor: 0 }]) {
      const h = header(over).toLowerCase();
      expect(h).not.toContain('commission');
      expect(h).not.toContain('recurring');
      expect(h).not.toContain('%');
    }
  });

  it('has no commission, recurring or percent wording anywhere in the affiliate copy', () => {
    const ns = (messages['coupons-credits-referral-currency'] as Record<string, unknown>)
      .affiliate as Record<string, unknown>;
    const leaves = JSON.stringify(ns).toLowerCase();
    expect(leaves).not.toContain('commission');
    expect(leaves).not.toContain('recurring');
    expect(leaves).not.toContain('%');
  });
});

describe('affiliate screen: empty states', () => {
  it('invites a user with no referrals at all to share the link, and hides the footer', () => {
    const h = view(
      response({
        data: [],
        page: { nextCursor: null, hasMore: false, limit: 20, total: 0 },
        stats: {
          signupsInRange: 0,
          signupsPrevious: 0,
          deltaPercent: 0,
          signupsLifetime: 0,
          signups30d: 0,
          creditsEarnedMinor: 0,
          credits30dMinor: 0,
          avgPerSignupMinor: 0,
        },
        volume: [],
        topCodes: [],
        payouts: [],
      }),
    );
    expect(h).toContain('No referrals yet');
    expect(h).toContain('0% vs previous period');
    expect(h).toContain('No referrals in this range yet.');
    expect(h).toContain('No code was used in this range.');
    expect(h).not.toContain('Showing');
  });

  it('says nothing matches when a search or range hides the rows', () => {
    const h = view(
      response({ data: [], page: { nextCursor: null, hasMore: false, limit: 20, total: 0 } }),
      {
        filters: { ...initialFilters(), q: 'zzz' },
        searchText: 'zzz',
      },
    );
    expect(h).toContain('No referrals match');
    expect(h).not.toContain('No referrals yet');
    expect(h).not.toContain('Showing');
  });

  it('says nothing matches when the range is empty but the user has referrals overall', () => {
    const h = view(
      response({ data: [], page: { nextCursor: null, hasMore: false, limit: 20, total: 0 } }),
    );
    expect(h).toContain('No referrals match');
  });
});

describe('affiliate screen: error with retry', () => {
  it('picks the sentence by problem code and offers retry with the request id', () => {
    const h = wrap(
      <ErrorState
        error={new ApiError(429, ERROR_CODES.RATE_LIMITED, 'unrelated words', 'req-123')}
        onRetry={vi.fn()}
      />,
    );
    expect(h).toContain('Too many requests.');
    expect(h).toContain('req-123');
    expect(h).toContain('>Try again</button>');
  });

  it('does not read the wording of the message', () => {
    const h = wrap(<ErrorState error={new ApiError(500, 'INTERNAL', 'Too many requests.')} />);
    expect(h).toContain('Something went wrong.');
    expect(h).not.toContain('Too many requests.');
    expect(h).not.toContain('>Try again</button>');
  });

  it('says the server could not be reached for a network failure', () => {
    expect(
      wrap(<ErrorState error={new TypeError('Failed to fetch')} onRetry={vi.fn()} />),
    ).toContain('could not be reached');
  });
});
