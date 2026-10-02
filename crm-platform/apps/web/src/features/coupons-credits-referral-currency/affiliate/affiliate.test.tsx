import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ReferralHistoryResponse,
  ReferralMeResponse,
  ReferralRow,
  ReferralSummaryResponse,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { downloadAffiliateCsv, exportHref } from './api';
import { AffiliatePaneBody, AffiliatePaneShell } from './components/account-pane';
import { HistoryContent, SEARCH_DEBOUNCE_MS } from './components/history-page';
import { ErrorState } from './components/state';
import { FIRST_PAGE, pushCursor } from './lib/format';
import { errorKind } from './lib/errors';
import { nav } from './nav';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const WEB = resolve(__dirname, '../../../..');
const en = JSON.parse(
  readFileSync(
    join(WEB, 'messages', 'en', 'coupons-credits-referral-currency.affiliate.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ToastProvider>{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const NOW = new Date('2026-06-10T12:00:00Z');

const me = (over: Partial<ReferralMeResponse> = {}): ReferralMeResponse => ({
  code: 'ABCDE23456',
  link: 'https://app.example.com/register?ref=ABCDE23456',
  rewardMinor: 250,
  currency: 'USD',
  creditsPerMessage: 5,
  payPerMessage: false,
  ...over,
});

const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;

const row = (n: number, over: Partial<ReferralRow> = {}): ReferralRow => ({
  id: uuid(n),
  createdAt: '2026-06-09T12:00:00Z',
  refereeName: `Person ${n}`,
  refereeEmail: `p${n}@example.com`,
  codeUsed: 'ABCDE23456',
  creditsAwardedMinor: 0,
  walletTxId: null,
  status: 'no-payout',
  ...over,
});

const history = (over: Partial<ReferralHistoryResponse> = {}): ReferralHistoryResponse => ({
  data: [],
  page: { nextCursor: null, hasMore: false, limit: 20 },
  total: 0,
  stats: {
    signupsLifetime: 0,
    creditsLifetimeMinor: 0,
    signupsRange: 0,
    creditsRangeMinor: 0,
    signups30d: 0,
    credits30dMinor: 0,
    avgPerSignupMinor: 0,
    deltaPct: 0,
  },
  volume: { labels: [], signups: [], creditsMinor: [], bucket: 'weekly' },
  topCodes: [],
  payouts: [],
  range: '90d',
  ...over,
});

function content(
  data: ReferralHistoryResponse,
  props: Partial<Parameters<typeof HistoryContent>[0]> = {},
) {
  return wrap(
    <HistoryContent
      data={data}
      me={me()}
      range="90d"
      bucket="weekly"
      onBucket={() => undefined}
      text=""
      onText={() => undefined}
      stack={FIRST_PAGE}
      onPush={() => undefined}
      onPop={() => undefined}
      onCopy={() => undefined}
      now={NOW}
      {...props}
    />,
  );
}

const rows45 = Array.from({ length: 20 }, (_, i) => row(i + 1));

describe('TW-CPN-035 affiliate history: acceptance criteria', () => {
  it('45 referrals: the table shows 20 rows, "Showing 1–20 of 45", Prev is off and Next is on', () => {
    const html = content(
      history({
        data: rows45,
        total: 45,
        page: { nextCursor: 'c2', hasMore: true, limit: 20 },
      }),
    );
    expect(html.match(/data-row=/g)).toHaveLength(20);
    expect(html).toContain('Showing');
    expect(html).toMatch(/1–20<\/span>\s*of\s*<span[^>]*>45</);
    const prev = /<button[^>]*>Prev<\/button>/.exec(html)![0];
    const next = /<button[^>]*>Next<\/button>/.exec(html)![0];
    expect(prev).toContain(' disabled=""');
    expect(next).not.toContain(' disabled=""');
  });

  it('page 2 of 45 reads 21–40 and Prev is on (cursor stack), page 3 reads 41–45 with Next off', () => {
    const p2 = content(
      history({ data: rows45, total: 45, page: { nextCursor: 'c3', hasMore: true, limit: 20 } }),
      { stack: pushCursor(FIRST_PAGE, 'c2') },
    );
    expect(p2).toMatch(/21–40/);
    expect(/<button[^>]*>Prev<\/button>/.exec(p2)![0]).not.toContain(' disabled=""');
    const p3 = content(
      history({
        data: rows45.slice(0, 5),
        total: 45,
        page: { nextCursor: null, hasMore: false, limit: 20 },
      }),
      { stack: pushCursor(pushCursor(FIRST_PAGE, 'c2'), 'c3') },
    );
    expect(p3).toMatch(/41–45/);
    expect(/<button[^>]*>Next<\/button>/.exec(p3)![0]).toContain(' disabled=""');
  });

  it('search "gmail": the KPIs keep the unfiltered figures and the table says nothing matches', () => {
    const html = content(
      history({
        data: [],
        total: 0,
        stats: {
          ...history().stats,
          signupsLifetime: 45,
          creditsLifetimeMinor: 12500,
          signups30d: 7,
        },
      }),
      { text: 'gmail' },
    );
    expect(html).toMatch(/data-kpi="signupsLifetime"[^>]*>45</);
    expect(html).toMatch(/data-kpi="creditsLifetime"[^>]*>\$125\.00</);
    expect(html).toContain('No referrals match the current filters.');
    expect(html).toContain('value="gmail"');
  });

  it('the search waits 220 ms before it asks the API', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(220);
  });

  it('range 7d draws 7 daily points; range all draws the monthly series it was sent', () => {
    const seven = content(
      history({
        range: '7d',
        volume: {
          labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
          signups: [1, 0, 2, 0, 0, 3, 1],
          creditsMinor: [0, 0, 250, 0, 0, 500, 0],
          bucket: 'daily',
        },
      }),
      { range: '7d', bucket: 'daily' },
    );
    expect(seven.match(/data-bar/g)).toHaveLength(7);
    expect(seven).toMatch(/data-bucket="daily"[^>]*aria-pressed="true"/);
    const all = content(history({ range: 'all' }), { range: 'all', bucket: 'monthly' });
    expect(all).toMatch(/data-bucket="monthly"[^>]*aria-pressed="true"/);
    expect(all).toContain('All time');
  });

  it('a 90-point daily series still draws at most 10 x labels', () => {
    const labels = Array.from({ length: 90 }, (_, i) => `D${i}`);
    const html = content(
      history({
        volume: {
          labels,
          signups: labels.map((_, i) => i % 4),
          creditsMinor: labels.map((_, i) => i * 10),
          bucket: 'daily',
        },
      }),
      { bucket: 'daily' },
    );
    expect(html.match(/data-x-label/g)).toHaveLength(10);
    expect(html.match(/data-bar/g)).toHaveLength(90);
  });

  it('a row with no payout reads "No payout" and a dash; a paid row reads Paid and tx-<first 8>', () => {
    const html = content(
      history({
        data: [
          row(1),
          row(2, {
            status: 'paid',
            creditsAwardedMinor: 250,
            walletTxId: 'abcdef12-3456-4789-8abc-def012345678',
          }),
        ],
        total: 2,
      }),
    );
    const unpaid = html.slice(
      html.indexOf(`data-row="${uuid(1)}"`),
      html.indexOf(`data-row="${uuid(2)}"`),
    );
    const paid = html.slice(html.indexOf(`data-row="${uuid(2)}"`));
    expect(unpaid).toContain('data-status="no-payout"');
    expect(unpaid).toContain('No payout');
    expect(unpaid).toContain('>—<');
    expect(unpaid).toContain('+$0.00');
    expect(paid).toContain('data-status="paid"');
    expect(paid).toContain('>Paid<');
    expect(paid).toContain('tx-abcdef12');
    expect(paid).toContain('+$2.50');
  });

  it('a row shows date and relative time, avatar initials, name, email, and code used', () => {
    const html = content(history({ data: [row(7, { refereeName: 'Aisha Khan' })], total: 1 }));
    expect(html).toContain('Jun 9, 2026');
    expect(html).toContain('1 day ago');
    expect(html).toContain('>AK<');
    expect(html).toContain('Aisha Khan');
    expect(html).toContain('p7@example.com');
    expect(html).toContain('ABCDE23456');
    expect(html).toContain(`data-avatar="${7 % 5}"`);
  });

  it('a referee without an email shows a dash; a nameless one keeps the API name "User #id"', () => {
    const html = content(
      history({ data: [row(3, { refereeName: 'User #3', refereeEmail: null })], total: 1 }),
    );
    expect(html).toContain('User #3');
    expect(html).toMatch(/font-mono text-xs text-muted-foreground">—</);
  });

  it('a user with no referrals: KPIs read 0, delta 0%, both empty states show and the footer is hidden', () => {
    const html = content(history());
    expect(html).toMatch(/data-kpi="signupsLifetime"[^>]*>0</);
    expect(html).toMatch(/data-kpi="signups30d"[^>]*>0</);
    expect(html).toContain('0% vs prev');
    expect(html).toContain('No signups found. Share your code to start earning.');
    expect(html).toContain(
      'No referrals match the current filters. Share your link and new signups will appear here.',
    );
    expect(html).toContain('No payouts found. Share your link to earn credits.');
    expect(html).not.toContain('data-footer');
  });

  it('the empty table offers Reset, and the filter bar has a Reset that clears the search only', () => {
    const html = content(history(), { text: 'zzz' });
    expect(html.match(/>Reset</g)).toHaveLength(2);
  });

  it("unauthenticated visitors are the app layout's job: the page is a client of /affiliate/* and nav has no gate", () => {
    for (const item of nav) expect(item).not.toHaveProperty('gates');
  });
});

describe('TW-CPN-035 KPI strip', () => {
  const stats = {
    signupsLifetime: 1234,
    creditsLifetimeMinor: 61700,
    signupsRange: 40,
    creditsRangeMinor: 10000,
    signups30d: 12,
    credits30dMinor: 3000,
    avgPerSignupMinor: 500,
    deltaPct: 25,
  };
  const html = () => content(history({ stats, total: 1, data: [row(1)] }));

  it('shows five cards: lifetime signups with the coloured delta, credits earned, 30d, average, code with reward', () => {
    const h = html();
    for (const label of [
      'Signups (lifetime)',
      'Credits earned',
      'Signups (30d)',
      'Avg per signup',
      'Your code',
    ])
      expect(h).toContain(label);
    expect(h).toMatch(/text-success[^>]*>\+25% vs prev</);
    expect(h).toMatch(/data-kpi="signupsLifetime"[^>]*>1,234</);
    expect(h).toMatch(/data-kpi="creditsLifetime"[^>]*>\$617\.00</);
    expect(h).toContain('+$30.00');
    expect(h).toMatch(/data-kpi="avgPerSignup"[^>]*>\$5\.00</);
    expect(h).toMatch(/data-kpi="code"[^>]*>ABCDE23456</);
    expect(h).toContain('+$2.50 per signup');
  });

  it('colours a fall in the danger colour and keeps its minus', () => {
    const h = content(history({ stats: { ...stats, deltaPct: -8 } }));
    expect(h).toMatch(/text-danger[^>]*>-8% vs prev</);
  });
});

describe('TW-CPN-035 side panel and top codes', () => {
  it('share card: code, reward, full URL and Copy link', () => {
    const h = content(history());
    expect(h).toContain('Your share link');
    expect(h).toContain('https://app.example.com/register?ref=ABCDE23456');
    expect(h).toContain('Copy link');
    expect(h).toContain('+$2.50 per signup. Share this link anywhere');
  });

  it('recent payouts: amount, relative time and balance after (up to 8)', () => {
    const payouts = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      amountMinor: 250,
      balanceAfterMinor: 1000 + i,
      description: 'Referral payout',
      createdAt: '2026-06-10T09:00:00Z',
    }));
    const h = content(history({ payouts }));
    expect(h.match(/data-payout/g)).toHaveLength(8);
    expect(h).toContain('3 hours ago · balance $10.00');
  });

  it('"How it works" adds the price-per-message line only when the workspace pays per message', () => {
    const without = content(history());
    expect(without).toContain('Share your link ?ref=ABCDE23456');
    expect(without).toContain('Friend signs up using it');
    expect(without).toContain('+$2.50 lands in your wallet');
    expect(without).not.toContain('per message');
    const withPpm = content(history(), { me: me({ payPerMessage: true, creditsPerMessage: 5 }) });
    expect(withPpm).toContain('Credits spend at $0.05 per message');
  });

  it('top codes: signup count, money, and a proportional bar never thinner than 2%', () => {
    const h = content(
      history({
        topCodes: [
          { code: 'AAAA', signups: 9, creditsMinor: 2250, pct: 100 },
          { code: 'BBBB', signups: 1, creditsMinor: 0, pct: 0 },
        ],
      }),
    );
    expect(h).toContain('9 signups');
    expect(h).toContain('1 signup<');
    expect(h).toContain('+$22.50');
    expect(h).toContain('width:100%');
    expect(h).toContain('width:2%');
  });
});

describe('TW-CPN-036 CSV export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the link is bound to the selected range only, never to the search or the bucket', () => {
    expect(exportHref('7d')).toBe('/api/v2/affiliate/export?range=7d');
    expect(exportHref('all')).toBe('/api/v2/affiliate/export?range=all');
    expect(exportHref('90d')).not.toMatch(/q=|bucket=/);
  });

  it('downloads the file under the server-provided name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('﻿id\n', {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="affiliate-history-20260610-120000.csv"',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await downloadAffiliateCsv('30d');
    expect(out.fileName).toBe('affiliate-history-20260610-120000.csv');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v2/affiliate/export?range=30d');
  });

  it('falls back to a dated name when the header is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 200 })));
    const out = await downloadAffiliateCsv('7d', new Date('2026-06-10T00:00:00Z'));
    expect(out.fileName).toBe('affiliate-history-20260610.csv');
  });

  it('turns a failed download into an ApiError carrying the problem code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ type: 'x', title: 'Forbidden', status: 403, code: 'FORBIDDEN' }),
          {
            status: 403,
            headers: { 'content-type': 'application/problem+json' },
          },
        ),
      ),
    );
    await expect(downloadAffiliateCsv('7d')).rejects.toBeInstanceOf(ApiError);
  });

  it('chooses the error sentence by status, never by the message', () => {
    expect(errorKind(new ApiError(403, 'X', 'anything'))).toBe('forbidden');
    expect(errorKind(new ApiError(500, 'X', 'forbidden'))).toBe('generic');
    expect(errorKind(new TypeError('x'))).toBe('network');
    const html = wrap(<ErrorState error={new ApiError(403, 'X', 'm', 'req-1')} />);
    expect(html).toContain('You do not have access to the affiliate program.');
    expect(html).toContain('req-1');
  });
});

describe('TW-CPN-037 account affiliate pane', () => {
  const summary = (over: Partial<ReferralSummaryResponse> = {}): ReferralSummaryResponse => ({
    me: me(),
    signupsLifetime: 0,
    signups30d: 0,
    earnedMinor: 0,
    recent: [],
    ...over,
  });
  const pane = (s: ReferralSummaryResponse) => wrap(<AffiliatePaneBody summary={s} />);

  it('60 referrals: lists the 50 newest while the total card shows the true lifetime count', () => {
    const recent = Array.from({ length: 50 }, (_, i) => row(i + 1));
    const html = pane(summary({ recent, signupsLifetime: 60, signups30d: 18 }));
    expect(html.match(/data-row=/g)).toHaveLength(50);
    expect(html).toMatch(/data-stat="signupsTotal"[^>]*>60</);
    expect(html).toMatch(/data-stat="signups30d"[^>]*>18</);
  });

  it('shows the code card, the link and the three stat cards with their labels', () => {
    const html = pane(summary({ earnedMinor: 1000, signupsLifetime: 3, signups30d: 1 }));
    expect(html).toContain('Your affiliate code');
    expect(html).toMatch(/data-code[^>]*>ABCDE23456</);
    expect(html).toContain('https://app.example.com/register?ref=ABCDE23456');
    expect(html).toContain('Copy link');
    for (const l of ['Sign-ups (30d)', 'Sign-ups (total)', 'Earned', 'via your link', 'lifetime'])
      expect(html).toContain(l);
  });

  it('an empty code shows NO-CODE and offers no copy button or link', () => {
    const html = pane(summary({ me: me({ code: '', link: '' }) }));
    expect(html).toMatch(/data-code[^>]*>NO-CODE</);
    expect(html).not.toContain('Copy link');
  });

  it('reward 250 in USD reads $2.50, in the platform currency, whatever the viewer', () => {
    const html = pane(summary());
    expect(html).toContain('Every new sign-up earns you');
    expect(html).toMatch(
      /font-semibold text-primary">\$2\.50<\/span>, deposited straight into your wallet\./,
    );
    const eur = pane(summary({ me: me({ currency: 'EUR' }) }));
    expect(eur).toContain('€2.50');
  });

  it('Earned is money, with "≈ N messages" = earned / price per message', () => {
    const html = pane(summary({ earnedMinor: 1000, me: me({ creditsPerMessage: 5 }) }));
    expect(html).toMatch(/data-stat="earned"[^>]*>\$10\.00</);
    expect(html).toContain('≈ 200 messages');
    expect(pane(summary({ earnedMinor: 5, me: me({ creditsPerMessage: 5 }) }))).toContain(
      '≈ 1 message<',
    );
  });

  it('rows: user, code used, joined date, a Paid / No payout pill (never a fixed "active"), and +amount', () => {
    const html = pane(
      summary({
        recent: [
          row(1, { refereeName: 'Aisha Khan' }),
          row(2, { status: 'paid', creditsAwardedMinor: 250, walletTxId: uuid(9) }),
        ],
      }),
    );
    expect(html).toContain('Aisha Khan');
    expect(html).toContain('Jun 9, 2026');
    expect(html).toContain('No payout');
    expect(html).toContain('>Paid<');
    expect(html).not.toContain('active');
    expect(html).toContain('+$2.50');
    expect(html).toContain('+$0.00');
  });

  it('empty state when nothing was referred', () => {
    expect(pane(summary())).toContain(
      'No referrals found. Share your link and new signups will appear here.',
    );
  });

  it('is declared as a hub pane (/account/affiliate), and links on to the full history page', () => {
    expect(nav.map((n) => n.href)).toEqual(['/account/affiliate']);
    expect(wrap(<AffiliatePaneShell>x</AffiliatePaneShell>)).toContain('href="/affiliate-history"');
    expect(nav[0]).toMatchObject({ group: 'settings' });
    expect(nav[0]!.order).toBeLessThan(100);
  });
});

describe('TW-CPN-038 no commission promise', () => {
  it('no copy promises a percentage or recurring commission, in any language', () => {
    for (const lang of ['en', 'ar']) {
      const text = readFileSync(
        join(WEB, 'messages', lang, 'coupons-credits-referral-currency.affiliate.json'),
        'utf8',
      );
      expect(text).not.toMatch(/commission|recurring|عمولة|متكرر|\d+\s?%/i);
    }
  });
});
