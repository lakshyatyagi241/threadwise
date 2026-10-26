// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingSubscription } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';
import { BILLING_KEYS } from '../api';
import { CancelRenewal } from './cancel-renewal';
import { PlansPicker } from './plans-picker';
import { UsageSection } from './usage-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  fetchBillingPlans: vi.fn(),
  fetchBillingUsage: vi.fn(),
  fetchBillingFaqs: vi.fn(),
  cancelAutoRenew: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  ...apiMocks,
}));

const messages = loadMessages('en');
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  // jsdom has no <dialog> methods; the Modal calls them from an effect.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  // reads nobody seeded stay pending, like a slow network
  for (const m of Object.values(apiMocks))
    m.mockReset().mockReturnValue(new Promise(() => undefined));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

type Seed = { key: readonly unknown[]; error: Error };

/** Mounts a screen with the real English messages; each seed is a read that already failed. */
function mount(el: ReactElement, failed: Seed[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  for (const s of failed) {
    client
      .getQueryCache()
      .build(client, { queryKey: [...s.key] })
      .setState({ status: 'error', error: s.error, fetchStatus: 'idle', errorUpdateCount: 1 });
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          {el}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  );
}

const text = () => host.textContent ?? '';
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const click = (el: Element | undefined) => act(() => (el as HTMLElement).click());
const flush = () => act(async () => void (await Promise.resolve()));

describe('plans pane states', () => {
  it('shows an error state with a retry when the plans fail to load', async () => {
    mount(<PlansPicker />, [
      { key: BILLING_KEYS.plans, error: new ApiError(500, 'INTERNAL', 'The plans broke') },
    ]);
    expect(text()).toContain('The plans broke');
    expect(host.querySelector('[data-testid="plan-cards"]')).toBeNull();
    expect(host.querySelector('[data-testid="plans-section"]')).not.toBeNull();
    const retry = button('Try again');
    expect(retry).toBeDefined();
    click(retry);
    await flush();
    expect(apiMocks.fetchBillingPlans).toHaveBeenCalled();
  });

  it('falls back to the generic message when the plans fail to load without an API error', () => {
    mount(<PlansPicker />, [{ key: BILLING_KEYS.plans, error: new TypeError('offline') }]);
    expect(text()).toContain("We couldn't change the plan. Please try again.");
    expect(button('Try again')).toBeDefined();
  });

  it('shows an error state with a retry when the usage fails to load, keeping its heading', async () => {
    mount(<UsageSection />, [
      { key: BILLING_KEYS.usage, error: new ApiError(502, 'UPSTREAM', 'Usage is down') },
    ]);
    expect(text()).toContain('Usage is down');
    expect(host.querySelector('[data-testid="usage-plan"]')).toBeNull();
    const retry = button('Try again');
    expect(retry).toBeDefined();
    click(retry);
    await flush();
    expect(apiMocks.fetchBillingUsage).toHaveBeenCalled();
  });
});

describe('cancel auto-renew', () => {
  const subscription = { renewsAt: '2026-12-01T00:00:00.000Z' } as unknown as BillingSubscription;
  const open = () => {
    mount(<CancelRenewal subscription={subscription} canManage />);
    click(button('Cancel auto-renew'));
  };
  const confirm = async () => {
    // the dialog's own confirm button repeats the label; it is the last one in the document
    const all = [...host.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Cancel auto-renew',
    );
    click(all[all.length - 1]);
    await flush();
    await flush();
  };

  it('keeps the dialog open and shows the error when the save fails, and the button works again', async () => {
    apiMocks.cancelAutoRenew.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
    open();
    await confirm();
    expect(apiMocks.cancelAutoRenew).toHaveBeenCalledTimes(1);
    expect(text()).toContain("We couldn't cancel auto-renew. Please try again.");
    expect(text()).not.toContain('Auto-renew cancelled');
    expect(text()).not.toContain('boom');
    for (const b of host.querySelectorAll('button'))
      expect((b as HTMLButtonElement).disabled).toBe(false);
    // a second attempt goes out
    await confirm();
    expect(apiMocks.cancelAutoRenew).toHaveBeenCalledTimes(2);
  });

  it('says the person may not change the plan when the save fails with a 403', async () => {
    apiMocks.cancelAutoRenew.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    open();
    await confirm();
    expect(text()).toContain("You don't have permission to change the plan.");
  });

  it('says there is nothing to cancel when the save fails because the subscription is gone', async () => {
    apiMocks.cancelAutoRenew.mockRejectedValue(new ApiError(404, 'PLAN_NO_SUBSCRIPTION', 'gone'));
    open();
    await confirm();
    expect(text()).toContain('There is no active subscription to cancel.');
  });
});
