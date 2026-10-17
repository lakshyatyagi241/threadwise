import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en/plans-subscriptions-trials.json';
import ar from '../../../../messages/ar/plans-subscriptions-trials.json';

const nav = vi.hoisted(() => ({ path: '/ai-crm' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

import { PlanPaywall } from './plan-paywall';

const GATES = [
  { href: '/ai-crm', feature: 'ai_crm_copilot' },
  { href: '/analytics', feature: 'analytics' },
];

function render(
  path: string,
  enabled: string[] | null,
  canBrowseApps: boolean,
  locale: 'en' | 'ar' = 'en',
) {
  nav.path = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ar} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <PlanPaywall gates={GATES} enabled={enabled} canBrowseApps={canBrowseApps} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe('the paywall of a feature that is also sold as an app', () => {
  it('links to the app page for a person who may open the Marketplace', () => {
    const html = render('/ai-crm', ['marketplace'], true);
    expect(html).toContain('data-testid="plan-paywall"');
    expect(html).toContain('data-testid="paywall-app"');
    expect(html).toContain('href="/marketplace/app/ai-crm-copilot"');
    expect(html).toContain('is also sold as an app in the Marketplace');
  });

  it('says it in Arabic too', () => {
    const html = render('/ai-crm', ['marketplace'], true, 'ar');
    expect(html).toContain('href="/marketplace/app/ai-crm-copilot"');
    expect(html).toContain('سوق التطبيقات');
  });

  it('shows no link to a person or plan that cannot open the Marketplace', () => {
    const html = render('/ai-crm', ['marketplace'], false);
    expect(html).toContain('data-testid="plan-paywall"');
    expect(html).not.toContain('paywall-app');
    expect(html).not.toContain('/marketplace');
  });

  it('shows no app link for a feature no app owns', () => {
    const html = render('/analytics', ['marketplace'], true);
    expect(html).toContain('data-testid="plan-paywall"');
    expect(html).not.toContain('paywall-app');
  });

  it('shows nothing when the workspace has the feature, or while the plan is unknown', () => {
    expect(render('/ai-crm', ['ai_crm_copilot'], true)).toBe('');
    expect(render('/ai-crm', null, true)).toBe('');
  });
});
