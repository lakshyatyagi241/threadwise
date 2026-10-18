// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUPLICATE_DEFAULTS, type DuplicateSettings } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

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
  leadHandlingApi: { saveDuplicates: (i: unknown) => state.save(i) },
}));

import { DuplicateSettingsScreen, sameDuplicates, valuesOf } from './duplicate-settings-screen';

const settings = (over: Partial<DuplicateSettings> = {}): DuplicateSettings => ({
  ...DUPLICATE_DEFAULTS,
  rowVersion: null,
  updatedAt: null,
  ...over,
});
const ok = (duplicates: DuplicateSettings) => ({
  isError: false,
  error: null,
  data: { duplicates },
  refetch: vi.fn(),
});

let host: HTMLElement | undefined;
let root: Root | undefined;
const messages = loadMessages('en') as unknown as Record<string, Record<string, unknown>>;
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
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <DuplicateSettingsScreen />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}
const sw = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
    (s) => s.getAttribute('aria-label') === name,
  )!;
const radio = (name: string) =>
  [...host!.querySelectorAll<HTMLLabelElement>('label')]
    .find((l) => l.textContent?.trim().startsWith(name) && l.querySelector('input[type="radio"]'))!
    .querySelector<HTMLInputElement>('input')!;
const btn = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('button')].find(
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
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('the duplicate leads form values', () => {
  it('drop the version and compare field by field', () => {
    expect(valuesOf(settings({ rowVersion: 4 }))).toEqual({ mode: 'merge', noteOnMerge: false });
    expect(sameDuplicates(DUPLICATE_DEFAULTS, { ...DUPLICATE_DEFAULTS })).toBe(true);
    expect(sameDuplicates(DUPLICATE_DEFAULTS, { mode: 'create_new', noteOnMerge: false })).toBe(
      false,
    );
  });
});

describe('Settings > Duplicate leads', () => {
  it("shows today's behaviour by default: merge, no timeline note, nothing to save", async () => {
    await mountScreen();
    expect(radio(label('settings.duplicates.mode.merge')).checked).toBe(true);
    expect(radio(label('settings.duplicates.mode.createNew')).checked).toBe(false);
    expect(sw(label('settings.duplicates.note.merge')).getAttribute('aria-checked')).toBe('false');
    expect(btn(label('settings.save')).disabled).toBe(true);
  });

  it('saves the whole section with the chosen mode and the note', async () => {
    await mountScreen();
    await click(radio(label('settings.duplicates.mode.createNew')));
    await click(sw(label('settings.duplicates.note.merge')));
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledWith({ mode: 'create_new', noteOnMerge: true });
    expect(host!.textContent).toContain(label('settings.saved'));
  });

  it('a later save carries the version it read', async () => {
    state.query = ok(settings({ rowVersion: 7, mode: 'create_new' }));
    await mountScreen();
    expect(radio(label('settings.duplicates.mode.createNew')).checked).toBe(true);
    await click(radio(label('settings.duplicates.mode.merge')));
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledWith({ mode: 'merge', noteOnMerge: false, rowVersion: 7 });
  });

  it('a person who cannot manage the settings sees the notice, not the form', async () => {
    state.perms = new Set();
    await mountScreen();
    expect(host!.textContent).toContain(label('settings.errors.forbidden'));
    expect(host!.querySelector('input[type="radio"]')).toBeNull();
  });
});
