// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddonImpact, AddonImpactItem } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { KEYS } from '../api';
import { AddonToggleDialog } from './addon-toggle-dialog';

const ID = '00000000-0000-4000-8000-000000000001';
const CARD = { id: ID, name: 'Smart routing' };

const item = (code: AddonImpactItem['code'], over: Partial<AddonImpactItem> = {}) =>
  ({ code, count: 0, names: [], risk: false, ...over }) as AddonImpactItem;

const impact = (items: AddonImpactItem[], requiresConfirm = false): AddonImpact => ({
  addon: { id: ID, name: CARD.name, slug: 'smart_routing' },
  action: 'disable',
  items,
  requiresConfirm,
});

const EVERYTHING = [
  item('features_off', { names: ['Smart routing', 'Sticky agent'] }),
  item('dependents_off', { names: ['Team methods'], count: 1, risk: true }),
  item('waiting_chats', { count: 14, risk: true }),
  item('routing_rules', { count: 3 }),
  item('auto_teams', { count: 2 }),
  item('roles_dormant', { count: 2 }),
  item('teams', { count: 4 }),
  item('custom_role_holders', { count: 5 }),
  item('kept'),
];

let host: HTMLElement | undefined;
let root: Root | undefined;
let calls: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
let responder: (url: string, method: string) => { status: number; json: unknown };

const json = (status: number, body: unknown) => ({ status, json: body });

beforeEach(() => {
  // jsdom has no modal dialogs: the dialog only needs these two to exist.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  router.refresh.mockClear();
  calls = [];
  responder = () => json(200, {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: new Headers(init.headers),
      });
      const r = responder(url, method);
      return new Response(JSON.stringify(r.json), {
        status: r.status,
        headers: {
          'content-type': r.status >= 400 ? 'application/problem+json' : 'application/json',
        },
      });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
  vi.unstubAllGlobals();
});

async function mount(opts: {
  data?: AddonImpact;
  locale?: 'en' | 'ar';
  onClose?: () => void;
  onDone?: (m: string) => void;
}) {
  const locale = opts.locale ?? 'en';
  const missing: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (opts.data) client.setQueryData([...KEYS.impact(ID, 'disable')], opts.data);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider
        locale={locale}
        messages={loadMessages(locale)}
        timeZone="UTC"
        onError={(e) => missing.push(e.message)}
      >
        <QueryClientProvider client={client}>
          <AddonToggleDialog
            card={CARD}
            open
            onClose={opts.onClose ?? (() => undefined)}
            onDone={opts.onDone ?? (() => undefined)}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return { missing, invalidate };
}

const confirmButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="addon-toggle-confirm"]')!;
const typedInput = () =>
  document.querySelector<HTMLInputElement>('[data-testid="addon-toggle-typed"] input')!;

/** Lets the pending fetch and query updates finish: a real response takes a few ticks to reach the screen. */
async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe.each(['en', 'ar'] as const)('AddonToggleDialog (%s)', (locale) => {
  it('is a labelled modal with a title naming the add-on, and lists every impact code as a sentence in its group', async () => {
    const { missing } = await mount({ locale, data: impact(EVERYTHING) });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toContain(
      'Smart routing',
    );
    for (const code of [
      'features_off',
      'dependents_off',
      'waiting_chats',
      'routing_rules',
      'auto_teams',
      'roles_dormant',
      'teams',
      'custom_role_holders',
      'kept',
    ]) {
      const li = document.querySelector(`[data-testid="addon-toggle-item-${code}"]`);
      expect(li, code).not.toBeNull();
      // a real sentence, never the raw key
      expect(li!.textContent, code).not.toContain('items.');
      expect(li!.textContent!.length, code).toBeGreaterThan(10);
    }
    const group = (id: string) => document.querySelector(`[data-testid="addon-toggle-${id}"]`)!;
    for (const code of [
      'features_off',
      'dependents_off',
      'waiting_chats',
      'routing_rules',
      'auto_teams',
    ])
      expect(
        group('stops').querySelector(`[data-testid="addon-toggle-item-${code}"]`),
        code,
      ).not.toBeNull();
    for (const code of ['kept', 'roles_dormant', 'teams'])
      expect(
        group('kept').querySelector(`[data-testid="addon-toggle-item-${code}"]`),
        code,
      ).not.toBeNull();
    expect(
      group('people').querySelector('[data-testid="addon-toggle-item-custom_role_holders"]'),
    ).not.toBeNull();
    // counts and names are interpolated
    expect(
      document.querySelector('[data-testid="addon-toggle-item-waiting_chats"]')!.textContent,
    ).toMatch(/14|١٤/);
    expect(
      document.querySelector('[data-testid="addon-toggle-item-features_off"]')!.textContent,
    ).toContain('Sticky agent');
    expect(missing).toEqual([]);
  });

  it('plural forms follow the count', async () => {
    await mount({ locale, data: impact([item('routing_rules', { count: 1 })]) });
    const one = document.querySelector(
      '[data-testid="addon-toggle-item-routing_rules"]',
    )!.textContent;
    act(() => root!.unmount());
    host!.remove();
    await mount({ locale, data: impact([item('routing_rules', { count: 3 })]) });
    const many = document.querySelector(
      '[data-testid="addon-toggle-item-routing_rules"]',
    )!.textContent;
    expect(one).not.toBe(many);
  });
});

describe('AddonToggleDialog behaviour', () => {
  it('without a risk, one click turns it off: POST { confirm: true } with an Idempotency-Key, then refresh and tell the person', async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    responder = (_u, m) =>
      m === 'POST'
        ? json(200, { addonId: ID, activation: 'disabled', changedAt: '2026-10-23T10:00:00.000Z' })
        : json(200, {});
    const { invalidate } = await mount({
      data: impact([item('features_off', { names: ['Smart routing'] }), item('kept')]),
      onClose,
      onDone,
    });
    expect(typedInput()).toBeNull();
    expect(confirmButton().disabled).toBe(false);
    expect(confirmButton().textContent).toContain('Turn off Smart routing');

    await act(async () => confirmButton().click());
    await until(() => onClose.mock.calls.length > 0);

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/v2/addons/${ID}/disable`);
    expect(post.body).toEqual({ confirm: true });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEYS.workspace });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('Smart routing is turned off. Its settings are kept.');
    expect(onClose).toHaveBeenCalled();
  });

  it('with a risk, the button stays off until the add-on name is typed (any case)', async () => {
    responder = (_u, m) =>
      m === 'POST'
        ? json(200, { addonId: ID, activation: 'disabled', changedAt: '2026-10-23T10:00:00.000Z' })
        : json(200, {});
    await mount({ data: impact(EVERYTHING, true) });
    expect(typedInput()).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);
    // a click while off does nothing
    await act(async () => confirmButton().click());
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await type(typedInput(), 'Smart');
    expect(confirmButton().disabled).toBe(true);
    await type(typedInput(), 'smart ROUTING');
    expect(confirmButton().disabled).toBe(false);

    await act(async () => confirmButton().click());
    await until(() => router.refresh.mock.calls.length > 0);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows the loading state, then an error with a retry that reads the impact again', async () => {
    let n = 0;
    responder = () => {
      n += 1;
      return n === 1
        ? json(500, { type: 'about:blank', title: 'Boom', status: 500, code: 'INTERNAL_ERROR' })
        : json(200, impact([item('kept')]));
    };
    await mount({});
    await until(() => document.querySelector('[role="alert"]') !== null);
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);
    const retry = [...alert.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    await until(() => document.querySelector('[data-testid="addon-toggle-item-kept"]') !== null);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
    expect(document.querySelector('[data-testid="addon-toggle-item-kept"]')).not.toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  it('a refusal stays in the dialog: 422 not toggleable has its own sentence, nothing is refreshed', async () => {
    const onClose = vi.fn();
    responder = (_u, m) =>
      m === 'POST'
        ? json(422, {
            type: 'about:blank',
            title: 'Unprocessable',
            status: 422,
            code: 'PAYGW_ADDON_NOT_TOGGLEABLE',
          })
        : json(200, impact([item('kept')]));
    await mount({ data: impact([item('kept')]), onClose });
    await act(async () => confirmButton().click());
    await until(() => document.querySelector('[data-testid="addon-toggle-error"]') !== null);
    const err = document.querySelector('[data-testid="addon-toggle-error"]')!;
    expect(err.textContent).toContain("Smart routing can't be turned on or off here");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(false);
  });

  it('any other failure gets the generic sentence and the button can be pressed again', async () => {
    responder = (_u, m) =>
      m === 'POST'
        ? json(500, { type: 'about:blank', title: 'Boom', status: 500, code: 'INTERNAL_ERROR' })
        : json(200, impact([item('kept')]));
    await mount({ data: impact([item('kept')]) });
    await act(async () => confirmButton().click());
    await until(() => document.querySelector('[data-testid="addon-toggle-error"]') !== null);
    expect(document.querySelector('[data-testid="addon-toggle-error"]')!.textContent).toContain(
      "We couldn't change Smart routing",
    );
    expect(confirmButton().disabled).toBe(false);
  });
});
