// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessHours } from '@crm/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  hours: null as BusinessHours | null,
  saved: [] as unknown[],
}));

vi.mock('../api/routing', async () => {
  const actual = await vi.importActual<typeof import('../api/routing')>('../api/routing');
  return {
    ...actual,
    useBusinessHours: () => ({
      isPending: false,
      isError: false,
      data: state.hours,
    }),
    routingApi: {
      ...actual.routingApi,
      updateBusinessHours: async (input: unknown) => {
        state.saved.push(input);
        return state.hours;
      },
    },
  };
});

import { BusinessHoursDialog } from './business-hours-dialog';

const WEEK = {
  mon: { enabled: true, from: '09:00', to: '18:00' },
  tue: { enabled: true, from: '09:00', to: '18:00' },
  wed: { enabled: true, from: '09:00', to: '18:00' },
  thu: { enabled: true, from: '09:00', to: '18:00' },
  fri: { enabled: true, from: '09:00', to: '18:00' },
  sat: { enabled: false, from: '09:00', to: '18:00' },
  sun: { enabled: false, from: '09:00', to: '18:00' },
};

// The time zone picker reads its own namespace, so the auth catalogues are merged in.
const messages = (locale: string) => {
  const read = (file: string) =>
    JSON.parse(
      readFileSync(join(__dirname, `../../../../messages/${locale}/${file}`), 'utf8'),
    ) as Record<string, Record<string, unknown>>;
  const auth = [
    read('auth-registration-security.json'),
    read('auth-registration-security.account.json'),
  ];
  return {
    ...read('team-inbox-routing-sla.json'),
    'auth-registration-security': Object.assign(
      {},
      ...auth.map((f) => f['auth-registration-security']),
    ),
  };
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
  state.hours = { timezone: 'Asia/Kolkata', canEditTimezone: true, days: WEEK };
  state.saved = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async ({ canManage = true }: { canManage?: boolean } = {}) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={messages('en')} timeZone="UTC">
          <ToastProvider>
            <BusinessHoursDialog open canManage={canManage} onClose={() => undefined} />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
};

const setTime = (id: string, value: string) =>
  act(() => {
    const el = host.querySelector(`#${id}`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const submit = () =>
  act(() => {
    host
      .querySelector('form#business-hours-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('the business hours dialog', () => {
  it('shows the seven days with the saved windows', async () => {
    await render();
    for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(host.querySelector(`#bh-${k}-enabled`)).not.toBeNull();
    }
    expect((host.querySelector('#bh-mon-from') as HTMLInputElement).value).toBe('09:00');
    expect((host.querySelector('#bh-sat-enabled') as HTMLInputElement).checked).toBe(false);
  });

  it('refuses a closing time before the opening time and does not call the server', async () => {
    await render();
    setTime('bh-thu-to', '08:00');
    submit();
    expect(host.textContent).toContain('The closing time must be after the opening time.');
    expect(state.saved).toEqual([]);
  });

  it('saves all seven days with the time zone for the owner', async () => {
    await render();
    setTime('bh-mon-from', '08:30');
    submit();
    await act(async () => undefined);
    expect(state.saved).toHaveLength(1);
    const body = state.saved[0] as { timezone?: string; days: Record<string, { from: string }> };
    expect(body.timezone).toBe('Asia/Kolkata');
    expect(body.days.mon!.from).toBe('08:30');
    expect(Object.keys(body.days)).toHaveLength(7);
  });

  it('leaves the time zone out of the save for a person who may not change it', async () => {
    state.hours = { ...state.hours!, canEditTimezone: false };
    await render();
    submit();
    await act(async () => undefined);
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).not.toHaveProperty('timezone');
  });

  it('offers no save to someone who can only read the hours', async () => {
    await render({ canManage: false });
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector('#bh-mon-from')!.matches(':disabled')).toBe(true);
  });
});
