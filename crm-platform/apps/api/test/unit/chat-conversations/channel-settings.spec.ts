import { describe, expect, it } from 'vitest';
import {
  mergeSettings,
  normalizeSettings,
} from '../../../src/modules/chat-conversations/channel-settings';

describe('normalizeSettings', () => {
  it('a provider channel is metered unless it says otherwise, and has no simulator block', () => {
    expect(normalizeSettings('whatsapp_cloud', {})).toEqual({ metered: true });
    expect(normalizeSettings('whatsapp_cloud', { metered: false })).toEqual({ metered: false });
    expect(normalizeSettings('whatsapp_cloud', null)).toEqual({ metered: true });
  });

  it('the simulator is never metered, whatever is stored, and gets the default latencies and an automatic window', () => {
    expect(normalizeSettings('simulator', { metered: true })).toEqual({
      metered: false,
      simulator: { latencyMs: { sent: 0, delivered: 1000, read: 3000 }, window: 'auto' },
    });
  });
});

describe('mergeSettings', () => {
  const current = normalizeSettings('simulator', {});

  it('merges the nested simulator block one level down and keeps what was not sent', () => {
    const merged = mergeSettings('simulator', current, {
      simulator: { latencyMs: { delivered: 50 }, window: 'closed' },
    });
    expect(merged.simulator).toEqual({
      latencyMs: { sent: 0, delivered: 50, read: 3000 },
      window: 'closed',
    });
  });

  it('cannot make the simulator metered', () => {
    expect(mergeSettings('simulator', current, { metered: true }).metered).toBe(false);
  });

  it('switches metering on a provider channel and ignores simulator settings there', () => {
    const wa = normalizeSettings('whatsapp_cloud', {});
    const merged = mergeSettings('whatsapp_cloud', wa, {
      metered: false,
      simulator: { window: 'open' },
    });
    expect(merged).toEqual({ metered: false });
  });

  it('no patch is the current settings, normalised', () => {
    expect(mergeSettings('whatsapp_cloud', { metered: false }, undefined)).toEqual({
      metered: false,
    });
  });
});
