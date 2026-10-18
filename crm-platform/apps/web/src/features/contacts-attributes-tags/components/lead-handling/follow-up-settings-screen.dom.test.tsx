// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLLOW_UP_DEFAULTS, type FollowUpSettings } from '@crm/contracts';
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
  leadHandlingApi: { saveFollowUps: (i: unknown) => state.save(i) },
}));

import { choiceOf, dateOf, FollowUpSettingsScreen } from './follow-up-settings-screen';

const settings = (over: Partial<FollowUpSettings> = {}): FollowUpSettings => ({
  ...FOLLOW_UP_DEFAULTS,
  rowVersion: null,
  updatedAt: null,
  ...over,
});
const ok = (followUps: FollowUpSettings) => ({
  isError: false,
  error: null,
  data: { followUps },
  refetch: vi.fn(),
});

let host: HTMLElement;
let root: Root;
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
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <FollowUpSettingsScreen />
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
const radio = (name: string) =>
  [...host.querySelectorAll<HTMLLabelElement>('label')]
    .find((l) => l.textContent?.trim().startsWith(name) && l.querySelector('input[type="radio"]'))!
    .querySelector<HTMLInputElement>('input')!;
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
  if (root) act(() => root.unmount());
  host?.remove();
});

describe('the default date choices', () => {
  it('map the presets and a custom number of days both ways', () => {
    expect(choiceOf({ kind: 'days', days: 1 })).toBe('day');
    expect(choiceOf({ kind: 'days', days: 3 })).toBe('three_days');
    expect(choiceOf({ kind: 'days', days: 7 })).toBe('week');
    expect(choiceOf({ kind: 'days', days: 12 })).toBe('custom');
    expect(choiceOf({ kind: 'month' })).toBe('month');
    expect(choiceOf({ kind: 'someday' })).toBe('someday');
    expect(choiceOf({ kind: 'none' })).toBe('none');
    expect(dateOf('week', 0)).toEqual({ kind: 'days', days: 7 });
    expect(dateOf('custom', 12)).toEqual({ kind: 'days', days: 12 });
    expect(dateOf('custom', 0)).toEqual({ kind: 'days', days: 1 });
    expect(dateOf('custom', 9999)).toEqual({ kind: 'days', days: 365 });
  });
});

describe('Settings > Follow-ups', () => {
  it('shows the defaults: every automatic option off, 3 days later, 09:00', async () => {
    await mountScreen();
    for (const k of ['none', 'overdue', 'today', 'future']) {
      expect(sw(label(`settings.followUps.when.${k}`)).getAttribute('aria-checked'), k).toBe(
        'false',
      );
    }
    expect(radio(label('settings.followUps.date.three_days')).checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('09:00');
    expect(btn(label('settings.save')).disabled).toBe(true);
  });

  it('saves the whole section: the situations, the chosen date and the time', async () => {
    await mountScreen();
    await click(sw(label('settings.followUps.when.none')));
    await click(sw(label('settings.followUps.when.overdue')));
    await click(radio(label('settings.followUps.date.week')));
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledWith({
      updateWhen: { none: true, overdue: true, today: false, future: false },
      defaultDate: { kind: 'days', days: 7 },
      defaultTime: '09:00',
    });
    expect(host.textContent).toContain(label('settings.saved'));
  });

  it('a custom number of days appears with its own input, and someday and none explain themselves', async () => {
    await mountScreen();
    expect(host.querySelector('input[type="number"]')).toBeNull();
    await click(radio(label('settings.followUps.date.custom')));
    const days = host.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(days).not.toBeNull();
    expect(host.textContent).toContain(label('settings.followUps.date.somedayHint'));
    expect(host.textContent).toContain(label('settings.followUps.date.noneHint'));
  });

  it('a later save carries the version it read', async () => {
    state.query = ok(
      settings({
        rowVersion: 5,
        updateWhen: { none: true, overdue: false, today: false, future: false },
      }),
    );
    await mountScreen();
    await click(sw(label('settings.followUps.when.future')));
    await click(btn(label('settings.save')));
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ rowVersion: 5 }));
  });

  it('a person who cannot manage the settings sees the notice, not the form', async () => {
    state.perms = new Set();
    await mountScreen();
    expect(host.textContent).toContain(label('settings.errors.forbidden'));
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });
});
