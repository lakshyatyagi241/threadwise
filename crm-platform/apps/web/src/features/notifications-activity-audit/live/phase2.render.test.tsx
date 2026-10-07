import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationResponse } from '@crm/contracts';
import { BellPanel } from '../components/notification-bell';
import type { Translator } from '../lib/copy';
import type { AlertSettings } from './use-alert-settings';
import { LiveToastHost } from './live-toast';
import type { LiveAlert } from './model';
import { alertText, announcementText, desktopText } from './present';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/dashboard',
}));

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
    <NextIntlClientProvider
      locale={locale}
      messages={{ notifications: load(locale) } as never}
      timeZone="UTC"
      now={new Date('2026-10-07T10:05:00.000Z')}
    >
      <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
const translator = (locale: Locale) =>
  createTranslator({ locale, messages: load(locale) as never }) as unknown as Translator;

const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddd0001';
const SEND = 'ffffffff-ffff-4fff-8fff-ffffffff0001';
const CHANNEL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001';
const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (
  n: number,
  type: string,
  data: Record<string, unknown>,
  over: Partial<NotificationResponse> = {},
): NotificationResponse => ({
  id: rid(n),
  type,
  title: 'Server title',
  body: 'Server body',
  link: null,
  data,
  readAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

const ROWS: NotificationResponse[] = [
  row(1, 'device_connected', { deviceId: DEVICE, deviceName: 'Sales' }),
  row(2, 'device_disconnected', { deviceId: DEVICE, deviceName: 'Sales' }),
  row(3, 'device_logged_out', { deviceId: DEVICE, deviceName: 'Sales' }),
  row(4, 'broadcast_completed', {
    kind: 'broadcast',
    id: SEND,
    name: 'Spring',
    status: 'completed',
    sent: 118,
    failed: 2,
  }),
  row(5, 'broadcast_failed', { kind: 'broadcast', id: SEND, name: 'Spring', reason: 'No credit' }),
  row(6, 'campaign_completed', { kind: 'campaign', id: SEND, name: 'Q4', sent: 10, failed: 0 }),
  row(7, 'scheduled_failed', { kind: 'scheduled_message', id: SEND, name: 'Hello' }),
  row(8, 'teamchat_mention', {
    channelId: CHANNEL,
    authorName: 'Sam',
    channelName: '#sales',
    preview: 'ping @you',
  }),
  row(9, 'teamchat_message', { channelId: CHANNEL, authorName: 'Sam', direct: true }, { count: 3 }),
];

const settings: AlertSettings = {
  soundOn: true,
  setSound: () => undefined,
  desktop: 'default',
  desktopOn: false,
  enableDesktop: async () => undefined,
  setDesktop: () => undefined,
};
const panel = (items: NotificationResponse[]) => (
  <BellPanel
    count={items.length}
    markingAll={false}
    onMarkAll={() => undefined}
    loading={false}
    failed={false}
    items={items}
    onRetry={() => undefined}
    onOpen={() => undefined}
    settings={settings}
  />
);

const alertFor = (r: NotificationResponse, href: string | null = null): LiveAlert => ({
  notificationId: r.id,
  sound: false,
  subject: r.subject?.id ?? `type:${r.type}`,
  type: r.type,
  row: r,
  href,
});

describe('the bell rows of the phase 2 types (en)', () => {
  const out = html(panel(ROWS));

  it('words every type in English, with no key path leaking', () => {
    for (const text of [
      'Sales is connected',
      'Sales disconnected',
      'Sales was logged out',
      'Broadcast “Spring” finished',
      '118 messages sent, 2 failed',
      'Broadcast “Spring” failed',
      'No credit',
      'Campaign “Q4” finished',
      'Scheduled send “Hello” failed',
      'Sam mentioned you in #sales',
      '3 new messages from Sam',
    ]) {
      expect(out, text).toContain(text);
    }
    expect(out).not.toContain('notifications.types');
    expect(out).not.toContain('Server title');
  });

  it('opens each row at the right place', () => {
    expect(out).toContain(`href="/devices/${DEVICE}"`);
    expect(out).toContain(`href="/broadcasts/${SEND}"`);
    expect(out).toContain(`href="/campaigns/${SEND}"`);
    expect(out).toContain(`href="/scheduled/${SEND}"`);
    expect(out).toContain(`href="/team-chat?c=${CHANNEL}"`);
  });

  it('gives each row its icon and tone', () => {
    expect(out).toMatch(/data-icon="device_on" data-tone="success"/);
    expect(out).toMatch(/data-icon="device_off" data-tone="danger"/);
    expect(out).toMatch(/data-icon="broadcast" data-tone="danger"/);
    expect(out).toMatch(/data-icon="broadcast" data-tone="success"/);
    expect(out).toMatch(/data-icon="schedule" data-tone="danger"/);
    expect(out).toMatch(/data-icon="mention" data-tone="info"/);
    expect(out).toMatch(/data-icon="team_chat" data-tone="info"/);
  });

  it('keeps a link to the notification settings in the footer', () => {
    expect(out).toContain('href="/account/notifications"');
    expect(out).toContain('Notification settings');
  });
});

describe('the bell rows of the phase 2 types (ar)', () => {
  const out = html(panel(ROWS), 'ar');

  it('words the rows in Arabic with the right plural forms', () => {
    for (const text of [
      'تم ربط Sales',
      'انقطع اتصال Sales',
      'تم تسجيل خروج Sales',
      'اكتمل البث «Spring»',
      'أُرسلت 118 رسالة',
      'فشلت رسالتان',
      'فشل البث «Spring»',
      'No credit',
      'أشار إليك Sam في #sales',
      '3 رسائل',
    ]) {
      expect(out, text).toContain(text);
    }
    expect(out).toContain('إعدادات الإشعارات');
    expect(out).not.toContain('notifications.types');
  });

  it('wraps names and previews so they read in their own direction', () => {
    expect(out).toContain('dir="auto"');
  });
});

describe('toasts and announcements of the phase 2 types', () => {
  it('draws a problem toast in the danger tone with its icon, and a plain one in the info tone', () => {
    const danger = html(
      <LiveToastHost
        label="Notifications"
        openLabel="Open"
        dismissLabel="Dismiss"
        onOpen={() => undefined}
        onDismiss={() => undefined}
        toasts={[
          {
            id: 1,
            title: 'Sales disconnected',
            body: 'Open the device to reconnect.',
            href: `/devices/${DEVICE}`,
            icon: 'device_off',
            tone: 'danger',
          },
          {
            id: 2,
            title: 'Sam mentioned you',
            body: null,
            href: null,
            icon: 'mention',
            tone: 'info',
          },
        ]}
      />,
    );
    expect(danger).toContain('data-tone="danger"');
    expect(danger).toContain('data-icon="device_off"');
    expect(danger).toContain(`href="/devices/${DEVICE}"`);
    expect(danger).toContain('data-tone="info"');
  });

  it('announces a device problem and a send outcome in both languages', () => {
    const device = alertFor(ROWS[1]!, `/devices/${DEVICE}`);
    expect(announcementText(translator('en'), [device])).toBe(
      'Sales disconnected. Open the device to reconnect.',
    );
    expect(announcementText(translator('ar'), [device])).toBe(
      'انقطع اتصال Sales. افتح الجهاز لإعادة الاتصال.',
    );
    expect(alertText(translator('en'), alertFor(ROWS[3]!)).body).toBe(
      '118 messages sent, 2 failed',
    );
  });

  it('the desktop alert names the event, never the content (no contact, no preview, no reason)', () => {
    const en = translator('en');
    expect(desktopText(en, alertFor(ROWS[1]!))).toEqual({
      title: 'WhatsApp number disconnected',
      body: '',
    });
    expect(desktopText(en, alertFor(ROWS[4]!)).title).toBe('Broadcast failed');
    expect(JSON.stringify(desktopText(en, alertFor(ROWS[4]!)))).not.toContain('No credit');
    expect(desktopText(en, alertFor(ROWS[7]!)).title).toBe('Mentioned you in Team chat');
    expect(JSON.stringify(desktopText(en, alertFor(ROWS[7]!)))).not.toContain('ping @you');
    expect(desktopText(translator('ar'), alertFor(ROWS[8]!)).title).toBe('رسالة مباشرة جديدة');
  });
});
