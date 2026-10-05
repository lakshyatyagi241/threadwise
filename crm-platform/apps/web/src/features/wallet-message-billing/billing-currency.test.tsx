import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformWalletDetail, PlatformWalletOverview } from '@crm/contracts';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { BillingCurrencyCard } from './components/admin/billing-currency-card';
import { OverviewCards } from './components/admin/overview-page';
import { errorKind } from './lib/errors';
import { ApiError } from '@/lib/api/errors';

const raw = JSON.parse(
  readFileSync(
    join(resolve(__dirname, '../../..'), 'messages', 'en', 'wallet-message-billing.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        <ToastProvider>{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const detail = (over: Partial<PlatformWalletDetail> = {}): PlatformWalletDetail => ({
  workspace: { id: '11111111-1111-4111-8111-111111111111', name: 'Acme', slug: 'acme' },
  currency: 'INR',
  billableCurrencies: ['INR', 'USD'],
  wallets: [
    { currency: 'INR', balanceMinor: 25_000 },
    { currency: 'USD', balanceMinor: 5000 },
  ],
  balanceMinor: 25_000,
  billingMode: 'wallet',
  lowBalanceThresholdMinor: 100,
  lowBalance: false,
  lastActivityAt: null,
  recent: [],
  ...over,
});

describe('the billing currency panel', () => {
  it('names the currency and lists a wallet the workspace no longer bills from, with its money', () => {
    const html = wrap(<BillingCurrencyCard d={detail()} canWrite />);
    expect(html).toContain('Billing currency');
    expect(html).toContain('Billed in');
    expect(html).toContain('INR');
    expect(html).toContain('Other wallets this workspace holds');
    expect(html).toContain('$50.00');
    expect(html).toContain('Not used for billing; the money stays here.');
  });

  it('offers the change to a super admin only, and only when there is another currency to pick', () => {
    expect(wrap(<BillingCurrencyCard d={detail()} canWrite />)).toContain('Change currency');
    expect(wrap(<BillingCurrencyCard d={detail()} canWrite={false} />)).not.toContain(
      'Change currency',
    );
    const single = detail({
      billableCurrencies: ['INR'],
      wallets: [{ currency: 'INR', balanceMinor: 0 }],
    });
    expect(wrap(<BillingCurrencyCard d={single} canWrite />)).not.toContain('Change currency');
  });

  it('shows no other-wallets list when the workspace holds one wallet', () => {
    const one = detail({ wallets: [{ currency: 'INR', balanceMinor: 25_000 }] });
    expect(wrap(<BillingCurrencyCard d={one} canWrite />)).not.toContain('Other wallets');
  });
});

describe('the overview', () => {
  const overview = (over: Partial<PlatformWalletOverview> = {}): PlatformWalletOverview => ({
    currency: 'USD',
    floatMinor: 5_000_000,
    workspacesWithBalance: 12,
    lowBalanceWorkspaces: 3,
    otherCurrencies: [],
    last30d: {
      toppedUpMinor: 0,
      chargedMinor: 0,
      refundedMinor: 0,
      adjustedInMinor: 0,
      adjustedOutMinor: 0,
      chargedMessages: 0,
      freeMessages: 0,
    },
    ...over,
  });

  it('keeps rupees on their own line and says the headline figures are dollars', () => {
    const html = wrap(
      <OverviewCards
        o={overview({
          otherCurrencies: [
            {
              currency: 'INR',
              floatMinor: 1_234_500,
              workspacesWithBalance: 4,
              toppedUp30dMinor: 500_000,
              charged30dMinor: 120_000,
            },
          ],
        })}
      />,
    );
    expect(html).toContain('Wallets in other currencies');
    expect(html).toContain('₹12,345.00');
    expect(html).toContain('The figures above are USD only');
  });

  it('shows no other-currency section when every wallet is in the platform currency', () => {
    expect(wrap(<OverviewCards o={overview()} />)).not.toContain('Wallets in other currencies');
  });
});

describe('errors', () => {
  it('maps an unusable currency to its own message by code', () => {
    const err = new ApiError(
      422,
      'WALLET_CURRENCY_UNSUPPORTED',
      'Meta’s rate card for EUR has not been imported',
    );
    expect(errorKind(err)).toBe('currencyUnsupported');
  });
});
