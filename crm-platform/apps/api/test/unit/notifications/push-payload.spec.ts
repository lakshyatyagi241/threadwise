import { describe, expect, it } from 'vitest';
import { pushPayloadSchema } from '@crm/contracts';
import { deviceLabel } from '../../../src/modules/notifications/device-label';
import {
  buildPushPayload,
  buildTestPayload,
  pushTag,
  pushTopic,
  safePushLink,
} from '../../../src/modules/notifications/push-payload';

const UUID = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';

const row = (over: Record<string, unknown> = {}) => ({
  uuid: UUID,
  type: 'new_message',
  title: 'New message from Asha',
  body: 'Is the order shipped?',
  data: { contactName: 'Asha Rao', preview: 'Is the order shipped?', count: 1 },
  eventCount: 1,
  link: `/inbox?c=${CONV}`,
  subjectKind: 'conversation',
  subjectUuid: CONV,
  ...over,
});

describe('the push payload of a bell row', () => {
  it('titles a chat message with the contact name and says what kind of event it is, never the text (D4)', () => {
    const p = buildPushPayload(row());
    expect(p.title).toBe('Asha Rao');
    expect(p.body).toBe('New message');
    expect(JSON.stringify(p)).not.toContain('shipped');
    expect(p.url).toBe(`/inbox?c=${CONV}`);
    expect(p.notificationId).toBe(UUID);
    expect(p.test).toBe(false);
    expect(pushPayloadSchema.safeParse(p).success).toBe(true);
  });

  it('says how many messages a collapsed row stands for', () => {
    const p = buildPushPayload(row({ eventCount: 3 }));
    expect(p.title).toBe('Asha Rao');
    expect(p.body).toBe('3 new messages');
  });

  it('never goes past 80 characters in the title or the body', () => {
    const long = 'x'.repeat(500);
    const p = buildPushPayload(
      row({ data: { contactName: long, preview: long }, title: long, body: long }),
    );
    expect(p.title.length).toBeLessThanOrEqual(80);
    expect(p.body.length).toBeLessThanOrEqual(80);
    const other = buildPushPayload(row({ type: 'task_due', title: long, body: long }));
    expect(other.title.length).toBeLessThanOrEqual(80);
    expect(other.body.length).toBeLessThanOrEqual(80);
  });

  it('falls back to the row title when the contact is unknown', () => {
    const noName = buildPushPayload(row({ data: { preview: null } }));
    expect(noName.title).toBe('New message from Asha');
    expect(noName.body).toBe('New message');
    const chat = buildPushPayload(row({ type: 'new_chat', data: { contactName: 'Li' } }));
    expect(chat.body).toBe('New chat');
  });

  it('never carries the words of a note or a team chat message, only who and what kind', () => {
    for (const type of ['mention', 'teamchat_mention', 'teamchat_message']) {
      const p = buildPushPayload(
        row({ type, title: 'Sam mentioned you', body: 'the secret price is 40' }),
      );
      expect(p.title).toBe('Sam mentioned you');
      expect(p.body).toBe('');
      expect(JSON.stringify(p), type).not.toContain('secret price');
    }
  });

  it('uses the row text for types that are not anyone words', () => {
    const p = buildPushPayload(
      row({
        type: 'conversation_assigned',
        title: 'Conversation assigned to you',
        body: 'Asha Rao (by Sam)',
      }),
    );
    expect(p).toMatchObject({
      title: 'Conversation assigned to you',
      body: 'Asha Rao (by Sam)',
    });
  });

  it('puts every message of one conversation under one tag so they replace each other', () => {
    const a = pushTag({ uuid: 'a', subjectKind: 'conversation', subjectUuid: CONV });
    const b = pushTag({ uuid: 'b', subjectKind: 'conversation', subjectUuid: CONV });
    expect(a).toBe(`conversation:${CONV}`);
    expect(b).toBe(a);
    const other = pushTag({ uuid: 'c', subjectKind: 'conversation', subjectUuid: UUID });
    expect(other).not.toBe(a);
  });

  it('gives a row about nothing in particular its own tag, so it never replaces another', () => {
    expect(pushTag({ uuid: 'x1', subjectKind: null, subjectUuid: null })).toBe('notification:x1');
    expect(pushTag({ uuid: 'x2', subjectKind: null, subjectUuid: null })).not.toBe(
      pushTag({ uuid: 'x1', subjectKind: null, subjectUuid: null }),
    );
  });

  it('hashes the tag into a valid Topic header (at most 32 URL-safe characters)', () => {
    const topic = pushTopic(`conversation:${CONV}`);
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(pushTopic(`conversation:${CONV}`)).toBe(topic);
    expect(pushTopic('conversation:other')).not.toBe(topic);
  });

  it('only ever links to a path on this site', () => {
    expect(safePushLink('/inbox?c=1')).toBe('/inbox?c=1');
    for (const bad of [
      'https://evil.example/x',
      '//evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      '/ok\\..\\evil',
    ]) {
      expect(safePushLink(bad as string | null | undefined), String(bad)).toBe('/');
    }
    expect(buildPushPayload(row({ link: 'https://evil.example' })).url).toBe('/');
  });

  it('builds a test payload that never collapses with a real one', () => {
    const t = buildTestPayload();
    expect(t.test).toBe(true);
    expect(t.notificationId).toBeNull();
    expect(t.tag).toBe('test');
    expect(pushPayloadSchema.safeParse(t).success).toBe(true);
  });
});

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Chrome on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Safari on macOS',
    ],
    ['Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0', 'Firefox on Android'],
    [undefined, 'Browser'],
    ['curl/8', 'Browser'],
  ])('%s -> %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
