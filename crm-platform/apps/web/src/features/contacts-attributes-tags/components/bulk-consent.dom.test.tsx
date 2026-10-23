// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { BulkPickers, type ConsentChoice } from './bulk-bar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The group and tag pickers in the same bar read the workspace lists; this test is about the consent picker only.
vi.mock('../api/groups', () => ({
  useGroups: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('../api/tags', () => ({
  sameTagName: () => false,
  TAG_NAME_MAX: 64,
  useTags: () => ({ data: [], isPending: false }),
}));

let root: Root | null = null;
let host: HTMLElement;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          {ui}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
});

/** The open popover is rendered outside the host, so the whole document is searched. */
const doc = () => document.body;
const byLabel = (label: string) => doc().querySelector<HTMLElement>(`[aria-label="${label}"]`);
const button = (text: string) =>
  [...doc().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );

function setValue(el: HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const click = (el: Element | undefined) => {
  expect(el, 'control to click').toBeTruthy();
  act(() => {
    (el as HTMLElement).click();
  });
};

function openConsent(onConsent: (c: ConsentChoice) => Promise<boolean>, count: number | null = 3) {
  const onClose = vi.fn();
  mount(
    <BulkPickers
      picker="consent"
      canCreateTags={false}
      count={count}
      onClose={onClose}
      onGroup={vi.fn(async () => true)}
      onTag={vi.fn(async () => true)}
      onConsent={onConsent}
    />,
  );
  return { onClose };
}

describe('bulk marketing consent picker', () => {
  it('asks for the channel, the change and, for a subscription, how the contacts agreed', () => {
    openConsent(vi.fn(async () => true));
    const channel = byLabel('Channel') as HTMLSelectElement;
    expect([...channel.options].map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['WhatsApp', 'SMS', 'Email', 'Web chat', 'Voice call']),
    );
    expect(byLabel('How the contacts agreed')).toBeTruthy();
  });

  it('will not go on to the confirmation without the note of a subscription', () => {
    const onConsent = vi.fn(async () => true);
    openConsent(onConsent);
    click(button('Continue'));
    expect(doc().textContent).toContain('Say how the contacts agreed before subscribing them.');
    expect(button('Record consent')).toBeUndefined();
    expect(onConsent).not.toHaveBeenCalled();
  });

  it('confirms in words what will be written, then records one channel for the selection', async () => {
    const onConsent = vi.fn(async () => true);
    openConsent(onConsent, 3);
    setValue(byLabel('Channel') as HTMLSelectElement, 'sms');
    setValue(byLabel('How the contacts agreed') as HTMLTextAreaElement, 'Ticked the form');
    click(button('Continue'));
    expect(doc().textContent).toContain('Mark 3 contacts as subscribed on SMS.');
    await act(async () => {
      button('Record consent')!.click();
    });
    expect(onConsent).toHaveBeenCalledWith({
      channel: 'sms',
      action: 'granted',
      note: 'Ticked the form',
    });
  });

  it('needs no note to withdraw, and says so for all matching contacts', async () => {
    const onConsent = vi.fn(async () => true);
    openConsent(onConsent, null);
    setValue(byLabel('Change') as HTMLSelectElement, 'withdrawn');
    expect(byLabel('How the contacts agreed')).toBeNull();
    click(button('Continue'));
    expect(doc().textContent).toContain('unsubscribed');
    expect(doc().textContent).toContain('This applies to every contact the filter matches.');
    await act(async () => {
      button('Record consent')!.click();
    });
    expect(onConsent).toHaveBeenCalledWith({ channel: 'whatsapp', action: 'withdrawn' });
  });
});
