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
    push: false,
    defaults: { bell: true, toast: true, sound: false, push: false },
    overrides: { bell: null, toast: null, sound: null, push: null },
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
            push: true,
            defaults: { bell: true, toast: true, sound: true, push: true },
          }),
          item('device_disconnected', 'devices'),
          item('teamchat_message', 'team_chat', {
            sound: true,
            push: true,
            defaults: { bell: true, toast: true, sound: true, push: true },
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

const GROUP_TYPES = [
  'waba_group_join_request',
  'waba_group_suspended',
  'waba_group_suspension_cleared',
  'device_group_join_request',
  'device_group_removed',
] as const;
const groupItems = () => GROUP_TYPES.map((type) => item(type, 'whatsapp_groups'));

describe('the WhatsApp Groups rows of the preferences screen (BL-099)', () => {
  it('shows the five rows under their own heading with the quiet defaults, in English', () => {
    const out = html(view({ state: state(...groupItems()) }));
    expect(out).toContain('WhatsApp groups');
    expect(out).toContain('Request to join a group');
    expect(out).toContain('Group suspended');
    expect(out).toContain('Group active again');
    expect(out).toContain('Request to join a personal-number group');
    expect(out).toContain('Removed from a personal-number group');
    expect(out).toContain('aria-label="Request to join a group: bell"');
    expect(out).toContain('Default: bell on, pop-up on, sound off');
    expect(out).not.toContain('notifications.prefs');
  });

  it('shows them in Arabic with no raw keys', () => {
    const out = html(view({ state: state(...groupItems()) }), 'ar');
    expect(out).toContain('مجموعات واتساب');
    expect(out).toContain('طلب انضمام إلى مجموعة');
    expect(out).toContain('تعليق مجموعة');
    expect(out).not.toContain('notifications.prefs');
  });

  it('shows no row and no heading when the server leaves them out (a plan without Groups)', () => {
    const out = html(view());
    expect(out).not.toContain('WhatsApp groups');
    expect(out).not.toContain('Request to join a group');
    expect(out).not.toContain('Group suspended');
  });

  it('has the push off by default for all five (a person turns it on)', () => {
    for (const e of state(...groupItems()).entries) {
      expect(e.defaults.push, e.type).toBe(false);
      expect(e.flags.push, e.type).toBe(false);
    }
  });
});

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
        defaults: { bell: true, toast: true, sound: true, push: false },
        overrides: { bell: null, toast: false, sound: null, push: null },
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

  it('explains an event the workspace has off, and keeps the personal switches usable', () => {
    const blocked = state(
      item('new_message', 'conversations', {
        bell: false,
        toast: true,
        workspaceInapp: false,
        defaults: { bell: false, toast: true, sound: true, push: true },
      }),
    );
    const out = html(view({ state: blocked, pushEnabled: true }));
    expect(out).toContain('Turned off by your workspace');
    expect(out).toContain('Your workspace has this off; your choice still applies to you.');
    expect(out).not.toContain('Your workspace turned this event off');
    // The bell switch is live (the person can turn it on for themselves); the rest wait for the bell, as when they turned it off.
    expect(out).not.toMatch(/aria-label="New message on my chat: bell"[^>]*disabled=""/);
    expect(out).toMatch(/aria-checked="false"[^>]*aria-label="New message on my chat: bell"/);
    expect(out).toMatch(/aria-label="New message on my chat: pop-up"[^>]*disabled=""/);
    expect(out).toContain('Turn the bell on to choose a pop-up, sound or push.');
  });

  it('offers the pop-up, sound and push again once the person turned the bell on despite the workspace', () => {
    const own = state(
      item('new_message', 'conversations', {
        bell: true,
        workspaceInapp: false,
        overrides: { bell: true, toast: null, sound: null, push: null },
        defaults: { bell: false, toast: true, sound: false, push: true },
      }),
    );
    const out = html(view({ state: own, pushEnabled: true }));
    expect(out).toContain('Your workspace has this off; your choice still applies to you.');
    expect(out).not.toMatch(/aria-label="New message on my chat: bell"[^>]*disabled=""/);
    expect(out).not.toMatch(/aria-label="New message on my chat: pop-up"[^>]*disabled=""/);
    expect(out).not.toMatch(/aria-label="New message on my chat: push"[^>]*disabled=""/);
  });

  it('says to turn the bell on when the pop-up, sound and push are held back by it', () => {
    const bellOff = state(
      item('new_message', 'conversations', {
        bell: false,
        overrides: { bell: false, toast: null, sound: null, push: null },
      }),
    );
    const out = html(view({ state: bellOff }));
    expect(out).toContain('Turn the bell on to choose a pop-up, sound or push.');
    expect(out).toMatch(/aria-label="New message on my chat: pop-up"[^>]*disabled=""/);
    expect(out).not.toMatch(/aria-label="New message on my chat: bell"[^>]*disabled=""/);
  });

  it('shows the Push column only where the deployment has browser notifications', () => {
    const without = html(view());
    expect(without).not.toContain('aria-label="New message on my chat: push"');
    expect(without).toContain('Default: bell on, pop-up on, sound on');
    expect(without).not.toMatch(/>Push</);
    const withPush = html(view({ pushEnabled: true }));
    expect(withPush).toContain('aria-label="New message on my chat: push"');
    expect(withPush).toContain('Default: bell on, pop-up on, sound on, push on');
    expect(withPush).toContain('Default: bell on, pop-up on, sound off, push off');
    expect(withPush).toMatch(/>Push</);
    // A kind of event with no sound still offers push.
    expect(withPush).toContain('aria-label="Number disconnected: push"');
  });

  it('renders the browser notifications card slot above the table', () => {
    const out = html(view({ browserCard: <section data-testid="the-card">card</section> }));
    expect(out.indexOf('the-card')).toBeGreaterThan(-1);
    expect(out.indexOf('the-card')).toBeLessThan(out.indexOf('Chats'));
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

describe('the waiting-for-a-reply row (en, ar)', () => {
  const waiting = () =>
    state(
      item('chat_waiting', 'conversations', {
        push: true,
        defaults: { bell: true, toast: true, sound: false, push: true },
      }),
    );

  it('is listed under Chats with its hint, its default and no sound', () => {
    const out = html(view({ state: waiting(), pushEnabled: true }));
    expect(out).toContain('Chats');
    expect(out).toContain('Chat still waiting for a reply');
    expect(out).toContain('A chat nobody owns has had a customer message unanswered');
    expect(out).toContain('aria-label="Chat still waiting for a reply: bell"');
    expect(out).toContain('aria-label="Chat still waiting for a reply: pop-up"');
    // Like the other quiet types it has no ping at all, so the sound column says so instead of showing a dead switch.
    expect(out).toContain('Chat still waiting for a reply: sound: Not available');
    expect(out).toContain('aria-label="Chat still waiting for a reply: push"');
    expect(out).toContain('Default: bell on, pop-up on, sound off');
    expect(out).not.toContain('notifications.prefs');
  });

  it('is worded in Arabic, with the group and switches named', () => {
    const out = html(view({ state: waiting(), pushEnabled: true }), 'ar');
    expect(out).toContain('المحادثات');
    expect(out).toContain('محادثة ما زالت تنتظر ردًا');
    expect(out).toContain('aria-label="محادثة ما زالت تنتظر ردًا: الجرس"');
    expect(out).not.toContain('Chat still waiting');
    expect(out).not.toContain('notifications.prefs');
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
    const out = html(view({ state: blocked, saveFailed: true, pushEnabled: true }), 'ar');
    expect(out).toContain('أوقفته مساحة العمل');
    expect(out).toContain('اختيارك ما زال ساريًا عليك');
    expect(out).toContain('إشعار المتصفح');
    expect(out).toContain('تعذّر حفظ هذا التغيير');
    expect(html(view({ state: undefined, failed: true }), 'ar')).toContain('تعذّر تحميل تفضيلاتك.');
  });

  it('uses logical alignment so the layout mirrors (no left or right utilities)', () => {
    const out = html(view(), 'ar');
    expect(out).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});

describe('the System group and the paused note', () => {
  const testRow = () => [
    item('test', 'system', {
      sound: true,
      defaults: { bell: true, toast: true, sound: true, push: false },
    }),
  ];

  it('lists the test notification under System, with its default', () => {
    const out = html(view({ state: state(...testRow()) }));
    expect(out).toContain('System');
    expect(out).toContain('Test notification');
    expect(out).toContain('aria-label="Test notification: bell"');
    expect(out).not.toContain('notifications.prefs');
  });

  it('words the System group in Arabic', () => {
    const out = html(view({ state: state(...testRow()) }), 'ar');
    expect(out).toContain('النظام');
    expect(out).toContain('إشعار تجريبي');
  });

  it('explains a title-only state with a small note when live updates are paused, and shows nothing otherwise', () => {
    const paused = html(view({ livePaused: true }));
    expect(paused).toContain('data-testid="live-paused"');
    expect(paused).toContain('Live updates are paused');
    expect(html(view())).not.toContain('data-testid="live-paused"');
    expect(html(view({ livePaused: true }), 'ar')).toContain('data-testid="live-paused"');
  });
});
