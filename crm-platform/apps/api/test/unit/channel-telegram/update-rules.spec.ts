import { describe, expect, it } from 'vitest';
import {
  chatTitle,
  extract,
  paymentOf,
  pickMessage,
  preview,
  quickReplyLabel,
  senderUid,
  serviceText,
  threadKey,
  updateKind,
} from '../../../src/modules/channel-telegram/update-rules';

describe('which kind of update (WD-TG-003)', () => {
  it('a payment step wins over a tap, a tap over a quiet kind, and a message comes last', () => {
    expect(updateKind({ pre_checkout_query: { id: '1' }, callback_query: { id: '2' } })).toBe(
      'pre_checkout_query',
    );
    expect(updateKind({ callback_query: { id: '2' }, message: { text: 'x' } })).toBe(
      'callback_query',
    );
    expect(updateKind({ chat_join_request: { chat: {} } })).toBe('chat_join_request');
    expect(updateKind({ poll_answer: { poll_id: 'p' } })).toBe('poll_answer');
    expect(updateKind({ message: { text: 'hi' } })).toBe('message');
    expect(updateKind({ channel_post: { text: 'hi' } })).toBe('message');
  });

  it('an update with nothing usable is none; empty objects do not count', () => {
    expect(updateKind({})).toBe('none');
    expect(updateKind({ message: {}, callback_query: {} })).toBe('none');
    expect(updateKind({ update_id: 5 })).toBe('none');
  });

  it('the message is the first of message, channel_post, edited_message, edited_channel_post', () => {
    expect(pickMessage({ edited_message: { text: 'e' }, channel_post: { text: 'c' } })).toEqual({
      text: 'c',
    });
    expect(pickMessage({})).toBeNull();
  });

  it('only tqr: taps carry a label to replay', () => {
    expect(quickReplyLabel('tqr:Yes please')).toBe('Yes please');
    expect(quickReplyLabel('tqr:')).toBe('');
    expect(quickReplyLabel('other')).toBeNull();
  });
});

describe('text and media of a message (WD-TG-004)', () => {
  it('a photo takes the largest size and the caption', () => {
    expect(extract({ photo: [{ file_id: 's' }, { file_id: 'L' }], caption: 'Look' })).toEqual({
      text: 'Look',
      mediaType: 'image',
      fileId: 'L',
    });
  });

  it('video, voice, audio, animation (as video) and document carry their file id and caption', () => {
    expect(extract({ video: { file_id: 'v' }, caption: 'c' })).toEqual({
      text: 'c',
      mediaType: 'video',
      fileId: 'v',
    });
    expect(extract({ voice: { file_id: 'a' } })).toEqual({
      text: '',
      mediaType: 'voice',
      fileId: 'a',
    });
    expect(extract({ audio: { file_id: 'a2' } }).mediaType).toBe('audio');
    expect(extract({ animation: { file_id: 'g' } }).mediaType).toBe('video');
    expect(extract({ document: { file_id: 'd' } }).mediaType).toBe('document');
  });

  it('a sticker is its emoji as an image; a place and a contact card are text lines', () => {
    expect(extract({ sticker: { file_id: 'st', emoji: '😀' } })).toEqual({
      text: '😀',
      mediaType: 'image',
      fileId: 'st',
    });
    expect(extract({ location: { latitude: 12.97, longitude: 77.59 } }).text).toBe(
      '📍 12.97, 77.59',
    );
    expect(extract({ contact: { first_name: 'Asha', phone_number: '+91 98' } }).text).toBe(
      '👤 Asha +91 98',
    );
    expect(extract({ location: { latitude: 0, longitude: 0 } }).text).toBe('📍 0, 0');
  });

  it('plain text, else a service line, else a placeholder', () => {
    expect(extract({ text: 'hello' }).text).toBe('hello');
    expect(extract({ new_chat_members: [{}] }).text).toBe('👋 New member joined');
    expect(serviceText({ left_chat_member: {} })).toBe('👋 Member left');
    expect(serviceText({ new_chat_title: 'x' })).toBe('⚙️ Group updated');
    expect(extract({}).text).toBe('[message]');
  });
});

describe('thread and sender', () => {
  it('the title falls back chat title, chat username, sender username, names, Telegram', () => {
    expect(chatTitle({ chat: { title: 'Team' } })).toBe('Team');
    expect(chatTitle({ chat: { username: 'shop' } })).toBe('shop');
    expect(chatTitle({ from: { username: 'asha' }, chat: {} })).toBe('asha');
    expect(chatTitle({ chat: { first_name: 'Asha', last_name: 'Rao' } })).toBe('Asha Rao');
    expect(chatTitle({})).toBe('Telegram');
  });

  it('the thread key carries the bot, the sender falls back to the chat, the preview is 120 characters', () => {
    expect(threadKey(7, '-100123')).toBe('tg:7:-100123');
    expect(senderUid({ from: { id: 55 }, chat: { id: 9 } })).toBe('55');
    expect(senderUid({ chat: { id: -100 } })).toBe('-100');
    expect(preview('x'.repeat(200))).toHaveLength(120);
  });
});

describe('a successful payment (WD-TG-006)', () => {
  const m = (currency: string, total: number) => ({
    successful_payment: {
      currency,
      total_amount: total,
      invoice_payload: 'inv1',
      telegram_payment_charge_id: 't1',
      provider_payment_charge_id: 'p1',
    },
  });

  it('divides by 100 with two decimals for most currencies', () => {
    expect(paymentOf(m('usd', 4999))).toMatchObject({
      currency: 'USD',
      amountDisplay: '49.99',
      body: 'Payment received: USD 49.99',
      invoicePayload: 'inv1',
    });
    expect(paymentOf(m('USD', 5))?.amountDisplay).toBe('0.05');
  });

  it('shows zero-decimal currencies whole', () => {
    for (const c of ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'RWF', 'XOF', 'XAF', 'IDR']) {
      expect(paymentOf(m(c, 500))?.amountDisplay, c).toBe('500');
    }
    expect(paymentOf(m('JPY', 500))?.body).toBe('Payment received: JPY 500');
  });

  it('a message without a payment, or with a bad total, is handled', () => {
    expect(paymentOf({ text: 'x' })).toBeNull();
    expect(paymentOf(m('EUR', Number.NaN))?.amountDisplay).toBe('0.00');
  });
});
