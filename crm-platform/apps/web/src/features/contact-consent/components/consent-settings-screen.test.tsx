// @vitest-environment jsdom
import { CONSENT_SETTINGS_DEFAULTS, type ConsentSettings } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  settings: {} as Record<string, unknown>,
  save: vi.fn(),
  test: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  KEYS: {
    all: ['contact-consent'],
    settings: ['contact-consent', 'settings'],
    composer: ['contact-consent', 'composer'],
  },
  useConsentSettings: () => state.settings,
}));
vi.mock('../api/service', () => ({
  consentApi: {
    saveSettings: (i: unknown) => state.save(i),
    test: (i: unknown) => state.test(i),
  },
  consentExportUrl: () => '/api/v2/contact-consent/export',
}));

import { ConsentSettingsScreen } from './consent-settings-screen';

const settings = (over: Partial<ConsentSettings> = {}): ConsentSettings => ({
  ...CONSENT_SETTINGS_DEFAULTS,
  rowVersion: 2,
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const ok = (data: unknown) => ({ isError: false, error: null, data, refetch: vi.fn() });

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['settings.consent.manage']);
  state.settings = ok(settings());
  state.save.mockReset().mockResolvedValue(settings({ rowVersion: 3 }));
  state.test.mockReset();
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe('consent settings screen', () => {
  it('shows the defaults: detection on, auto reply on, policy off, the documented keywords and the footer preview', async () => {
    m = await mount(<ConsentSettingsScreen />);
    const h = m.host;
    expect(h.textContent).toContain(text('settings.title'));
    const switches = [...h.querySelectorAll('[role="switch"]')] as HTMLButtonElement[];
    const byLabel = (l: string) => switches.find((s) => s.getAttribute('aria-label') === l)!;
    expect(byLabel(text('policy.requireConsent')).getAttribute('aria-checked')).toBe('false');
    expect(byLabel(text('detect.enabled')).getAttribute('aria-checked')).toBe('true');
    expect(byLabel(text('detect.autoReply')).getAttribute('aria-checked')).toBe('true');
    const out = h.querySelector<HTMLTextAreaElement>('#en-out')!;
    expect(out.value.split('\n')).toEqual(
      expect.arrayContaining([
        'STOP',
        'STOPALL',
        'UNSUBSCRIBE',
        'CANCEL',
        'END',
        'QUIT',
        'OPT OUT',
      ]),
    );
    expect(h.querySelector<HTMLTextAreaElement>('#ar-out')!.value).toContain('توقف');
    // The preview shows the recipient's view with the line under the sample text.
    expect(h.textContent).toContain('Reply STOP to unsubscribe');
    // Nothing changed yet: Save is off.
    expect(button(h, text('settings.save')).disabled).toBe(true);
  });

  it('saves the whole document with the version it read', async () => {
    m = await mount(<ConsentSettingsScreen />);
    await click(
      [...m.host.querySelectorAll('[role="switch"]')].find(
        (s) => s.getAttribute('aria-label') === text('policy.requireConsent'),
      )!,
    );
    const save = button(m.host, text('settings.save'));
    expect(save.disabled).toBe(false);
    await click(save);
    expect(state.save).toHaveBeenCalledTimes(1);
    const sent = state.save.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.requireConsentForMarketing).toBe(true);
    expect(sent.rowVersion).toBe(2);
    expect(sent.optOutKeywords).toEqual(CONSENT_SETTINGS_DEFAULTS.optOutKeywords);
  });

  it('refuses to save while detection is on and no STOP word is left', async () => {
    m = await mount(<ConsentSettingsScreen />);
    await type(m.host.querySelector<HTMLTextAreaElement>('#en-out')!, '');
    await type(m.host.querySelector<HTMLTextAreaElement>('#ar-out')!, '');
    expect(m.host.textContent).toContain(text('settings.problems.noOptOutWord'));
    expect(button(m.host, text('settings.save')).disabled).toBe(true);
  });

  it('the test box sends the typed words and shows what would happen and the reply', async () => {
    state.test.mockResolvedValue({
      match: 'opt_out',
      keyword: 'stop',
      lang: 'en',
      reply: 'You have been unsubscribed.',
      outcome: 'opts_out',
    });
    m = await mount(<ConsentSettingsScreen />);
    await type(m.host.querySelector<HTMLInputElement>('#consent-test')!, 'STOP!');
    await click(button(m.host, text('test.run')));
    expect(state.test).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'STOP!', optOutKeywords: expect.any(Object) }),
    );
    expect(m.host.textContent).toContain(text('test.outcome.opts_out'));
    expect(m.host.textContent).toContain('You have been unsubscribed.');
  });

  it('a person without the permission sees no form', async () => {
    state.perms = new Set();
    m = await mount(<ConsentSettingsScreen />);
    expect(m.host.textContent).toContain(text('errors.forbidden'));
    expect(m.host.querySelector('[role="switch"]')).toBeNull();
  });

  it('renders in Arabic with Arabic copy and no raw message keys', async () => {
    m = await mount(<ConsentSettingsScreen />, { locale: 'ar' });
    expect(m.host.textContent).toContain(text('settings.title', 'ar'));
    expect(m.host.textContent).not.toMatch(/contact-consent\./);
  });
});
