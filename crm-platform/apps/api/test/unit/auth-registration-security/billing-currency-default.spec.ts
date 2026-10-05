import { describe, expect, it } from 'vitest';
import { defaultBillingCurrency, onboardingWorkspaceRequestSchema } from '@crm/contracts';

const both = ['INR', 'USD'];

describe('the billing currency a country starts with', () => {
  it('is INR for India and USD for everywhere else', () => {
    expect(defaultBillingCurrency('IN', both, 'USD')).toBe('INR');
    expect(defaultBillingCurrency('in', both, 'USD')).toBe('INR');
    expect(defaultBillingCurrency(' IN ', both, 'USD')).toBe('INR');
    for (const country of ['US', 'GB', 'AE', 'SG', 'BR', 'DE'])
      expect(defaultBillingCurrency(country, both, 'USD')).toBe('USD');
  });

  it('is USD when no country is known', () => {
    expect(defaultBillingCurrency(null, both, 'USD')).toBe('USD');
    expect(defaultBillingCurrency(undefined, both, 'USD')).toBe('USD');
    expect(defaultBillingCurrency('', both, 'USD')).toBe('USD');
  });

  it('falls back to the platform currency when the default cannot be billed', () => {
    // no INR card stored yet: an Indian workspace is billed in the platform currency, as the wallet would
    expect(defaultBillingCurrency('IN', ['USD'], 'USD')).toBe('USD');
    // a platform billed in rupees, with no dollar card
    expect(defaultBillingCurrency('US', ['INR'], 'INR')).toBe('INR');
  });
});

describe('the onboarding workspace request', () => {
  const base = { name: 'Acme', timezone: 'Asia/Kolkata' };

  it('upper-cases the country and the currency and keeps both optional', () => {
    expect(onboardingWorkspaceRequestSchema.parse(base)).not.toHaveProperty('country');
    expect(
      onboardingWorkspaceRequestSchema.parse({ ...base, country: ' in', currency: 'inr' }),
    ).toMatchObject({ country: 'IN', currency: 'INR' });
  });

  it('refuses a country that is not two letters and a currency that is not three', () => {
    expect(onboardingWorkspaceRequestSchema.safeParse({ ...base, country: 'IND' }).success).toBe(
      false,
    );
    expect(onboardingWorkspaceRequestSchema.safeParse({ ...base, currency: 'RS' }).success).toBe(
      false,
    );
  });
});
