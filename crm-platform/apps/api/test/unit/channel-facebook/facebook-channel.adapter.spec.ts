import { describe, expect, it, vi } from 'vitest';
import type { OutboundEnvelope } from '../../../src/infra/providers/chat-conversations';
import type { ChannelRuntime } from '../../../src/infra/providers/chat-conversations';
import { FacebookChannelAdapter } from '../../../src/modules/channel-facebook/facebook-channel.adapter';
import {
  PAGE_NOT_CONNECTED,
  type SenderService,
} from '../../../src/modules/channel-facebook/sender.service';

const channel: ChannelRuntime = {
  orgId: 1,
  uuid: '44444444-4444-4444-8444-444444444444',
  kind: 'facebook',
  status: 'connected',
  externalId: '100',
  displayAddress: null,
  settings: { metered: false },
  capabilityOverrides: {},
  credentials: {},
};
const text = (body = 'hi'): OutboundEnvelope => ({
  kind: 'text',
  to: 'fb:100:200',
  clientReference: 'ref-1',
  attempt: 1,
  body,
});

const adapterWith = (reply: ReturnType<typeof vi.fn>) =>
  new FacebookChannelAdapter({ reply } as unknown as SenderService);

describe('FacebookChannelAdapter', () => {
  it('keeps Meta’s 24 hour window and has no templates', () => {
    const a = adapterWith(vi.fn());
    expect(a.capabilities()).toMatchObject({ windowHours: 24, templates: false });
    const now = new Date('2026-10-03T12:00:00Z');
    const last = new Date('2026-10-02T11:00:00Z');
    expect(a.windowInfo(channel, last, now).open).toBe(false);
  });

  it('sends a text reply to the thread key and returns Meta’s message id', async () => {
    const reply = vi.fn().mockResolvedValue({ ok: true, providerMessageId: 'm_1', error: null });
    const out = await adapterWith(reply).send(channel, text());
    expect(reply).toHaveBeenCalledWith(1, { rawJid: 'fb:100:200', text: 'hi' });
    expect(out.providerMessageId).toBe('m_1');
  });

  it('turns a disconnected Page into CHANNEL_DISCONNECTED and any other refusal into a failed send', async () => {
    const gone = adapterWith(
      vi.fn().mockResolvedValue({ ok: false, providerMessageId: null, error: PAGE_NOT_CONNECTED }),
    );
    await expect(gone.send(channel, text())).rejects.toMatchObject({
      code: 'CHANNEL_DISCONNECTED',
    });
    const refused = adapterWith(
      vi.fn().mockResolvedValue({ ok: false, providerMessageId: null, error: 'nope' }),
    );
    await expect(refused.send(channel, text())).rejects.toMatchObject({
      code: 'FACEBOOK_SEND_REJECTED',
      retryable: false,
    });
  });

  it('refuses what Messenger cannot carry, and a file with no public link', async () => {
    const a = adapterWith(vi.fn());
    const location: OutboundEnvelope = {
      kind: 'location',
      to: 'fb:100:200',
      clientReference: 'r',
      attempt: 1,
      location: { latitude: 1, longitude: 2 },
    };
    await expect(a.send(channel, location)).rejects.toMatchObject({
      code: 'CHANNEL_CAPABILITY_UNSUPPORTED',
    });
    const media: OutboundEnvelope = {
      kind: 'media',
      to: 'fb:100:200',
      clientReference: 'r',
      attempt: 1,
      media: { key: 'chat/1/a.png', mediaKind: 'image', mime: 'image/png' },
    };
    await expect(a.send(channel, media)).rejects.toMatchObject({ code: 'MEDIA_NOT_REACHABLE' });
  });
});
