import { describe, expect, it } from 'vitest';
import {
  createChannelSchema,
  createSimulatorChannelSchema,
  simulatorInboundSchema,
  simulatorReceiptSchema,
  updateChannelSchema,
} from '@crm/contracts';

const creds = {
  phoneNumberId: '1234567890',
  accessToken: 'EAAB-token-12345',
  appSecret: 'sekret-12345',
};

describe('channel contracts', () => {
  it('createChannelSchema takes a WhatsApp Cloud channel with strict credentials', () => {
    expect(
      createChannelSchema.safeParse({ kind: 'whatsapp_cloud', name: ' Main ', credentials: creds })
        .success,
    ).toBe(true);
    expect(createChannelSchema.safeParse({ kind: 'simulator', name: 'x' }).success).toBe(false);
    expect(
      createChannelSchema.safeParse({
        kind: 'whatsapp_cloud',
        name: 'x',
        credentials: { ...creds, extra: 1 },
      }).success,
    ).toBe(false);
    expect(
      createChannelSchema.safeParse({ kind: 'whatsapp_cloud', name: '', credentials: creds })
        .success,
    ).toBe(false);
  });

  it('createSimulatorChannelSchema defaults the name and rejects unknown settings', () => {
    expect(createSimulatorChannelSchema.parse({}).name).toBe('Simulator');
    expect(createSimulatorChannelSchema.safeParse({ settings: { nope: 1 } }).success).toBe(false);
    expect(
      createSimulatorChannelSchema.safeParse({
        settings: { simulator: { latencyMs: { sent: 999999 } } },
      }).success,
    ).toBe(false);
  });

  it('updateChannelSchema needs the row version and at least one change; `error` cannot be set by a person', () => {
    expect(updateChannelSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(updateChannelSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateChannelSchema.safeParse({ rowVersion: 1, name: 'x' }).success).toBe(true);
    expect(updateChannelSchema.safeParse({ rowVersion: 1, status: 'error' }).success).toBe(false);
    expect(
      updateChannelSchema.safeParse({
        rowVersion: 1,
        credentials: { accessToken: 'EAAB-new-token-1' },
      }).success,
    ).toBe(true);
  });

  it('simulatorInboundSchema: digits for the number, and each kind needs its content', () => {
    expect(simulatorInboundSchema.safeParse({ from: '919876543210', text: 'hi' }).success).toBe(
      true,
    );
    expect(simulatorInboundSchema.safeParse({ from: '+91 98765', text: 'hi' }).success).toBe(false);
    expect(simulatorInboundSchema.safeParse({ from: '919876543210' }).success).toBe(false);
    expect(simulatorInboundSchema.safeParse({ from: '919876543210', text: '   ' }).success).toBe(
      false,
    );
    expect(simulatorInboundSchema.safeParse({ from: '919876543210', kind: 'media' }).success).toBe(
      false,
    );
    expect(
      simulatorInboundSchema.safeParse({
        from: '919876543210',
        kind: 'media',
        media: { mediaKind: 'image', mime: 'image/png' },
      }).success,
    ).toBe(true);
    expect(
      simulatorInboundSchema.safeParse({ from: '919876543210', kind: 'location' }).success,
    ).toBe(false);
    expect(
      simulatorInboundSchema.safeParse({
        from: '919876543210',
        kind: 'location',
        location: { latitude: 91, longitude: 0 },
      }).success,
    ).toBe(false);
  });

  it('simulatorReceiptSchema defaults the delay to 0 and caps it', () => {
    expect(simulatorReceiptSchema.parse({ providerMessageId: 'p', status: 'read' }).delayMs).toBe(
      0,
    );
    expect(
      simulatorReceiptSchema.safeParse({ providerMessageId: 'p', status: 'read', delayMs: 61000 })
        .success,
    ).toBe(false);
    expect(
      simulatorReceiptSchema.safeParse({ providerMessageId: 'p', status: 'queued' }).success,
    ).toBe(false);
  });
});
