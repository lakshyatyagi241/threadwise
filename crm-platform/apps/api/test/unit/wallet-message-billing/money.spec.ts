import { describe, expect, it } from 'vitest';
import {
  adjustWalletSchema,
  isBillableStatus,
  isFailureStatus,
  majorToMicros,
  microsToMajor,
  microsToMinor,
  walletMajorToMinor,
  walletMinorToMajor,
  walletDeliveryReportedSchema,
} from '@crm/contracts';

describe('money text (no float ever carries an amount)', () => {
  it('parses plain amounts to hundredths and refuses the rest', () => {
    expect(walletMajorToMinor('12')).toBe(1200);
    expect(walletMajorToMinor('12.5')).toBe(1250);
    expect(walletMajorToMinor('12.50')).toBe(1250);
    expect(walletMajorToMinor('0.01')).toBe(1);
    expect(walletMajorToMinor('12.505')).toBeNull();
    expect(walletMajorToMinor('-1')).toBeNull();
    expect(walletMajorToMinor('1e3')).toBeNull();
    expect(walletMajorToMinor('')).toBeNull();
    expect(walletMajorToMinor('0.1')).toBe(10);
  });

  it('formats hundredths', () => {
    expect(walletMinorToMajor(1250)).toBe('12.50');
    expect(walletMinorToMajor(7)).toBe('0.07');
  });

  it('keeps Meta cost to 6 decimals: 0.004 is not rounded to 0', () => {
    expect(majorToMicros('0.004')).toBe(4_000);
    expect(majorToMicros('0.025')).toBe(25_000);
    expect(majorToMicros('0.0000001')).toBeNull();
    expect(microsToMajor(25_000)).toBe('0.025');
    expect(microsToMajor(4_000)).toBe('0.004');
    expect(microsToMajor(1_000_000)).toBe('1.00');
    expect(microsToMinor(25_000)).toBe(3);
    expect(microsToMinor(4_000)).toBe(0);
  });
});

describe('adjustWalletSchema: the note is mandatory', () => {
  const ok = {
    direction: 'credit',
    amount: '250.00',
    note: 'Goodwill for the March outage',
  } as const;

  it('accepts a complete adjustment', () => {
    expect(adjustWalletSchema.safeParse(ok).success).toBe(true);
  });

  it('refuses a missing, blank or too short note', () => {
    expect(adjustWalletSchema.safeParse({ ...ok, note: undefined }).success).toBe(false);
    expect(adjustWalletSchema.safeParse({ ...ok, note: '' }).success).toBe(false);
    expect(adjustWalletSchema.safeParse({ ...ok, note: '    ' }).success).toBe(false);
    expect(adjustWalletSchema.safeParse({ ...ok, note: 'oops' }).success).toBe(false);
    expect(adjustWalletSchema.safeParse({ ...ok, note: 'x'.repeat(501) }).success).toBe(false);
  });

  it('refuses a zero, negative or over-precise amount', () => {
    for (const amount of ['0', '0.00', '-5', '1.234', 'abc', '']) {
      expect(adjustWalletSchema.safeParse({ ...ok, amount }).success, amount).toBe(false);
    }
  });
});

describe('which delivery reports charge (WD-WALLET-012)', () => {
  it('WABA and Twilio charge on delivered or read, not on sent', () => {
    expect(isBillableStatus('waba', 'delivered')).toBe(true);
    expect(isBillableStatus('waba', 'read')).toBe(true);
    expect(isBillableStatus('waba', 'sent')).toBe(false);
    expect(isBillableStatus('twilio', 'sent')).toBe(false);
  });

  it('Baileys cannot report delivery reliably, so sent charges too', () => {
    expect(isBillableStatus('baileys', 'sent')).toBe(true);
  });

  it('failed and undelivered are failures, and never billable', () => {
    expect(isFailureStatus('failed')).toBe(true);
    expect(isFailureStatus('undelivered')).toBe(true);
    expect(isBillableStatus('waba', 'failed')).toBe(false);
  });

  it('validates the event payload', () => {
    expect(
      walletDeliveryReportedSchema.safeParse({
        provider: 'waba',
        providerMessageId: 'wamid.1',
        status: 'delivered',
        recipient: '+14155550100',
      }).success,
    ).toBe(true);
    expect(
      walletDeliveryReportedSchema.safeParse({
        provider: 'sms',
        providerMessageId: 'x',
        status: 'delivered',
      }).success,
    ).toBe(false);
    expect(
      walletDeliveryReportedSchema.safeParse({
        provider: 'waba',
        providerMessageId: ' ',
        status: 'delivered',
      }).success,
    ).toBe(false);
  });
});
