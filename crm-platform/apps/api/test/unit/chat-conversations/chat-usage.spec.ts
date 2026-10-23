import { describe, expect, it } from 'vitest';
import { walletUsageReportedSchema } from '@crm/contracts';
import {
  chatUsageId,
  chatUsageReport,
  usageKindOfChannel,
  usageRecipientOf,
} from '../../../src/modules/chat-conversations/chat-usage';

/** What the platform's per-message fee is charged on: email and the chat channels, never WhatsApp, the simulator or a personal number. */
describe('usageKindOfChannel', () => {
  it('bills email as an email and the third-party chat channels as a chat message', () => {
    expect(usageKindOfChannel('email')).toBe('email');
    for (const kind of ['telegram', 'facebook', 'instagram', 'line', 'viber', 'wechat']) {
      expect(usageKindOfChannel(kind), kind).toBe('chat_message');
    }
  });

  it('bills nothing on the simulator, a personal number, the web widget, WhatsApp Cloud or a kind it does not know', () => {
    for (const kind of ['simulator', 'whatsapp_qr', 'webchat', 'whatsapp_cloud', 'sms', '']) {
      expect(usageKindOfChannel(kind), kind).toBeNull();
    }
  });
});

describe('chatUsageId', () => {
  it('is the provider message id as it is', () => {
    expect(chatUsageId({ channelKind: 'email', providerMessageId: ' 18c3f0a ' })).toBe('18c3f0a');
    expect(chatUsageId({ channelKind: 'viber', providerMessageId: 'tok:u1', scope: '4' })).toBe(
      'tok:u1',
    );
  });

  it('keeps two Telegram bots apart: a message id is only unique inside one chat of one bot', () => {
    const a = chatUsageId({ channelKind: 'telegram', providerMessageId: '111:5', scope: '1' });
    const b = chatUsageId({ channelKind: 'telegram', providerMessageId: '111:5', scope: '2' });
    expect(a).not.toBe(b);
    expect(a).toBe('tg1:111:5');
  });
});

describe('usageRecipientOf', () => {
  it('names a number only for a channel whose peer is a phone number, never a handle, an address or a group', () => {
    expect(usageRecipientOf('whatsapp_cloud', '919876543210')).toBe('919876543210');
    expect(usageRecipientOf('whatsapp_cloud', 'g:abc')).toBeNull();
    // A Telegram chat id is all digits, but it is not a number to dial: it must not give the charge a country.
    expect(usageRecipientOf('telegram', '123456789')).toBeNull();
    expect(usageRecipientOf('email', 't:thread-1')).toBeNull();
    expect(usageRecipientOf('viber', 'AbCd1234==')).toBeNull();
  });
});

describe('chatUsageReport', () => {
  const sent = {
    channelKind: 'email',
    providerMessageId: 'gmail-1',
    status: 'used' as const,
    peerKey: 't:abc',
    source: 'inbox',
  };

  it('is one unit of the right kind, on the provider id, with the channel as its provider', () => {
    const r = chatUsageReport(sent);
    expect(r).toMatchObject({
      kind: 'email',
      usageId: 'gmail-1',
      status: 'used',
      units: 1,
      recipient: null,
      source: 'inbox',
      provider: 'email',
    });
    // It must be something the billing consumer accepts, or the charge is silently dropped.
    expect(walletUsageReportedSchema.safeParse(r).success).toBe(true);
    const chat = chatUsageReport({ ...sent, channelKind: 'line', peerKey: 'U123', source: 'flow' });
    expect(chat).toMatchObject({ kind: 'chat_message', provider: 'line', recipient: null });
    expect(walletUsageReportedSchema.safeParse(chat).success).toBe(true);
  });

  it('a failed report is the same id, so it finds the charge it refunds', () => {
    const used = chatUsageReport({ ...sent, channelKind: 'viber', providerMessageId: 'tok:u1' });
    const failed = chatUsageReport({
      ...sent,
      channelKind: 'viber',
      providerMessageId: 'tok:u1',
      status: 'failed',
    });
    expect(failed?.usageId).toBe(used?.usageId);
    expect(failed?.status).toBe('failed');
  });

  it('carries the broadcast name when there is one', () => {
    expect(chatUsageReport({ ...sent, subjectName: 'Diwali offer' })?.subjectName).toBe(
      'Diwali offer',
    );
    expect(chatUsageReport(sent)).not.toHaveProperty('subjectName');
  });

  it('reports nothing for an unbilled channel, a reaction, or a message the provider gave no id', () => {
    expect(chatUsageReport({ ...sent, channelKind: 'simulator' })).toBeNull();
    expect(chatUsageReport({ ...sent, channelKind: 'whatsapp_qr' })).toBeNull();
    expect(
      chatUsageReport({ ...sent, channelKind: 'telegram', messageKind: 'reaction' }),
    ).toBeNull();
    expect(chatUsageReport({ ...sent, providerMessageId: null })).toBeNull();
    expect(chatUsageReport({ ...sent, providerMessageId: '  ' })).toBeNull();
  });
});
