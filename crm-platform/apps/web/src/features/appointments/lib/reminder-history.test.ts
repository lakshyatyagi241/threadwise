import { describe, expect, it } from 'vitest';
import type { AppointmentReminder } from '../api/schemas';
import { attemptsToShow, deliveryToShow, fallbackChannel } from './reminder-history';

const attempt = (
  channel: 'whatsapp' | 'email',
  status: 'sent' | 'skipped' | 'held' | 'failed',
  reason: string | null = null,
) => ({ channel, status, reason });

describe('the channels a reminder tried', () => {
  it('lists nothing for a step that went by its only channel', () => {
    expect(attemptsToShow({ attempts: [attempt('whatsapp', 'sent')] })).toEqual([]);
    expect(attemptsToShow({ attempts: [] })).toEqual([]);
  });
  it('lists a single channel that did not send, and every channel of a fallback', () => {
    const one = [attempt('whatsapp', 'skipped', 'no_consent')];
    expect(attemptsToShow({ attempts: one })).toEqual(one);
    const two = [attempt('whatsapp', 'skipped', 'template_unavailable'), attempt('email', 'sent')];
    expect(attemptsToShow({ attempts: two })).toEqual(two);
  });
});

describe('the fallback', () => {
  it('names the channel a sent step fell back to', () => {
    expect(
      fallbackChannel({
        status: 'sent',
        attempts: [attempt('whatsapp', 'failed', 'send_failed'), attempt('email', 'sent')],
      }),
    ).toBe('email');
  });
  it('is null when the first channel sent, or nothing was sent', () => {
    expect(fallbackChannel({ status: 'sent', attempts: [attempt('whatsapp', 'sent')] })).toBeNull();
    expect(
      fallbackChannel({
        status: 'skipped',
        attempts: [attempt('whatsapp', 'skipped'), attempt('email', 'skipped')],
      }),
    ).toBeNull();
  });
});

describe('the delivery line', () => {
  const base: Pick<AppointmentReminder, 'status' | 'channel' | 'delivery'> = {
    status: 'sent',
    channel: 'whatsapp',
    delivery: 'delivered',
  };
  it('is shown for a sent WhatsApp message whose delivery is known', () => {
    expect(deliveryToShow(base)).toBe('delivered');
    expect(deliveryToShow({ ...base, delivery: 'undelivered' })).toBe('undelivered');
    expect(deliveryToShow({ ...base, delivery: 'failed' })).toBe('failed');
  });
  it('is not shown while unknown, for email, or when nothing was sent', () => {
    expect(deliveryToShow({ ...base, delivery: 'unknown' })).toBeNull();
    expect(deliveryToShow({ ...base, channel: 'email' })).toBeNull();
    expect(deliveryToShow({ ...base, status: 'skipped' })).toBeNull();
  });
});
