// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { SessionResponse } from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { CallNudge, rememberPhoneClick, settlePendingCall } from './call-nudge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const session = (perms: string[]) =>
  ({
    user: { id: 'u', email: 'a@x.test', fullName: 'Asha Rao', displayName: null },
    org: { timezone: 'UTC' },
    permissions: Object.fromEntries(perms.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

let host: HTMLElement;
let root: Root;

function mount(ui: ReactNode, perms = ['call.logs.create']) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <SessionProvider session={session(perms)}>
            <ToastProvider dismissLabel="Dismiss">{ui}</ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const prompt = () => host.querySelector('[role="status"]');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T10:00:00.000Z'));
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('"How did the call go?"', () => {
  it('stays away until a phone number was clicked, then asks half a minute later without covering anything', () => {
    const onLog = vi.fn();
    mount(<CallNudge contactId={ID} name="Priya" onLog={onLog} />);
    expect(prompt()).toBeNull();

    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
    });
    expect(prompt()).toBeNull();
    act(() => void vi.advanceTimersByTime(31_000));
    expect(prompt()?.textContent).toContain('How did the call with Priya go?');
    // a line in the page: no dialog, no overlay
    expect(host.querySelector('dialog, [role="dialog"], [aria-modal]')).toBeNull();

    const clickedAt = Date.parse('2026-10-17T10:00:00.000Z');
    act(() => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(onLog).toHaveBeenCalledWith(clickedAt);
  });

  it('asks at once when the person comes back to the tab after a real absence', () => {
    mount(<CallNudge contactId={ID} name="Priya" onLog={() => undefined} />);
    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
    });
    act(() => {
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(20_000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(prompt()).not.toBeNull();
  });

  it('is dismissed for good, per click, and a new click asks again', () => {
    mount(<CallNudge contactId={ID} name="Priya" onLog={() => undefined} />);
    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
      vi.advanceTimersByTime(31_000);
    });
    expect(prompt()).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Not now"]')!.click());
    expect(prompt()).toBeNull();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(prompt()).toBeNull();
    expect(window.localStorage.getItem('crm.call.dismissed')).toContain(ID);

    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
      vi.advanceTimersByTime(31_000);
    });
    expect(prompt()).not.toBeNull();
  });

  it('goes away when the call is logged somewhere else', () => {
    mount(<CallNudge contactId={ID} name="Priya" onLog={() => undefined} />);
    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
      vi.advanceTimersByTime(31_000);
    });
    expect(prompt()).not.toBeNull();
    act(() => settlePendingCall(ID));
    expect(prompt()).toBeNull();
  });

  it('is never shown to someone who cannot log calls', () => {
    mount(<CallNudge contactId={ID} name="Priya" onLog={() => undefined} />, []);
    act(() => {
      rememberPhoneClick(ID);
      window.dispatchEvent(new Event('crm:call-prompt'));
      vi.advanceTimersByTime(60_000);
    });
    expect(prompt()).toBeNull();
  });

  it('forgets a click that is older than half an hour', () => {
    mount(<CallNudge contactId={ID} name="Priya" onLog={() => undefined} />);
    act(() => {
      rememberPhoneClick(ID);
      vi.setSystemTime(new Date('2026-10-17T10:45:00.000Z'));
      window.dispatchEvent(new Event('crm:call-prompt'));
      vi.advanceTimersByTime(31_000);
    });
    expect(prompt()).toBeNull();
  });
});
