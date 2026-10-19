import { describe, expect, it } from 'vitest';
import {
  broadcastMessages,
  buttonsTemplate,
  httpsUrl,
  replyMessages,
  templateToMessages,
  textMessage,
  withQuickReplies,
} from '../../../src/modules/channel-line/message-builders';

describe('textMessage', () => {
  it('cuts at 5000 characters without splitting an emoji', () => {
    const t = textMessage('😀'.repeat(5001));
    expect(Array.from(t.text as string)).toHaveLength(5000);
    expect(textMessage('hi')).toEqual({ type: 'text', text: 'hi' });
  });
});

describe('withQuickReplies', () => {
  it('adds up to 13 chips that tap back as a message with the label', () => {
    const labels = Array.from({ length: 20 }, (_, i) => `Option ${i}`);
    const msg = withQuickReplies(textMessage('pick'), labels) as {
      quickReply: { items: Array<{ action: { type: string; label: string; text: string } }> };
    };
    expect(msg.quickReply.items).toHaveLength(13);
    expect(msg.quickReply.items[0]!.action).toEqual({
      type: 'message',
      label: 'Option 0',
      text: 'Option 0',
    });
  });

  it('cuts a long label to 20 characters but taps back the whole text', () => {
    const msg = withQuickReplies(textMessage('x'), ['A very long button label indeed']) as {
      quickReply: { items: Array<{ action: { label: string; text: string } }> };
    };
    expect(msg.quickReply.items[0]!.action.label).toBe('A very long button l');
    expect(msg.quickReply.items[0]!.action.text).toBe('A very long button label indeed');
  });

  it('leaves the message alone when no label is usable', () => {
    expect(withQuickReplies(textMessage('x'), [' ', ''])).toEqual(textMessage('x'));
  });
});

describe('buttonsTemplate', () => {
  it('keeps four actions, cuts the text to 160 and gives an alt text', () => {
    const m = buttonsTemplate(
      'x'.repeat(200),
      Array.from({ length: 6 }, (_, i) => ({ type: 'message' as const, label: `B${i}` })),
    ) as { altText: string; template: { text: string; actions: unknown[] } };
    expect(m.template.actions).toHaveLength(4);
    expect(m.template.text).toHaveLength(160);
    expect(m.altText).toHaveLength(160);
  });
});

describe('templateToMessages', () => {
  it('a plain body is one text message', () => {
    expect(templateToMessages('Hello')).toEqual([textMessage('Hello')]);
  });

  it('reply buttons become quick-reply chips on the text', () => {
    const [m] = templateToMessages('Pick', [{ type: 'quick_reply', text: 'Yes' }]) as Array<{
      type: string;
      quickReply: unknown;
    }>;
    expect(m!.type).toBe('text');
    expect(m!.quickReply).toBeDefined();
  });

  it('a link or phone button makes a buttons template; reply buttons ride along as actions', () => {
    const [m] = templateToMessages('Shop now', [
      { type: 'url', text: 'Open', url: 'https://shop.example.com' },
      { type: 'phone_number', text: 'Call', phone_number: '+911234567890' },
      { type: 'quick_reply', text: 'Later' },
    ]) as Array<{ type: string; template: { actions: Array<Record<string, string>> } }>;
    expect(m!.type).toBe('template');
    expect(m!.template.actions).toEqual([
      { type: 'uri', label: 'Open', uri: 'https://shop.example.com' },
      { type: 'uri', label: 'Call', uri: 'tel:+911234567890' },
      { type: 'message', label: 'Later', text: 'Later' },
    ]);
  });

  it('a body too long for the template goes first as its own bubble', () => {
    const body = 'y'.repeat(200);
    const messages = templateToMessages(body, [
      { type: 'url', text: 'Open', url: 'https://x.example.com' },
    ]) as Array<{ type: string; text?: string; template?: { text: string } }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(textMessage(body));
    expect(messages[1]!.template!.text).toBe('↓');
  });

  it('skips buttons without a label and a link button without an address', () => {
    expect(
      templateToMessages('Hi', [
        { type: 'url', text: '', url: 'https://x' },
        { type: 'url', text: 'A' },
      ]),
    ).toHaveLength(1);
  });
});

describe('broadcastMessages', () => {
  it('puts the media bubble first, then the text', () => {
    const m = broadcastMessages({ url: 'http://cdn.example.com/a.png', kind: 'image' }, 'Hi', []);
    expect(m).toEqual([
      {
        type: 'image',
        originalContentUrl: 'https://cdn.example.com/a.png',
        previewImageUrl: 'https://cdn.example.com/a.png',
      },
      textMessage('Hi'),
    ]);
  });

  it('video and audio get their own message type; audio is a minute long', () => {
    expect(broadcastMessages({ url: 'https://x/a.mp4', kind: 'video' }, '', [])[0]).toMatchObject({
      type: 'video',
    });
    expect(broadcastMessages({ url: 'https://x/a.mp3', kind: 'audio' }, '', [])[0]).toMatchObject({
      type: 'audio',
      duration: 60000,
    });
  });

  it('sends nothing for no media and a blank text, and never more than five objects', () => {
    expect(broadcastMessages(null, '   ', [])).toEqual([]);
    expect(
      broadcastMessages({ url: 'https://x/a.png', kind: 'image' }, 'z'.repeat(400), [
        { type: 'url', text: 'Go', url: 'https://x' },
      ]).length,
    ).toBeLessThanOrEqual(5);
  });
});

describe('replyMessages', () => {
  it('a text reply is one text message, a blank one a single space', () => {
    expect(replyMessages('Hello', null)).toEqual([textMessage('Hello')]);
    expect(replyMessages('', null)).toEqual([textMessage(' ')]);
  });

  it('a caption leads the image; a document goes as a link in text', () => {
    const withImage = replyMessages('Look', { url: 'https://x/a.png', kind: 'image' });
    expect(withImage.map((m) => m.type)).toEqual(['text', 'image']);
    expect(replyMessages('', { url: 'https://x/a.pdf', kind: 'document' })).toEqual([
      textMessage('https://x/a.pdf'),
    ]);
  });
});

describe('httpsUrl', () => {
  it('upgrades http and leaves https alone', () => {
    expect(httpsUrl('http://a.test/x')).toBe('https://a.test/x');
    expect(httpsUrl('https://a.test/x')).toBe('https://a.test/x');
  });
});
