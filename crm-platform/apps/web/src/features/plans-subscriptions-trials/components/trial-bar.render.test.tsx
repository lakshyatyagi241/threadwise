import { describe, expect, it } from 'vitest';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { BILLING_KEYS } from '../api';
import { CONNECT_PATH, TrialBar } from './trial-bar';

const trial = {
  state: 'free_trial',
  trialEndsAt: '2026-10-12T00:00:00.000Z',
  planEndsAt: null,
  daysLeft: 7,
  renewalWindow: false,
  planSlug: 'trial',
  planName: 'Trial',
  subscription: null,
};

for (const locale of ['en', 'ar'] as const) {
  describe(`trial bar (${locale})`, () => {
    const out = () => renderAccount(<TrialBar />, { locale, seed: [[BILLING_KEYS.status, trial]] });

    it('sends "Connect a channel" to the official WhatsApp connect flow, never to a QR device page', () => {
      expect(CONNECT_PATH).toBe('/channels/whatsapp');
      const html = out();
      expect(html).toContain('data-kind="trial"');
      expect(html).toContain('href="/channels/whatsapp"');
      expect(html).not.toContain('/devices');
    });

    it('still offers the plan purchase next to it', () => {
      expect(out()).toContain('href="/account/plans"');
    });
  });
}
