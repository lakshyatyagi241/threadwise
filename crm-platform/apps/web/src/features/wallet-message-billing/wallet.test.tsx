import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  WALLET_LOG_EVENTS,
  type MessagePricing,
  type PlatformWalletDetail,
  type StatementResponse,
  type WalletLogRow,
  type WalletSummary,
  type WalletTransaction,
} from '@crm/contracts';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import { KEYS } from './api';
import { resultMessageKey } from './components/admin/adjust-dialog';
import { LogTable, toLogQuery } from './components/admin/logs-page';
import { OverviewCards, ReconcileResult } from './components/admin/overview-page';
import { RecentTable } from './components/admin/workspace-detail-page';
import { ImportPreview } from './components/admin/rate-tools';
import { ActivityTable } from './components/customer/activity-table';
import { PricingTiles } from './components/customer/message-pricing-panel';
import { StatementTable, SummaryCards } from './components/customer/statement-page';
import { WalletBody } from './components/customer/wallet-page';
import { ERROR_KINDS } from './lib/errors';
import { settings } from './settings';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const WEB = resolve(__dirname, '../../..');
const raw = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'wallet-message-billing.json'), 'utf8'),
) as Record<string, unknown>;

type Tree = { [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const en = flatten(raw as Tree);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe('messages', () => {
  it('every literal key a component asks for exists', () => {
    const missing: string[] = [];
    const dirs = [
      join(WEB, 'src', 'features', 'wallet-message-billing'),
      join(WEB, 'src', 'app', '(app)', '(wallet-message-billing)'),
      join(WEB, 'src', 'app', '(admin)', '(wallet-message-billing)'),
    ];
    for (const file of dirs.flatMap(sourceFiles)) {
      const src = readFileSync(file, 'utf8');
      const decls = [
        ...src.matchAll(
          /const\s+(\w+)\s*=\s*(?:await\s+getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g,
        ),
      ];
      // a file holds several components, each with its own `t`: a call belongs to the nearest declaration above it
      for (const name of new Set(decls.map((d) => d[1]))) {
        const own = decls.filter((d) => d[1] === name);
        for (const c of src.matchAll(new RegExp(`(?<![\\w.])${name}\\(\\s*'([^']+)'`, 'g'))) {
          const decl = own.filter((d) => d.index! < c.index!).pop();
          if (decl && !(`${decl[2]}.${c[1]}` in en)) missing.push(`${file}: ${decl[2]}.${c[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the messages the dynamic lookups reach', () => {
    const ns = 'wallet-message-billing';
    const want: string[] = [];
    for (const k of ERROR_KINDS) want.push(`errors.${k}`);
    for (const t of ['topup', 'earn', 'refund', 'spend', 'admin_adjust']) want.push(`types.${t}`);
    for (const c of ['marketing', 'utility', 'authentication', 'service'])
      want.push(`categories.${c}`);
    for (const t of ['all', 'topup', 'earn', 'spend', 'refund', 'admin_adjust'])
      want.push(`statement.typeFilter.${t}`);
    for (const c of ['campaign', 'broadcast', 'flow', 'scheduled', 'auto_reply', 'chat', 'api'])
      want.push(`statement.channels.${c}`);
    for (const e of ['waba', 'baileys', 'twilio']) want.push(`statement.engines.${e}`);
    for (const m of ['wallet', 'plan']) want.push(`modes.${m}`);
    for (const s of ['perCountryEnabled', 'payPerMessage'])
      for (const k of [
        'label',
        'on',
        'off',
        'save',
        'confirmTitle',
        'confirmOn',
        'confirmOff',
        'confirm',
        'savedOn',
        'savedOff',
      ])
        want.push(`admin.pricing.switches.${s}.${k}`);
    for (const k of ['price', 'metaCost', 'country', 'empty', 'duplicate'])
      want.push(`admin.pricing.grid.problems.${k}`);
    for (const k of ['invalid', 'flatZero', 'percent'])
      want.push(`admin.pricing.economics.problems.${k}`);
    for (const k of ['required', 'invalid', 'zero', 'tooLarge'])
      want.push(`admin.adjust.problems.amount.${k}`);
    for (const k of ['short', 'long']) want.push(`admin.adjust.problems.note.${k}`);
    for (const k of ['appliedAdd', 'appliedDeduct', 'partial', 'replayed'])
      want.push(`admin.detail.result.${k}`);
    for (const k of ['operator', 'customer', 'system'])
      want.push(`admin.detail.columns.${k}`, `admin.logs.actors.${k}`);
    for (const k of ['all', 'workspace', 'platform']) want.push(`admin.logs.scopes.${k}`);
    for (const k of ['info', 'warning', 'error']) want.push(`admin.logs.severities.${k}`);
    for (const k of ['notCsv', 'tooBig', 'unreadable'])
      want.push(`admin.pricing.tools.import.fileProblems.${k}`);
    for (const k of ['wide', 'long']) want.push(`admin.pricing.tools.import.shapes.${k}`);
    for (const k of ['crossBorder', 'how', 'order'])
      want.push(`admin.pricing.guides.${k}.title`, `admin.pricing.guides.${k}.body`);
    for (const k of ['pricing', 'margins', 'packages', 'workspaces', 'logs'])
      want.push(`admin.nav.${k}`);
    for (const m of ['fixed', 'margin'])
      want.push(`admin.pricing.mode.${m}.label`, `admin.pricing.mode.${m}.body`);
    for (const k of ['margin', 'duplicate']) want.push(`admin.margins.grid.problems.${k}`);
    for (const k of ['layers', 'specific', 'unknown'])
      want.push(`admin.margins.help.${k}.title`, `admin.margins.help.${k}.body`);
    for (const k of ['short', 'long']) want.push(`admin.detail.pricing.reason.problems.${k}`);
    for (const k of ['workspace', 'plan', 'platform'])
      want.push(`admin.detail.pricing.preview.result.layers.${k}`);
    for (const k of ['margin', 'fixed'])
      want.push(`admin.detail.pricing.preview.result.bases.${k}`);
    for (const k of ['active', 'inactive', 'featured']) want.push(`admin.packages.status.${k}`);
    for (const k of [
      'name',
      'slug',
      'description',
      'price',
      'currency',
      'walletCredit',
      'badge',
      'sortOrder',
    ])
      want.push(`admin.packages.form.problems.${k}`);
    expect(want.filter((k) => !en[`${ns}.${k}`])).toEqual([]);
  });
});

describe('navigation', () => {
  it('offers the wallet as a gated Settings tile for the customer', () => {
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      id: 'wallet-message-billing',
      section: 'business',
      href: '/billing/wallet',
      gates: { permission: 'wallet.balance.read' },
    });
    expect(en[settings[0]!.labelKey]).toBeTruthy();
    expect(en[settings[0]!.descriptionKey!]).toBeTruthy();
  });

  it('lists the pricing, margins, packages, workspaces and logs pages in the operator Billing group', () => {
    const mine = OPERATOR_NAV.filter((i) => i.id.startsWith('wallet-'));
    expect(mine.map((i) => [i.href, en[i.labelKey]])).toEqual([
      ['/admin/wallet/pricing', 'Message pricing'],
      ['/admin/wallet/margins', 'Margins'],
      ['/admin/wallet/packages', 'Credit packages'],
      ['/admin/wallet/workspaces', 'Workspace wallets'],
      ['/admin/wallet/logs', 'Wallet logs'],
    ]);
    const billing = OPERATOR_NAV.find((i) => i.id === 'bsp-income')?.groupKey;
    for (const i of mine) expect(i.groupKey).toBe(billing ?? i.groupKey);
  });
});

const wrap = (el: ReactElement, qc?: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={qc ?? new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const tx = (over: Partial<WalletTransaction> = {}): WalletTransaction => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'spend',
  direction: 'out',
  amountMinor: -50,
  balanceAfterMinor: 9950,
  source: 'message.sent',
  description: 'Campaign launch',
  note: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('activity table', () => {
  it('signs a charge as money out and a top-up as money in, from the direction', () => {
    const html = wrap(
      <ActivityTable
        label="Recent activity"
        currency="USD"
        rows={[
          tx(),
          tx({
            id: '22222222-2222-4222-8222-222222222222',
            type: 'topup',
            direction: 'in',
            amountMinor: 100000,
            description: 'Top-up',
          }),
        ]}
      />,
    );
    expect(html).toContain('-$0.50');
    expect(html).toContain('+$1,000.00');
    expect(html).toContain('Message charge');
    expect(html).toContain('Top-up');
    expect(html).toContain('text-danger');
    expect(html).toContain('text-success');
  });

  it('shows the operator reason of an adjustment', () => {
    const html = wrap(
      <ActivityTable
        label="x"
        currency="USD"
        rows={[
          tx({ type: 'admin_adjust', direction: 'in', description: null, note: 'Outage credit' }),
        ]}
      />,
    );
    expect(html).toContain('Reason: Outage credit');
    expect(html).toContain('Adjustment');
  });
});

const summary = (over: Partial<WalletSummary> = {}): WalletSummary => ({
  currency: 'USD',
  balanceMinor: 123450,
  billingMode: 'wallet',
  perCountryEnabled: false,
  flatPriceMinor: 50,
  approxMessages: 2469,
  spent30dMinor: 20000,
  earned30dMinor: 500,
  toppedUp30dMinor: 100000,
  refunded30dMinor: 0,
  lowBalanceThresholdMinor: 500,
  lowBalance: false,
  plan: { monthlyMessagesLimit: 0, usedThisMonth: 0, active: true, endsAt: null },
  topupUrl: '/billing/checkout/wallet',
  ...over,
});

describe('wallet home', () => {
  it('shows the KPI cards, the add-money box and quick amounts that lead to the checkout', () => {
    const html = wrap(<WalletBody summary={summary()} canStatement={false} />);
    expect(html).toContain('$1,234.50');
    expect(html).toContain('about 2,469 messages');
    expect(html).toContain('$200.00');
    expect(html).toContain('+$5.00');
    expect(html).toContain('Add money');
    for (const u of [500, 1000, 2000, 5000]) {
      expect(html).toContain(`href="/billing/checkout/wallet?amount=${u}"`);
    }
    expect(html).not.toContain('running low');
    expect(html).not.toContain('Recent activity');
  });

  it('warns when the balance is low', () => {
    const html = wrap(<WalletBody summary={summary({ lowBalance: true })} canStatement={false} />);
    expect(html).toContain('Your balance is running low');
    expect(html).toContain('$5.00');
  });

  it('explains billing in three variants', () => {
    const wallet = wrap(<WalletBody summary={summary()} canStatement={false} />);
    expect(wallet).toContain('Every delivered message is charged to your wallet');

    const limited = wrap(
      <WalletBody
        summary={summary({
          billingMode: 'plan',
          approxMessages: null,
          plan: {
            monthlyMessagesLimit: 5000,
            usedThisMonth: 1200,
            active: true,
            endsAt: '2026-12-01T00:00:00.000Z',
          },
        })}
        canStatement={false}
      />,
    );
    expect(limited).toContain('Your plan includes 5,000 messages every month.');
    expect(limited).toContain('1,200 used this month.');
    expect(limited).not.toContain('sending is paused');

    const ended = wrap(
      <WalletBody
        summary={summary({
          billingMode: 'plan',
          plan: { monthlyMessagesLimit: 5000, usedThisMonth: 5000, active: false, endsAt: null },
        })}
        canStatement={false}
      />,
    );
    expect(ended).toContain('sending is paused');

    const generic = wrap(
      <WalletBody summary={summary({ billingMode: 'plan' })} canStatement={false} />,
    );
    expect(generic).toContain('Your messages are covered by your plan.');
  });

  it('shows the recent activity card only to a member who may read the statement', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.ledger(undefined), {
      data: [tx()],
      page: { nextCursor: null, hasMore: false, limit: 10 },
    });
    const html = wrap(<WalletBody summary={summary()} canStatement />, qc);
    expect(html).toContain('Recent activity');
    expect(html).toContain('Campaign launch');
  });
});

describe('message pricing panel', () => {
  const pricing = (over: Partial<MessagePricing> = {}): MessagePricing => ({
    billingMode: 'wallet',
    perCountryEnabled: true,
    currency: 'USD',
    country: 'IN',
    categories: [
      { category: 'marketing', priceMinor: 120, free: false },
      { category: 'utility', priceMinor: 30, free: false },
      { category: 'authentication', priceMinor: 30, free: false },
      { category: 'service', priceMinor: 0, free: true },
    ],
    ...over,
  });
  it('lists the four categories with a free service row', () => {
    const html = wrap(<PricingTiles pricing={pricing()} compact={false} />);
    expect(html).toContain('$1.20');
    expect(html).toContain('$0.30');
    expect(html).toContain('Free');
    expect(html).toContain('Charged when a message is delivered');
    expect(wrap(<PricingTiles pricing={pricing()} compact />)).not.toContain('Charged when');
  });
});

describe('statement', () => {
  const statement: StatementResponse = {
    currency: 'USD',
    summary: {
      currentBalanceMinor: 9950,
      moneyInMinor: 100000,
      moneyOutMinor: 90050,
      netMinor: 9950,
      count: 2,
    },
    data: [
      {
        ...tx(),
        moneyInMinor: 0,
        moneyOutMinor: 50,
        context: {
          channel: 'campaign',
          campaignName: 'Diwali sale',
          recipient: '+919876543210',
          template: 'offer_v2',
          country: 'IN',
          category: 'marketing',
          engine: 'waba',
        },
      },
      {
        ...tx({
          id: '33333333-3333-4333-8333-333333333333',
          type: 'topup',
          direction: 'in',
          amountMinor: 100000,
          balanceAfterMinor: 10000,
        }),
        moneyInMinor: 100000,
        moneyOutMinor: 0,
        context: null,
      },
    ],
    page: { nextCursor: null, hasMore: false, limit: 25 },
  };

  it('shows the summary cards over the whole filtered set', () => {
    const html = wrap(<SummaryCards data={statement} />);
    expect(html).toContain('$99.50');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('$900.50');
    expect(html).toContain('2 transactions');
  });

  it('puts the money in the column of its direction and shows context chips', () => {
    const html = wrap(<StatementTable rows={statement.data} currency="USD" />);
    expect(html).toContain('Diwali sale');
    expect(html).toContain('To: +919876543210');
    expect(html).toContain('Template: offer_v2');
    for (const chip of ['Campaign', 'IN', 'Marketing', 'WhatsApp Cloud'])
      expect(html).toContain(`>${chip}<`);
    expect(html).toContain('$0.50');
    expect(html).toContain('$1,000.00');
  });
});

describe('platform console', () => {
  it('shows the float and the last 30 days', () => {
    const html = wrap(
      <OverviewCards
        o={{
          currency: 'USD',
          floatMinor: 5000000,
          workspacesWithBalance: 12,
          lowBalanceWorkspaces: 3,
          otherCurrencies: [],
          last30d: {
            toppedUpMinor: 200000,
            chargedMinor: 150000,
            refundedMinor: 1000,
            adjustedInMinor: 5000,
            adjustedOutMinor: 2000,
            chargedMessages: 7000,
            freeMessages: 300,
          },
        }}
      />,
    );
    expect(html).toContain('$50,000.00');
    expect(html).toContain('7,000');
    expect(html).toContain('$1,500.00');
  });

  it('reports a clean ledger check and lists each mismatch', () => {
    expect(
      wrap(
        <ReconcileResult
          r={{ checkedAt: '2026-10-02T00:00:00Z', workspacesChecked: 4, mismatches: [] }}
        />,
      ),
    ).toContain('All 4 wallets match their ledger.');
    const html = wrap(
      <ReconcileResult
        r={{
          checkedAt: '2026-10-02T00:00:00Z',
          workspacesChecked: 4,
          mismatches: [
            {
              workspaceId: '11111111-1111-4111-8111-111111111111',
              workspaceName: 'Acme',
              balanceMinor: 1000,
              ledgerMinor: 900,
              differenceMinor: 100,
            },
          ],
        }}
      />,
    );
    expect(html).toContain('1 of 4 wallets do not match their ledger.');
    expect(html).toContain('/admin/wallet/workspaces/11111111-1111-4111-8111-111111111111');
    expect(html).toContain('10.00');
  });

  it('says what an adjustment really did, including a deduction cut short at 0', () => {
    const base = {
      transactionId: null,
      requestedMinor: 5000,
      appliedMinor: 5000,
      balanceBeforeMinor: 5000,
      balanceAfterMinor: 0,
      replayed: false,
    };
    expect(resultMessageKey({ ...base, direction: 'credit' })).toBe('appliedAdd');
    expect(resultMessageKey({ ...base, direction: 'debit' })).toBe('appliedDeduct');
    const partial = resultMessageKey({ ...base, direction: 'debit', appliedMinor: 1000 });
    expect(partial).toBe('partial');
    const t = createTranslator({
      locale: 'en',
      messages: raw,
      namespace: 'wallet-message-billing.admin.detail.result',
    } as never) as unknown as (key: string, values: Record<string, string>) => string;
    expect(t('partial', { applied: '$10.00', requested: '$50.00', balance: '$0.00' })).toBe(
      'Only $10.00 of $50.00 was applied because the balance cannot go below 0. The balance is now $0.00.',
    );
  });

  it('shows who made each entry and why', () => {
    const detail: PlatformWalletDetail = {
      workspace: { id: '11111111-1111-4111-8111-111111111111', name: 'Acme', slug: 'acme' },
      currency: 'USD',
      billableCurrencies: ['INR', 'USD'],
      wallets: [{ currency: 'USD', balanceMinor: 7500 }],
      balanceMinor: 7500,
      billingMode: 'wallet',
      lowBalanceThresholdMinor: 500,
      lowBalance: false,
      lastActivityAt: null,
      recent: [
        {
          ...tx({
            type: 'admin_adjust',
            direction: 'in',
            amountMinor: 2500,
            note: 'Outage credit',
            description: null,
          }),
          actorLabel: 'Priya (ops)',
          actorType: 'platform_operator',
        },
        {
          ...tx({ id: '44444444-4444-4444-8444-444444444444' }),
          actorLabel: null,
          actorType: 'system',
        },
      ],
    };
    const html = wrap(<RecentTable d={detail} />);
    expect(html).toContain('Priya (ops)');
    expect(html).toContain('Reason: Outage credit');
    expect(html).toContain('+$25.00');
    expect(html).toContain('System');
  });

  it('previews an import before anything is saved', () => {
    const html = wrap(
      <ImportPreview
        preview={{
          dryRun: true,
          shape: 'wide',
          added: 3,
          updated: 2,
          skipped: 1,
          currency: 'USD',
          problems: [{ line: 7, reason: 'Unknown country' }],
        }}
      />,
    );
    expect(html).toContain('One column per category');
    expect(html).toContain('Line 7:');
    expect(html).toContain('Unknown country');
  });
});

describe('wallet logs', () => {
  it('offers exactly the events the domain writes', () => {
    expect(WALLET_LOG_EVENTS).toContain('wallet.admin.adjusted');
    expect(new Set(WALLET_LOG_EVENTS).size).toBe(WALLET_LOG_EVENTS.length);
  });

  it('sends only the filters that are set, and not a workspace id that is not a uuid', () => {
    const base = {
      scope: 'all',
      event: '',
      severity: '',
      workspaceId: '',
      q: '',
      from: '',
      to: '',
    } as const;
    expect(toLogQuery(base)).toEqual({
      scope: 'all',
      event: undefined,
      severity: undefined,
      workspaceId: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
    expect(toLogQuery({ ...base, workspaceId: 'nope' }).workspaceId).toBeUndefined();
    expect(
      toLogQuery({
        ...base,
        workspaceId: '11111111-1111-4111-8111-111111111111',
        severity: 'error',
        q: ' x ',
      }),
    ).toMatchObject({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      severity: 'error',
      q: 'x',
    });
  });

  it('expands an entry to its JSON payload', () => {
    const row: WalletLogRow = {
      id: 'log-1',
      scope: 'platform',
      event: 'platform.rates.synced',
      severity: 'warning',
      message: 'Rates synced',
      workspaceId: null,
      workspaceName: null,
      actorType: 'platform_operator',
      actorLabel: null,
      payload: { added: 3, source: 'bundled' },
      requestId: 'req-9',
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    const closed = wrap(<LogTable rows={[row]} />);
    expect(closed).toContain('Rates synced');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('&quot;bundled&quot;');
    const open = wrap(<LogTable rows={[row]} defaultOpen="log-1" />);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('&quot;source&quot;: &quot;bundled&quot;');
    expect(open).toContain('req-9');
  });
});
