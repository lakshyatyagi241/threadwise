import { describe, expect, it } from 'vitest';
import {
  WebchatChannelAdapter,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations';

const adapter = new WebchatChannelAdapter();
const channel: ChannelRuntime = {
  orgId: 1,
  uuid: '44444444-4444-4444-8444-444444444444',
  kind: 'webchat',
  status: 'connected',
  externalId: '55555555-5555-4555-8555-555555555555',
  displayAddress: null,
  settings: { metered: true },
  capabilityOverrides: {},
  credentials: {},
};

describe('WebchatChannelAdapter', () => {
  it('has no 24 hour rule and no templates: a visitor on the page is there now', () => {
    expect(adapter.capabilities()).toMatchObject({ windowHours: null, templates: false });
    expect(adapter.windowInfo(channel, null, new Date())).toEqual({ open: true, expiresAt: null });
  });

  it('has no public provider webhook, takes no credentials and is not connected by hand', () => {
    expect(adapter.publicWebhook).toBe(false);
    expect(adapter.credentialsSchema).toBeNull();
    expect(adapter.verifyInbound()).toBe(false);
    expect(adapter.parseInbound()).toEqual({ messages: [], receipts: [] });
    expect(adapter.live).toBe(false);
  });

  it("accepts a reply without a provider: the thread keeps it and the visitor's poll shows it", async () => {
    const sent = await adapter.send(channel, {
      kind: 'text',
      to: 'v',
      clientReference: 'flow:run:1:0',
      attempt: 1,
      body: 'hello',
    });
    expect(sent.providerMessageId).toBe('web:flow:run:1:0');
    expect(sent.acceptedAt).toBeInstanceOf(Date);
  });
});
