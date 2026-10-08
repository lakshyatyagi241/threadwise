import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import type { NotificationResponse } from '@crm/contracts';
import { notificationText, type Translator } from './copy';

const load = (locale: 'en' | 'ar') =>
  (
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'messages', locale, 'notifications-activity-audit.json'),
        'utf8',
      ),
    ) as { notifications: Record<string, unknown> }
  ).notifications;
const translator = (locale: 'en' | 'ar') =>
  createTranslator({ locale, messages: load(locale) as never }) as unknown as Translator;
const en = translator('en');
const ar = translator('ar');

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const n = (
  type: string,
  data: Record<string, unknown> | null,
  over: Partial<NotificationResponse> = {},
) => ({ type, title: 'Server title', body: 'Server body', data, ...over });

describe('device notifications', () => {
  it('names the device and says what happened, in English and Arabic', () => {
    expect(
      notificationText(en, n('device_connected', { deviceId: ID, deviceName: 'Sales' })),
    ).toEqual({ title: 'Sales is connected', body: null });
    expect(
      notificationText(en, n('device_disconnected', { deviceId: ID, deviceName: 'Sales' })),
    ).toEqual({ title: 'Sales disconnected', body: 'Open the device to reconnect.' });
    expect(
      notificationText(en, n('device_logged_out', { deviceId: ID, deviceName: 'Sales' })),
    ).toEqual({ title: 'Sales was logged out', body: 'Scan the QR code again to reconnect.' });
    expect(
      notificationText(ar, n('device_logged_out', { deviceId: ID, deviceName: 'المبيعات' })).title,
    ).toBe('تم تسجيل خروج المبيعات');
  });

  it('falls back to the masked number, then to wording with no name', () => {
    expect(
      notificationText(en, n('device_disconnected', { deviceId: ID, maskedNumber: '…1234' })).title,
    ).toBe('…1234 disconnected');
    expect(notificationText(en, n('device_disconnected', { deviceId: ID })).title).toBe(
      'A WhatsApp number disconnected',
    );
    expect(notificationText(ar, n('device_connected', { deviceId: ID })).title).toBe(
      'تم ربط رقم واتساب الخاص بك',
    );
  });
});

describe('broadcast, campaign and scheduled outcomes', () => {
  const done = (sent: number, failed: number, locale = en) =>
    notificationText(
      locale,
      n('broadcast_completed', { kind: 'broadcast', id: ID, name: 'Spring sale', sent, failed }),
    );

  it('says how many went out and how many failed, with the English plural', () => {
    expect(done(1, 0)).toEqual({
      title: 'Broadcast “Spring sale” finished',
      body: '1 message sent',
    });
    expect(done(120, 0).body).toBe('120 messages sent');
    expect(done(118, 2).body).toBe('118 messages sent, 2 failed');
  });

  it('uses every Arabic plural form for the sent count', () => {
    const body = (sent: number) => done(sent, 0, ar).body;
    expect(body(0)).toBe('لم تُرسل أي رسالة');
    expect(body(1)).toBe('أُرسلت رسالة واحدة');
    expect(body(2)).toBe('أُرسلت رسالتان');
    expect(body(3)).toBe('أُرسلت 3 رسائل');
    expect(body(11)).toBe('أُرسلت 11 رسالة');
    expect(body(100)).toBe('أُرسلت 100 رسالة');
  });

  it('adds the failed count in Arabic', () => {
    expect(done(5, 1, ar).body).toContain('فشلت رسالة واحدة');
    expect(done(5, 4, ar).body).toContain('فشلت 4 رسائل');
  });

  it('shows the reason of a failure as text, or a pointer when there is none', () => {
    expect(
      notificationText(
        en,
        n('campaign_failed', { kind: 'campaign', id: ID, name: 'Q4', reason: 'Template rejected' }),
      ),
    ).toEqual({ title: 'Campaign “Q4” failed', body: 'Template rejected' });
    expect(
      notificationText(en, n('scheduled_failed', { kind: 'scheduled_message', id: ID })).body,
    ).toBe('Open it to see what went wrong.');
    expect(
      notificationText(ar, n('broadcast_failed', { kind: 'broadcast', id: ID, name: 'x' })).title,
    ).toBe('فشل البث «x»');
  });

  it('words a scheduled send that went out, with no counts', () => {
    expect(
      notificationText(
        en,
        n('scheduled_completed', { kind: 'scheduled_message', id: ID, name: 'Hi' }),
      ),
    ).toEqual({ title: 'Scheduled send “Hi” went out', body: null });
  });
});

describe('team chat notifications', () => {
  it('words a mention with the channel, without it, and with no author', () => {
    expect(
      notificationText(
        en,
        n('teamchat_mention', {
          channelId: ID,
          authorName: 'Sam',
          channelName: '#sales',
          preview: 'ping @you',
        }),
      ),
    ).toEqual({ title: 'Sam mentioned you in #sales', body: 'ping @you' });
    expect(
      notificationText(en, n('teamchat_mention', { channelId: ID, authorName: 'Sam' })).title,
    ).toBe('Sam mentioned you in Team chat');
    expect(notificationText(en, n('teamchat_mention', { channelId: ID })).title).toBe(
      'You were mentioned in Team chat',
    );
    expect(
      notificationText(
        ar,
        n('teamchat_mention', { channelId: ID, authorName: 'سام', channelName: '#مبيعات' }),
      ).title,
    ).toBe('أشار إليك سام في #مبيعات');
  });

  it('counts collapsed direct messages with the English and Arabic plurals', () => {
    const dm = (count: number, locale = en) =>
      notificationText(
        locale,
        n('teamchat_message', { channelId: ID, authorName: 'Sam', direct: true }, { count }),
      ).title;
    expect(dm(1)).toBe('New message from Sam');
    expect(dm(4)).toBe('4 new messages from Sam');
    expect(dm(1, ar)).toBe('رسالة جديدة من Sam');
    expect(dm(2, ar)).toBe('رسالتان جديدتان من Sam');
    expect(dm(5, ar)).toBe('5 رسائل جديدة من Sam');
    expect(dm(12, ar)).toBe('12 رسالة جديدة من Sam');
  });

  it('cuts a long preview to 80 characters', () => {
    const long = 'x'.repeat(200);
    const body = notificationText(
      en,
      n('teamchat_message', { channelId: ID, authorName: 'Sam', preview: long }),
    ).body!;
    expect(Array.from(body)).toHaveLength(80);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('types the build has no words for', () => {
  it('show the server wording (legacy and future types)', () => {
    expect(notificationText(en, n('wallet_low_balance', null))).toEqual({
      title: 'Server title',
      body: 'Server body',
    });
    expect(notificationText(en, n('brand_new_type', { x: 1 }))).toEqual({
      title: 'Server title',
      body: 'Server body',
    });
  });
});
