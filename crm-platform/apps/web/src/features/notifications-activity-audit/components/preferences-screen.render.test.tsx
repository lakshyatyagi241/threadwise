import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NotificationPreferenceItem } from '@crm/contracts';
import { stateFromResponse, type PrefsState } from '../prefs/model';
import type { AlertSettings } from '../live/use-alert-settings';
import { PreferencesView } from './preferences-screen';

type Locale = 'en' | 'ar';
const load = (locale: Locale) =>
  (
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'messages', locale, 'notifications-activity-audit.json'),
        'utf8',
      ),
    ) as { notifications: Record<string, unknown> }
  ).notifications;
const html = (el: ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={{ notifications: load(locale) } as never}>
      {el}
    </NextIntlClientProvider>,
  );

const item = (
  type: string,
  group: string,
  over: Partial<NotificationPreferenceItem> = {},
): NotificationPreferenceItem =>
  ({
    type,
    group,
    bell: true,
    toast: true,
    sound: false,
    defaults: { bell: true, toast: true, sound: false },
    overrides: { bell: null, toast: null, sound: null },
    workspaceInapp: true,
    ...over,
  }) as NotificationPreferenceItem;

const state = (...items: NotificationPreferenceItem[]): PrefsState =>
  stateFromResponse({
    items: items.length
      ? items
      : [
          item('new_message', 'conversations', {
            sound: true,
            defaults: { bell: true, toast: true, sound: true },
          }),
          item('device_disconnected', 'devices'),
          item('teamchat_message', 'team_chat', {
            sound: true,
            defaults: { bell: true, toast: true, sound: true },
          }),
        ],
  });

const alerts: AlertSettings = {
  soundOn: true,
  setSound: () => undefined,
  desktop: 'unsupported',
  desktopOn: false,
  enableDesktop: async () => undefined,
  setDesktop: () => undefined,
};
const noop = () => undefined;
const view = (over: Partial<Parameters<typeof PreferencesView>[0]> = {}) => (
  <PreferencesView
    state={state()}
    loading={false}
    failed={false}
    onRetry={noop}
    saveFailed={false}
    onDismissSaveFailed={noop}
    onChange={noop}
    onReset={noop}
    onResetAll={noop}
    alerts={alerts}
    {...over}
  />
);

describe('the preferences screen (en)', () => {
  it('lists the events under their group with a heading, a hint and the default', () => {
    const out = html(view());
    expect(out).toContain('Notification preferences');
    expect(out).toContain('Chats');
    expect(out).toContain('WhatsApp numbers');
    expect(out).toContain('Team chat');
    expect(out).toContain('New message on my chat');
    expect(out).toContain('Number disconnected');
    expect(out).toContain('Default: bell on, pop-up on, sound on');
    expect(out).toContain('Default: bell on, pop-up on, sound off');
    expect(out).not.toContain('notifications.prefs');
  });

  it('gives every switch a name that says the event and the channel, and a role of switch', () => {
    const out = html(view());
    expect(out).toContain('aria-label="New message on my chat: bell"');
    expect(out).toContain('aria-label="New message on my chat: pop-up"');
    expect(out).toContain('aria-label="New message on my chat: sound"');
    expect((out.match(/role="switch"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(out).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });

  it('shows a kind of event with no sound as unavailable instead of a dead switch', () => {
    const out = html(view());
    expect(out).toContain('Number disconnected: sound: Not available');
    expect(out).not.toContain('aria-label="Number disconnected: sound"');
  });

  it('marks a changed event, offers its reset and enables reset-all', () => {
    const changed = state(
      item('new_message', 'conversations', {
        toast: false,
        sound: true,
        defaults: { bell: true, toast: true, sound: true },
        overrides: { bell: null, toast: false, sound: null },
      }),
    );
    const out = html(view({ state: changed }));
    expect(out).toContain('Changed');
    expect(out).toContain('aria-label="Reset New message on my chat to default"');
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Reset everything to default/);
    const clean = html(view());
    expect(clean).toMatch(/<button[^>]*disabled=""[^>]*>Reset everything to default/);
    expect(clean).not.toContain('Reset to default');
  });

  it('explains an event the workspace turned off and disables its switches', () => {
    const blocked = state(
      item('new_message', 'conversations', {
        bell: false,
        toast: true,
        workspaceInapp: false,
        defaults: { bell: false, toast: true, sound: true },
      }),
    );
    const out = html(view({ state: blocked }));
    expect(out).toContain('Turned off by your workspace');
    expect(out).toContain('Your workspace turned this event off');
    expect(out).toMatch(/aria-label="New message on my chat: bell"[^>]*disabled=""/);
    expect(out).toMatch(/aria-label="New message on my chat: sound"[^>]*disabled=""/);
    expect(out).toMatch(/aria-checked="false"[^>]*aria-label="New message on my chat: bell"/);
  });

  it('says to turn the bell on when the pop-up and sound are held back by it', () => {
    const bellOff = state(
      item('new_message', 'conversations', {
        bell: false,
        overrides: { bell: false, toast: null, sound: null },
      }),
    );
    const out = html(view({ state: bellOff }));
    expect(out).toContain('Turn the bell on to choose a pop-up or sound.');
    expect(out).toMatch(/aria-label="New message on my chat: pop-up"[^>]*disabled=""/);
    expect(out).not.toMatch(/aria-label="New message on my chat: bell"[^>]*disabled=""/);
  });

  it('shows a loading state, an error with a retry, and an empty list', () => {
    expect(html(view({ state: undefined, loading: true }))).toContain('Loading your preferences');
    const failed = html(view({ state: undefined, failed: true }));
    expect(failed).toContain('Could not load your preferences.');
    expect(failed).toContain('Try again');
    expect(failed).not.toContain('role="switch" aria-checked="true" aria-label="New');
    expect(html(view({ state: { entries: [] } }))).toContain('There are no notification types');
  });

  it('announces a failed save as an alert and lets it be dismissed', () => {
    const out = html(view({ saveFailed: true }));
    expect(out).toMatch(/role="alert"[^>]*>.*Could not save that change\. It was undone\./);
    expect(out).toContain('Dismiss');
    expect(html(view())).not.toContain('Could not save that change');
  });

  it('keeps the per-browser sound control on the page, with the browser note', () => {
    const out = html(view());
    expect(out).toContain('This browser');
    expect(out).toContain('Sound: on');
  });

  it('uses a single h1 and one named group per section', () => {
    const out = html(view());
    expect((out.match(/<h1/g) ?? []).length).toBe(1);
    expect((out.match(/role="group" aria-labelledby/g) ?? []).length).toBe(3);
  });
});

describe('the preferences screen (ar)', () => {
  it('is worded in Arabic, switches included, with no English or key leaking', () => {
    const out = html(view(), 'ar');
    expect(out).toContain('تفضيلات الإشعارات');
    expect(out).toContain('المحادثات');
    expect(out).toContain('دردشة الفريق');
    expect(out).toContain('رسالة جديدة في محادثتي');
    expect(out).toContain('aria-label="رسالة جديدة في محادثتي: الجرس"');
    expect(out).toContain('الافتراضي: الجرس مفعّل');
    expect(out).toContain('هذا المتصفح');
    expect(out).not.toContain('Notification preferences');
    expect(out).not.toContain('notifications.prefs');
  });

  it('words the disabled and error states in Arabic', () => {
    const blocked = state(
      item('new_message', 'conversations', { bell: false, workspaceInapp: false }),
    );
    const out = html(view({ state: blocked, saveFailed: true }), 'ar');
    expect(out).toContain('أوقفته مساحة العمل');
    expect(out).toContain('تعذّر حفظ هذا التغيير');
    expect(html(view({ state: undefined, failed: true }), 'ar')).toContain('تعذّر تحميل تفضيلاتك.');
  });

  it('uses logical alignment so the layout mirrors (no left or right utilities)', () => {
    const out = html(view(), 'ar');
    expect(out).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});
