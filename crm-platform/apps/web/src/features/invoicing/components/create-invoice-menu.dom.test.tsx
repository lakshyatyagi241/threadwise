// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { loadMessages } from '@/i18n/messages';
import { CreateInvoiceMenu } from './create-invoice-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  push.mockReset();
});

async function open(props: {
  features: string[] | null;
  canCreate?: boolean;
  canCreateRecurring?: boolean;
}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <PlanFeaturesProvider features={props.features}>
          <CreateInvoiceMenu
            canCreate={props.canCreate ?? true}
            canCreateRecurring={props.canCreateRecurring ?? true}
          />
        </PlanFeaturesProvider>
      </NextIntlClientProvider>,
    );
  });
  const trigger = document.querySelector('button') as HTMLButtonElement | null;
  if (trigger) await act(async () => trigger.click());
}

const items = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];

describe('Create on the Invoices page', () => {
  it('asks one-time or recurring, and both open their own form on a plan that has them', async () => {
    await open({ features: ['invoicing', 'recurring_invoices'] });
    const labels = items().map((i) => i.textContent?.trim());
    expect(labels).toEqual(
      expect.arrayContaining(['Create one-time invoice', 'Create recurring invoices']),
    );
    await act(async () =>
      items()
        .find((i) => i.textContent?.includes('recurring'))!
        .click(),
    );
    expect(push).toHaveBeenCalledWith('/recurring-invoices/new');
  });

  it('on a plan without recurring invoices the item is off, says why and points to the plans', async () => {
    await open({ features: ['invoicing'] });
    const recurring = items().find((i) => i.textContent?.includes('recurring'))!;
    expect(recurring.getAttribute('aria-disabled')).toBe('true');
    expect(recurring.textContent).toContain('Not in your plan');
    await act(async () => recurring.click());
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('a[href="/account/plans"]')).not.toBeNull();
    await act(async () =>
      items()
        .find((i) => i.textContent?.includes('one-time'))!
        .click(),
    );
    expect(push).toHaveBeenCalledWith('/invoices/new');
  });

  it('shows no recurring item to a person who may not create one, and nothing to a person who may create neither', async () => {
    await open({ features: ['invoicing'], canCreateRecurring: false });
    expect(items().map((i) => i.textContent?.trim())).toEqual(['Create one-time invoice']);
    act(() => root?.unmount());
    document.body.innerHTML = '';
    await open({ features: null, canCreate: false, canCreateRecurring: false });
    expect(document.querySelector('button')).toBeNull();
  });
});
