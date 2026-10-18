// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNCONTACTED_DEFAULTS, type UncontactedSettings } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  query: {} as Record<string, unknown>,
  save: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../../api/lead-handling', () => ({
  LEAD_HANDLING_KEYS: { settings: ['lead-handling', 'settings'] },
  useLeadHandlingSettings: () => state.query,
  leadHandlingApi: { saveUncontacted: (i: unknown) => state.save(i) },
}));

import { UncontactedSettingsScreen } from './uncontacted-settings-screen';

const settings = (over: Partial<UncontactedSettings> = {}): UncontactedSettings => ({
  ...UNCONTACTED_DEFAULTS,
  rowVersion: null,
  updatedAt: null,
  ...over,
});
const ok = (uncontacted: UncontactedSettings) => ({
  isError: false,
  error: null,
  data: { uncontacted },
  refetch: vi.fn(),
});

let host: HTMLElement;
let root: Root;
const messages = loadMessages('en') as unknown as Record<string, Record<string, unknown>>;
/** The English text of a key under `contacts-attributes-tags.leadHandling`. */
const label = (path: string): string => {
  let cur: unknown = messages['contacts-attributes-tags']!.leadHandling;
  for (const p of path.split('.')) cur = (cur as Record<string, unknown>)[p];
  return cur as string;
};

async function mountScreen() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <UncontactedSettingsScreen />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
const sw = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
    (s) => s.getAttribute('aria-label') === name,
  )!;
const btn = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

beforeEach(() => {
  state.perms = new Set(['admin.settings.manage']);
  state.query = ok(settings());
  state.save.mockReset().mockResolvedValue(settings({ rowVersion: 1 }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Settings > Uncontacted leads', () => {
  it('shows the defaults: the four "contacted" options on, the creation options off, reassign keeps the marker', async () => {
    await mountScreen();
    expect(host.textContent).toContain(label('settings.uncontacted.title'));
    for (const k of ['contactButton', 'message', 'automation', 'activity']) {
      expect(sw(label(`settings.uncontacted.clear.${k}`)).getAttribute('aria-checked'), k).toBe(
        'true',
      );
    }
    for (const k of ['manual', 'import', 'leadSource']) {
      expect(sw(label(`settings.uncontacted.new.${k}`)).getAttribute('aria-checked'), k).toBe(
        'false',
      );
    }
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
  });

  it('Save is off until something changes; saving sends the whole section, without a version on the first save', async () => {
    await mountScreen();
    expect(btn(label('settings.save')).disabled).toBe(true);
    await click(sw(label('settings.uncontacted.new.leadSource')));
    await click(host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]!);
    expect(btn(label('settings.save')).disabled).toBe(false);
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save).toHaveBeenCalledWith({
      ...UNCONTACTED_DEFAULTS,
      markNew: { ...UNCONTACTED_DEFAULTS.markNew, leadSource: true },
      onReassign: 'mark',
    });
    expect(host.textContent).toContain(label('settings.saved'));
  });

  it('a later save carries the version it read; Discard puts the saved values back', async () => {
    state.query = ok(settings({ rowVersion: 4, onReassign: 'mark' }));
    await mountScreen();
    const message = label('settings.uncontacted.clear.message');
    await click(sw(message));
    expect(sw(message).getAttribute('aria-checked')).toBe('false');
    await click(btn(label('settings.discard')));
    expect(sw(message).getAttribute('aria-checked')).toBe('true');
    await click(sw(message));
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ rowVersion: 4, onReassign: 'mark' }),
    );
  });

  it('a stale version shows the conflict notice instead of an error', async () => {
    state.save.mockRejectedValue(
      new ApiError(409, 'ROW_VERSION_CONFLICT', 'conflict'),
    );
    await mountScreen();
    await click(sw(label('settings.uncontacted.new.manual')));
    await click(btn(label('settings.save')));
    expect(host.textContent).toContain(label('settings.conflict'));
  });

  it('a person without permission to manage the settings sees the notice, not the form', async () => {
    state.perms = new Set();
    await mountScreen();
    expect(host.textContent).toContain(label('settings.errors.forbidden'));
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it('a failed load offers a retry', async () => {
    state.query = { isError: true, error: new Error('down'), data: undefined, refetch: vi.fn() };
    await mountScreen();
    expect(host.textContent).toContain(label('settings.errors.network'));
    expect(btn(label('settings.retry'))).toBeTruthy();
  });
});
