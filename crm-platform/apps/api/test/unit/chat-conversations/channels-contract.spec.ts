import { describe, expect, it } from 'vitest';
import {
  createSimulatorChannelSchema,
  simulatorInboundSchema,
  simulatorReceiptSchema,
  updateChannelSchema,
} from '@crm/contracts';

describe('channel contracts', () => {
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
  });

  it('a channel holds no credentials of its own: WhatsApp numbers are connected in the WABA domain, so an update names none', () => {
    const parsed = updateChannelSchema.safeParse({
      rowVersion: 1,
      credentials: { accessToken: 'EAAB-new-token-1' },
    });
    // Unknown keys are dropped, and nothing is left to change.
    expect(parsed.success).toBe(false);
    expect(
      updateChannelSchema.parse({ rowVersion: 1, name: 'x', credentials: { accessToken: 't' } }),
    ).toEqual({ rowVersion: 1, name: 'x' });
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
