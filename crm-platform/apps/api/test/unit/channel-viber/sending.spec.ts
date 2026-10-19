import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE,
  progressPct,
  readBatch,
} from '../../../src/modules/channel-viber/broadcast-rules';
import { lastDays, pct, validTimeZone } from '../../../src/modules/channel-viber/insights-rules';
import {
  broadcastMessage,
  escapeHtml,
  mediaKindFor,
  pictureMessage,
  templateButtons,
  templateMessage,
  textMessage,
  videoMessage,
  withKeyboard,
} from '../../../src/modules/channel-viber/viber-message';

describe('Viber message objects (TW-VIB-009, 013)', () => {
  it('text is cut at 7000 characters, a picture caption at 768', () => {
    expect((textMessage('x'.repeat(7100)).text as string).length).toBe(7000);
    expect((pictureMessage('https://a/p.jpg', 'y'.repeat(900)).text as string).length).toBe(768);
  });

  it('a video needs a size, at least 1 byte', () => {
    expect(videoMessage('https://a/v.mp4', 0)).toMatchObject({ type: 'video', size: 1 });
    expect(videoMessage('https://a/v.mp4', 1234.7)).toMatchObject({ size: 1234 });
  });

  it('button text is escaped as Viber renders it as HTML', () => {
    expect(escapeHtml(`<b>"A" & 'B'</b>`)).toBe(
      '&lt;b&gt;&quot;A&quot; &amp; &#039;B&#039;&lt;/b&gt;',
    );
  });

  it('a keyboard of reply and link buttons raises the API version and keeps what the button says', () => {
    const m = withKeyboard(textMessage('hi'), [
      { text: 'Yes', type: 'reply' },
      { text: 'Shop', type: 'url', url: 'https://shop.test' },
      { text: '  ', type: 'reply' },
    ]);
    expect(m.min_api_version).toBe(3);
    const buttons = (m.keyboard as { Buttons: Array<Record<string, unknown>> }).Buttons;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ ActionType: 'reply', ActionBody: 'Yes', Text: 'Yes' });
    expect(buttons[1]).toMatchObject({ ActionType: 'open-url', ActionBody: 'https://shop.test' });
  });

  it('no usable button leaves the message as it was, and at most 24 are kept', () => {
    expect(withKeyboard(textMessage('hi'), [])).toEqual(textMessage('hi'));
    const many = Array.from({ length: 30 }, (_, i) => ({ text: `b${i}`, type: 'reply' as const }));
    const m = withKeyboard(textMessage('hi'), many);
    expect((m.keyboard as { Buttons: unknown[] }).Buttons).toHaveLength(24);
  });

  it('template buttons: a link is open-url, a phone is tel:, anything else replies; unlabelled ones go', () => {
    expect(
      templateButtons([
        { type: 'url', text: 'Site', url: 'https://x.test' },
        { type: 'quick_reply_url', title: 'Docs', url: 'https://y.test' },
        { type: 'phone_number', text: 'Call', phone_number: '+911' },
        { type: 'quick_reply', text: 'Hello' },
        { type: 'url', text: 'No link' },
        { type: 'url', url: 'https://z.test' },
        null,
      ]),
    ).toEqual([
      { text: 'Site', type: 'url', url: 'https://x.test' },
      { text: 'Docs', type: 'url', url: 'https://y.test' },
      { text: 'Call', type: 'url', url: 'tel:+911' },
      { text: 'Hello', type: 'reply' },
      { text: 'No link', type: 'reply' },
    ]);
  });

  it('a template with no body sends one space, which Viber accepts', () => {
    expect(templateMessage('', []).text).toBe(' ');
    expect(templateMessage('Hi', [{ text: 'Go' }]).keyboard).toBeDefined();
  });

  it('a broadcast is one message: a file wins, then buttons, else text', () => {
    const none = { buttons: [], mediaUrl: null, mediaKind: null, mediaSize: null };
    expect(broadcastMessage({ ...none, body: 'hello' })).toEqual({ type: 'text', text: 'hello' });
    expect(broadcastMessage({ ...none, body: '' })).toEqual({ type: 'text', text: ' ' });
    expect(
      broadcastMessage({ ...none, body: 'cap', mediaUrl: 'https://a/p.jpg', mediaKind: 'image' }),
    ).toMatchObject({ type: 'picture', text: 'cap', media: 'https://a/p.jpg' });
    expect(
      broadcastMessage({
        ...none,
        body: 'cap',
        mediaUrl: 'https://a/v.mp4',
        mediaKind: 'video',
        mediaSize: 900,
      }),
    ).toMatchObject({ type: 'video', size: 900 });
    expect(
      broadcastMessage({ ...none, body: 'cap', mediaUrl: 'https://a/v.mp4', mediaKind: 'video' }),
    ).toMatchObject({ size: 1 });
    expect(
      broadcastMessage({ ...none, body: 'Pick', buttons: [{ text: 'A' }] }).keyboard,
    ).toBeDefined();
  });

  it('only .mp4 is a video; anything else is sent as a picture (Reference)', () => {
    expect(mediaKindFor('https://a/x.MP4?sig=1')).toBe('video');
    expect(mediaKindFor('https://a/x.gif')).toBe('image');
    expect(mediaKindFor('not a url.mp4')).toBe('video');
  });
});

describe('a broadcast batch (TW-VIB-013)', () => {
  it('goes by the call cap Viber sets, 300', () => {
    expect(BATCH_SIZE).toBe(300);
  });

  it("everyone in failed_list failed with Viber's reason, everyone else was sent", () => {
    const out = readBatch(['a', 'b', 'c'], {
      message_token: '1',
      failed_list: [
        { receiver: 'b', status: 6, status_message: 'not subscribed' },
        { receiver: 'zz', status_message: 'stranger' },
        { receiver: 'c' },
      ],
    });
    expect(out.sent).toEqual(['a']);
    expect(out.failed.get('b')).toBe('not subscribed');
    expect(out.failed.get('c')).toBe('failed');
  });

  it('an answer without a failed_list sends everyone', () => {
    expect(readBatch(['a', 'b'], { message_token: '1' }).sent).toEqual(['a', 'b']);
    expect(readBatch(['a'], undefined).sent).toEqual(['a']);
  });

  it('progress is sent plus failed over the total, whole percent', () => {
    expect(progressPct(1, 1, 4)).toBe(50);
    expect(progressPct(0, 0, 0)).toBe(0);
    expect(progressPct(3, 0, 3)).toBe(100);
  });
});

describe('insights (TW-VIB-016)', () => {
  it('an unknown time zone is UTC', () => {
    expect(validTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(validTimeZone('Mars/Base')).toBe('UTC');
    expect(validTimeZone(undefined)).toBe('UTC');
  });

  it("seven days end today in the viewer's zone, oldest first, across a month end", () => {
    // 2026-03-01 00:30 in Auckland is still 2026-02-28 in UTC.
    const at = new Date('2026-02-28T11:30:00Z');
    expect(lastDays('Pacific/Auckland', at, 3)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(lastDays('UTC', at, 2)).toEqual(['2026-02-27', '2026-02-28']);
    expect(lastDays('UTC', at, 7)).toHaveLength(7);
  });

  it('a rate over nothing is 0', () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33);
  });
});
