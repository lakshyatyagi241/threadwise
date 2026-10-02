import { describe, expect, it } from 'vitest';
import type {
  MediaKind,
  MediaSource,
  SendOptions,
  SentMessage,
  TelegramBotApi,
  TelegramResult,
} from '../../../src/infra/providers/channel-telegram/telegram.port';
import {
  CAPTION_LIMIT,
  fileIdFrom,
  sendToChat,
} from '../../../src/modules/channel-telegram/chat-send';
import { templateButtonsMarkup } from '../../../src/modules/channel-telegram/telegram-markup';
import { parseThreadKey } from '../../../src/modules/channel-telegram/update-rules';

describe('template buttons as a keyboard (WD-TG-009)', () => {
  it('a link makes an inline keyboard: each link a row, quick replies as tqr: callbacks', () => {
    const m = templateButtonsMarkup([
      { type: 'url', text: 'Shop', url: 'https://x.test' },
      { type: 'quick_reply', text: 'Yes' },
    ]);
    expect(m.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: 'Shop', url: 'https://x.test' }],
        [{ text: 'Yes', callback_data: 'tqr:Yes' }],
      ],
    });
    expect(m.append).toBe('');
  });

  it('only quick replies make a one-time reply keyboard', () => {
    const m = templateButtonsMarkup([{ text: 'A' }, { type: 'quick_reply', title: 'B' }]);
    expect(m.replyMarkup).toEqual({
      keyboard: [[{ text: 'A' }], [{ text: 'B' }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    });
  });

  it('a phone button is appended to the text, never a button; with nothing else there is no keyboard', () => {
    const m = templateButtonsMarkup([
      { type: 'phone_number', text: 'Call us', phone_number: '+91 98' },
    ]);
    expect(m.replyMarkup).toBeNull();
    expect(m.append).toBe('\n📞 Call us: +91 98');
  });

  it('skips a button without text, treats a link without an address as a quick reply, and cuts long labels', () => {
    expect(templateButtonsMarkup([{ type: 'url', text: '  ' }, null, 3]).replyMarkup).toBeNull();
    const noUrl = templateButtonsMarkup([{ type: 'url', text: 'Go' }]);
    expect(noUrl.replyMarkup).toMatchObject({ keyboard: [[{ text: 'Go' }]] });
    const long = 'x'.repeat(100);
    const m = templateButtonsMarkup([
      { type: 'url', text: long, url: 'https://x.test' },
      { text: long },
    ]).replyMarkup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
    expect(m.inline_keyboard[0]![0]!.text).toHaveLength(64);
    expect(m.inline_keyboard[1]![0]!.text).toHaveLength(64);
    expect(m.inline_keyboard[1]![0]!.callback_data).toHaveLength('tqr:'.length + 60);
  });
});

describe('the thread key', () => {
  it('names the bot and the chat; the older key has only the chat; anything else is not a thread', () => {
    expect(parseThreadKey('tg:7:555')).toEqual({ botRowId: 7, chatId: '555' });
    expect(parseThreadKey('tg:7:-100123')).toEqual({ botRowId: 7, chatId: '-100123' });
    expect(parseThreadKey('tg:555')).toEqual({ botRowId: null, chatId: '555' });
    expect(parseThreadKey('tg:-100123')).toEqual({ botRowId: null, chatId: '-100123' });
    for (const bad of ['', 'tg', 'tg:', 'wa:1:2', '5551234'])
      expect(parseThreadKey(bad), bad).toBeNull();
  });
});

/** A recording fake of the Bot API for the shared send. */
function fake(
  opts: { media?: TelegramResult<SentMessage>; text?: TelegramResult<SentMessage> } = {},
) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const api = {
    sendMessage: (chat: string, text: string, o?: SendOptions) => {
      calls.push({ method: 'sendMessage', args: [chat, text, o] });
      return Promise.resolve(opts.text ?? { ok: true, result: { message_id: 1 } });
    },
    sendMedia: (
      chat: string,
      kind: MediaKind,
      source: MediaSource,
      caption?: string | null,
      o?: SendOptions,
    ) => {
      calls.push({ method: 'sendMedia', args: [chat, kind, source, caption, o] });
      return Promise.resolve(opts.media ?? { ok: true, result: { message_id: 2 } });
    },
  } as unknown as TelegramBotApi;
  return { api, calls };
}

describe('one message to one chat (WD-TG-008, 013)', () => {
  it('text goes as text with its keyboard; the outcome carries the message id', async () => {
    const f = fake();
    const out = await sendToChat(f.api, '555', { text: 'Hi', markup: { keyboard: [] } });
    expect(out).toEqual({ ok: true, providerMessageId: '1', fileId: null, error: null });
    expect(f.calls[0]).toMatchObject({
      method: 'sendMessage',
      args: ['555', 'Hi', { replyMarkup: { keyboard: [] } }],
    });
  });

  it('a refusal comes back as ok = false with the reason', async () => {
    const f = fake({ text: { ok: false, error: 'Forbidden: bot was blocked by the user' } });
    expect(await sendToChat(f.api, '5', { text: 'x' })).toEqual({
      ok: false,
      providerMessageId: null,
      fileId: null,
      error: 'Forbidden: bot was blocked by the user',
    });
  });

  it('media carries the text as its caption and returns the file id to reuse', async () => {
    const f = fake({
      media: {
        ok: true,
        result: { message_id: 9, photo: [{ file_id: 'small' }, { file_id: 'LARGE' }] },
      },
    });
    const out = await sendToChat(f.api, '5', {
      text: 'Look',
      media: { kind: 'image', source: { url: 'https://x.test/a.png' } },
    });
    expect(out).toMatchObject({ ok: true, providerMessageId: '9', fileId: 'LARGE' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.args.slice(0, 4)).toEqual([
      '5',
      'image',
      { url: 'https://x.test/a.png' },
      'Look',
    ]);
  });

  it('a caption longer than 1024 sends the rest as a follow-up text; exactly 1024 does not', async () => {
    const text = 'a'.repeat(1500);
    const f = fake();
    await sendToChat(f.api, '5', { text, media: { kind: 'video', source: { fileId: 'F' } } });
    expect(f.calls.map((c) => c.method)).toEqual(['sendMedia', 'sendMessage']);
    expect(f.calls[1]!.args[1]).toBe(text.slice(CAPTION_LIMIT - 1));

    const g = fake();
    await sendToChat(g.api, '5', {
      text: 'a'.repeat(CAPTION_LIMIT),
      media: { kind: 'video', source: { fileId: 'F' } },
    });
    expect(g.calls).toHaveLength(1);
  });

  it('no caption when there is no text, and a failed media send adds no follow-up', async () => {
    const f = fake({ media: { ok: false, error: 'bad' } });
    const out = await sendToChat(f.api, '5', {
      text: '',
      media: { kind: 'document', source: { fileId: 'D' } },
    });
    expect(out.ok).toBe(false);
    expect(f.calls[0]!.args[3]).toBeNull();
    const g = fake({ media: { ok: false, error: 'bad' } });
    await sendToChat(g.api, '5', {
      text: 'a'.repeat(2000),
      media: { kind: 'document', source: { fileId: 'D' } },
    });
    expect(g.calls.map((c) => c.method)).toEqual(['sendMedia']);
  });
});

describe('the file id to reuse (WD-TG-013 rule 5)', () => {
  it('a photo takes the last (largest) size; other kinds take their own field; a missing one is null', () => {
    expect(
      fileIdFrom({ message_id: 1, photo: [{ file_id: 'a' }, { file_id: 'b' }] }, 'image'),
    ).toBe('b');
    expect(fileIdFrom({ message_id: 1, video: { file_id: 'v' } }, 'video')).toBe('v');
    expect(fileIdFrom({ message_id: 1, document: { file_id: 'd' } }, 'document')).toBe('d');
    expect(fileIdFrom({ message_id: 1, animation: { file_id: 'g' } }, 'animation')).toBe('g');
    expect(fileIdFrom({ message_id: 1 }, 'image')).toBeNull();
    expect(fileIdFrom({ message_id: 1, video: { file_id: '' } }, 'video')).toBeNull();
    expect(fileIdFrom(undefined, 'video')).toBeNull();
  });
});
