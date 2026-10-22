// @vitest-environment jsdom
import { CONSENT_SETTINGS_DEFAULTS, NO_PRIVACY, type ContactConsent } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  settings: {} as Record<string, unknown>,
  contact: {} as Record<string, unknown>,
  save: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  KEYS: {
    all: ['contact-consent'],
    settings: ['contact-consent', 'settings'],
    composer: ['contact-consent', 'composer'],
    exports: ['contact-consent', 'exports'],
    contact: (id: string) => ['contact-consent', 'contact', id],
  },
  useConsentSettings: () => state.settings,
  useConsentExports: () => ({ data: undefined }),
  useContactConsent: () => state.contact,
}));
vi.mock('../api/service', () => ({
  consentApi: { saveSettings: (i: unknown) => state.save(i), test: vi.fn() },
  consentExportUrl: () => '/api/v2/contact-consent/export',
  consentExportFileUrl: (id: string) => `/api/v2/contact-consent/exports/${id}/download`,
}));

import { ConsentCard } from './consent-card';
import { ConsentSettingsScreen } from './consent-settings-screen';

const settings = { ...CONSENT_SETTINGS_DEFAULTS, rowVersion: 2, updatedAt: '2026-01-01T00:00:00Z' };
const consent = (over: Partial<ContactConsent> = {}): ContactConsent => ({
  contactId: 'c1',
  optedOut: false,
  states: [],
  events: [],
  privacy: NO_PRIVACY,
  ...over,
});
const consentQuery = (over: Record<string, unknown>) => ({
  isLoading: false,
  isError: false,
  error: null,
  data: undefined,
  ...over,
});
const requireSwitch = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="switch"]')].find(
    (s) => s.getAttribute('aria-label') === text('policy.requireConsent'),
  )!;

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['settings.consent.manage', 'contacts.consent.read']);
  state.settings = { isError: false, error: null, data: settings, refetch: vi.fn() };
  state.contact = consentQuery({ data: consent() });
  state.save.mockReset();
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe('consent settings screen states', () => {
  it('shows an error state with a retry when the settings fail to load', async () => {
    const refetch = vi.fn();
    state.settings = { isError: true, error: new Error('boom'), data: undefined, refetch };
    m = await mount(<ConsentSettingsScreen />);
    expect(m.host.textContent).toContain(text('errors.network'));
    expect(m.host.textContent).not.toContain('boom');
    expect(m.host.querySelector('[role="switch"]')).toBeNull();
    await click(button(m.host, text('common.retry')));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed values and shows the error when save fails', async () => {
    state.save.mockRejectedValue(new Error('offline'));
    m = await mount(<ConsentSettingsScreen />);
    await click(requireSwitch(m.host));
    await click(button(m.host, text('settings.save')));
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain(text('errors.network'));
    // The edit is still there and the button works again.
    expect(requireSwitch(m.host).getAttribute('aria-checked')).toBe('true');
    expect(button(m.host, text('settings.save')).disabled).toBe(false);
  });
});

describe('consent card states', () => {
  it('shows an error state when the contact consent fails to load, not the empty state', async () => {
    state.contact = consentQuery({ isError: true, error: new Error('boom') });
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.querySelector('[role="alert"]')?.textContent).toContain(text('errors.network'));
    expect(m.host.textContent).not.toContain(text('card.noneRecorded'));
  });

  it('shows the empty state for a contact with no consent recorded yet', async () => {
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.textContent).toContain(text('card.noneRecorded'));
    expect(m.host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a spinner while loading, not the empty state', async () => {
    state.contact = consentQuery({ isLoading: true });
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.querySelector('[role="status"]')?.textContent).toContain(text('card.loading'));
    expect(m.host.textContent).not.toContain(text('card.noneRecorded'));
  });
});
