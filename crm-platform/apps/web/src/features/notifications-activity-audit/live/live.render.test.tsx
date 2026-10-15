import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationResponse } from '@crm/contracts';
import { RealtimeProvider } from '@/lib/realtime';
import { BellPanel } from '../components/notification-bell';
import { pollIntervalFor, POLL_MS } from '../api/hooks';
import type { Translator } from '../lib/copy';
import type { AlertSettings } from './use-alert-settings';
import { LiveToastHost } from './live-toast';
import { LiveNotifications } from './live-notifications';
import type { LiveAlert } from './model';
import { alertText, announcementText, desktopText } from './present';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/dashboard',
}));

const load = (locale: 'en' | 'ar') =>
  (
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'messages', locale, 'notifications-activity-audit.json'),
        'utf8',
      ),
    ) as { notifications: Record<string, unknown> }
  ).notifications;

const html = (el: ReactElement, locale: 'en' | 'ar' = 'en') =>
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

const translator = (locale: 'en' | 'ar') =>
  createTranslator({ locale, messages: load(locale) as never }) as unknown as Translator;

const CONV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = (over: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id: '00000000-0000-4000-8000-000000000001',
  type: 'new_message',
  title: 'Server title',
  body: 'Server body',
  link: `/inbox?c=${CONV}`,
  data: { conversationId: CONV, contactName: 'Ada Lovelace', preview: 'Can you call me back?' },
  readAt: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  count: 1,
  subject: { kind: 'conversation', id: CONV },
  ...over,
});
const alert = (over: Partial<NotificationResponse> = {}): LiveAlert => {
  const r = row(over);
  return { notificationId: r.id, sound: true, subject: CONV, type: r.type, row: r, href: r.link };
};

const settings = (over: Partial<AlertSettings> = {}): AlertSettings => ({
  soundOn: true,
  setSound: () => undefined,
  desktop: 'default',
  desktopOn: false,
  enableDesktop: async () => undefined,
  setDesktop: () => undefined,
  ...over,
});

const panel = (over: Partial<Parameters<typeof BellPanel>[0]> = {}) => (
  <BellPanel
    count={0}
    markingAll={false}
    onMarkAll={() => undefined}
    loading={false}
    failed={false}
    items={[]}
    onRetry={() => undefined}
    onOpen={() => undefined}
    settings={settings()}
    {...over}
  />
);

describe('live updates paused note', () => {
  it('shows a quiet note in the bell panel only when live updates are paused (en and ar)', () => {
    expect(html(panel())).not.toContain('data-testid="live-paused"');
    const out = html(panel({ livePaused: true }));
    expect(out).toContain('data-testid="live-paused"');
    expect(out).toContain('Live updates are paused');
    expect(html(panel({ livePaused: true }), 'ar')).toContain(translator('ar')('live.paused'));
  });
});

describe('the generic toast words', () => {
  it('has words for one and for many, in English and Arabic', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = translator(locale);
      expect(t('live.generic')).not.toBe('live.generic');
      expect(t('live.summary', { count: 4 })).toContain('4');
    }
    expect(translator('en')('live.generic')).toBe('You have a new notification');
  });

  it('the test notification reads as a row and a toast in English, with no contact name', () => {
    const t = translator('en');
    expect(alertText(t, alert({ type: 'test', data: null, title: 'Test notification' }))).toEqual({
      title: 'Test notification',
      body: 'If you can read this, live notifications are working.',
    });
  });
});

describe('bell panel states (en)', () => {
  it('empty: says so and disables mark-all', () => {
    const out = html(panel());
    expect(out).toContain('No notifications yet.');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Mark all read/);
  });

  it('unread: shows the contact, the preview and a collapsed count in the title, links to the conversation', () => {
    const out = html(
      panel({
        count: 3,
        items: [
          row({
            count: 3,
            data: {
              conversationId: CONV,
              contactName: 'Ada Lovelace',
              preview: 'Can you call me back?',
            },
          }),
        ],
      }),
    );
    expect(out).toContain('3 new messages from Ada Lovelace');
    expect(out).toContain('Can you call me back?');
    expect(out).toContain(`href="/inbox?c=${CONV}"`);
    expect(out).toContain('Unread');
    expect(out).toContain('dir="auto"');
  });

  it('one message reads in the singular; a read row is not marked unread', () => {
    const out = html(panel({ items: [row({ readAt: '2026-10-07T10:01:00.000Z' })] }));
    expect(out).toContain('New message from Ada Lovelace');
    expect(out).not.toContain('Unread');
  });

  it('renders chat types of every kind without leaking a key path', () => {
    const items = [
      row({ id: '00000000-0000-4000-8000-000000000002', type: 'new_chat' }),
      row({
        id: '00000000-0000-4000-8000-000000000003',
        type: 'conversation_assigned',
        data: { conversationId: CONV, contactName: 'Ada Lovelace', assignedByName: 'Sam' },
      }),
      row({
        id: '00000000-0000-4000-8000-000000000004',
        type: 'mention',
        data: {
          conversationId: CONV,
          contactName: 'Ada Lovelace',
          authorName: 'Sam',
          preview: 'see this',
        },
      }),
    ];
    const out = html(panel({ count: 3, items }));
    expect(out).toContain('New chat from Ada Lovelace');
    expect(out).toContain('Ada Lovelace was assigned to you');
    expect(out).toContain('Assigned by Sam');
    expect(out).toContain('Sam mentioned you');
    expect(out).toContain('Ada Lovelace: see this');
    expect(out).not.toMatch(/types\.|notifications\./);
  });

  it('an unknown type falls back to the server wording', () => {
    const out = html(
      panel({
        items: [
          row({ type: 'something_new', title: 'Brand new', body: 'From the server', link: null }),
        ],
      }),
    );
    expect(out).toContain('Brand new');
    expect(out).toContain('From the server');
  });

  it('loading and failed', () => {
    expect(html(panel({ loading: true }))).toContain('Loading notifications');
    const failed = html(panel({ failed: true }));
    expect(failed).toContain('Could not load notifications.');
    expect(failed).toContain('Try again');
  });
});

describe('desktop alert control states', () => {
  it('default: offers "Enable desktop alerts" (the only thing that asks the browser)', () => {
    const out = html(panel({ settings: settings({ desktop: 'default' }) }));
    expect(out).toContain('Enable desktop alerts');
    expect(out).toContain('Sound: on');
  });
  it('granted: a switch showing its state', () => {
    const on = html(panel({ settings: settings({ desktop: 'granted', desktopOn: true }) }));
    expect(on).toContain('Desktop alerts: on');
    expect(on).toContain('aria-checked="true"');
    const off = html(
      panel({ settings: settings({ desktop: 'granted', desktopOn: false, soundOn: false }) }),
    );
    expect(off).toContain('Desktop alerts: off');
    expect(off).toContain('Sound: off');
  });
  it('denied: explains instead of offering a button that cannot work', () => {
    const out = html(panel({ settings: settings({ desktop: 'denied' }) }));
    expect(out).toContain('Desktop alerts are blocked in your browser settings.');
    expect(out).not.toContain('Enable desktop alerts');
  });
  it('unsupported: no desktop control at all', () => {
    const out = html(panel({ settings: settings({ desktop: 'unsupported' }) }));
    expect(out).not.toMatch(/desktop alerts/i);
    expect(out).toContain('Sound: on');
  });
});

describe('bell panel (ar)', () => {
  it('words the panel, the collapsed count and the switches in Arabic', () => {
    const out = html(
      panel({
        count: 3,
        items: [row({ count: 3 })],
        settings: settings({ desktop: 'default' }),
      }),
      'ar',
    );
    expect(out).toContain('تعليم الكل كمقروء');
    expect(out).toContain('رسائل جديدة من Ada Lovelace');
    expect(out).toContain('تفعيل تنبيهات سطح المكتب');
    expect(out).toContain('الصوت: مفعّل');
    expect(out).toContain('dir="auto"');
  });
  it('uses the Arabic dual for two messages', () => {
    const out = html(panel({ count: 2, items: [row({ count: 2 })] }), 'ar');
    expect(out).toContain('رسالتان جديدتان من Ada Lovelace');
  });
});

describe('toast content', () => {
  const noop = () => undefined;
  const toastHtml = (locale: 'en' | 'ar') => {
    const t = translator(locale);
    const { title, body } = alertText(t, alert({ count: 2 }));
    return html(
      <LiveToastHost
        toasts={[{ id: 1, title, body, href: `/inbox?c=${CONV}` }]}
        label={t('live.toastRegion')}
        openLabel={t('live.open')}
        dismissLabel={t('live.dismiss')}
        onOpen={noop}
        onDismiss={noop}
      />,
      locale,
    );
  };

  it('shows the title, the preview, an Open link to the conversation and a dismiss button', () => {
    const out = toastHtml('en');
    expect(out).toContain('2 new messages from Ada Lovelace');
    expect(out).toContain('Can you call me back?');
    expect(out).toContain(`href="/inbox?c=${CONV}"`);
    expect(out).toContain('>Open<');
    expect(out).toContain('aria-label="Dismiss"');
  });

  it('is silent to screen readers on purpose (the hidden live region announces it) and has no animation to reduce', () => {
    const out = toastHtml('en');
    expect(out).not.toContain('aria-live');
    expect(out).not.toContain('role="status"');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toMatch(/animate-|transition/);
  });

  it('uses logical positions (end, not right) so it mirrors in Arabic, and Arabic words', () => {
    const out = toastHtml('ar');
    expect(out).toContain('sm:end-4');
    expect(out).not.toMatch(/\bright-|\bleft-/);
    expect(out).toContain('فتح');
    expect(out).toContain('إغلاق');
  });

  it('is absent when there is nothing to show', () => {
    expect(
      html(
        <LiveToastHost
          toasts={[]}
          label="x"
          openLabel="o"
          dismissLabel="d"
          onOpen={noop}
          onDismiss={noop}
        />,
      ),
    ).toBe('');
  });

  it('a summary toast has no link', () => {
    const t = translator('en');
    const out = html(
      <LiveToastHost
        toasts={[{ id: 2, title: t('live.summary', { count: 5 }), body: null, href: null }]}
        label="n"
        openLabel="Open"
        dismissLabel="Dismiss"
        onOpen={noop}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('5 new notifications');
    expect(out).not.toContain('<a ');
  });

  it('renders text, never markup, from a hostile name or preview', () => {
    const t = translator('en');
    const evil = alert({
      data: {
        conversationId: CONV,
        contactName: '<img src=x onerror=alert(1)>',
        preview: '<script>x</script>',
      },
    });
    const { title, body } = alertText(t, evil);
    const out = html(
      <LiveToastHost
        toasts={[{ id: 3, title, body, href: null }]}
        label="n"
        openLabel="o"
        dismissLabel="d"
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img');
  });
});

describe('words for the announcement and the desktop alert', () => {
  it('announces one alert in full and several as a count (en and ar)', () => {
    const en = translator('en');
    expect(announcementText(en, [alert()])).toBe(
      'New message from Ada Lovelace. Can you call me back?',
    );
    expect(
      announcementText(en, [alert(), alert({ id: '00000000-0000-4000-8000-000000000009' })]),
    ).toBe('2 new notifications');
    const ar = translator('ar');
    expect(announcementText(ar, [alert(), alert(), alert()])).toContain('3');
    expect(announcementText(en, [])).toBe('');
  });

  it('the desktop alert names the contact and the kind of event, never the message text', () => {
    const en = translator('en');
    const text = desktopText(en, alert());
    expect(text).toEqual({ title: 'Ada Lovelace', body: 'New message' });
    expect(JSON.stringify(text)).not.toContain('call me back');
    expect(desktopText(en, alert({ data: { conversationId: CONV, preview: 'secret' } }))).toEqual({
      title: 'New message',
      body: '',
    });
    // Only a conversation names the contact; anything else is named by what happened.
    expect(desktopText(en, alert({ type: 'task_due' })).title).toBe('New notification');
  });

  it('the waiting nudge toasts with the contact and the preview, and its desktop alert says only that it is waiting', () => {
    const en = translator('en');
    const nudge = alert({
      type: 'chat_waiting',
      title: 'server words',
      data: { conversationId: CONV, contactName: 'Ada Lovelace', preview: 'Can you call me back?' },
    });
    expect(alertText(en, nudge)).toEqual({
      title: 'No one has answered Ada Lovelace yet',
      body: 'Can you call me back?',
    });
    const desktop = desktopText(en, nudge);
    expect(desktop).toEqual({ title: 'Ada Lovelace', body: 'Waiting for a reply' });
    expect(JSON.stringify(desktop)).not.toContain('call me back');
    expect(desktopText(translator('ar'), nudge)).toEqual({
      title: 'Ada Lovelace',
      body: 'بانتظار الرد',
    });
  });

  it('cuts a long preview to 80 characters in the toast text', () => {
    const t = translator('en');
    const long = 'x'.repeat(200);
    const { body } = alertText(
      t,
      alert({ data: { conversationId: CONV, contactName: 'Ada', preview: long } }),
    );
    expect(Array.from(body ?? '').length).toBe(80);
    expect(body?.endsWith('…')).toBe(true);
  });
});

describe('the provider does nothing it cannot do', () => {
  it('renders only an empty live region with no realtime provider (a public or guest layout, or tests)', () => {
    const out = html(<LiveNotifications />);
    expect(out).toContain('role="status"');
    expect(out).not.toContain('data-testid="live-toast"');
  });

  it('renders the same with an inert realtime provider (no socket address configured)', () => {
    const out = html(
      <RealtimeProvider>
        <LiveNotifications />
      </RealtimeProvider>,
    );
    expect(out).not.toContain('data-testid="live-toast"');
  });
});

describe('adaptive polling', () => {
  it('polls once a minute unless the socket is connected', () => {
    expect(pollIntervalFor('connected')).toBe(false);
    for (const s of ['idle', 'connecting', 'reconnecting', 'unauthorized', 'stopped'] as const) {
      expect(pollIntervalFor(s)).toBe(POLL_MS);
    }
  });
});
