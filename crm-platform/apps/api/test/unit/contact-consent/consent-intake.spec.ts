import { describe, expect, it } from 'vitest';
import {
  hasProof,
  intakeEvidence,
  isSubscribedStatus,
  planIntakeGrants,
} from '../../../src/modules/contact-consent/consent-intake.rules';

/**
 * Consent at intake (spec privacy-and-data-governance 4.3.2). POLICY: a grant exists only because the person agreed; a subscription
 * status is a label, not proof; a first inbound message never reaches these rules.
 */
const both = { phone: true, email: true };

describe('isSubscribedStatus', () => {
  it('reads subscribed trimmed and case-insensitively, and nothing else', () => {
    expect(isSubscribedStatus('subscribed')).toBe(true);
    expect(isSubscribedStatus('  Subscribed ')).toBe(true);
    expect(isSubscribedStatus('unsubscribed')).toBe(false);
    expect(isSubscribedStatus('pending')).toBe(false);
    expect(isSubscribedStatus('')).toBe(false);
    expect(isSubscribedStatus(null)).toBe(false);
    expect(isSubscribedStatus(undefined)).toBe(false);
  });
});

describe('planIntakeGrants', () => {
  it('grants nothing for a write with no subscribed status and no proof', () => {
    const plan = planIntakeGrants({ given: {}, reachable: both });
    expect(plan).toEqual({ grant: [], fillStatus: [] });
  });

  it('grants nothing for statuses that are not subscribed', () => {
    const plan = planIntakeGrants({
      given: { whatsapp: 'pending', email: 'unsubscribed', sms: '' },
      reachable: both,
    });
    expect(plan.grant).toEqual([]);
  });

  it('grants each channel whose status is set to subscribed, in channel order', () => {
    const plan = planIntakeGrants({
      given: { email: 'subscribed', whatsapp: 'Subscribed' },
      reachable: both,
    });
    expect(plan.grant).toEqual(['whatsapp', 'email']);
    // The write sets the statuses itself: nothing to fill.
    expect(plan.fillStatus).toEqual([]);
  });

  it('does not treat a stored subscribed status that is sent again as a new agreement', () => {
    const plan = planIntakeGrants({
      given: { whatsapp: 'subscribed' },
      stored: { whatsapp: 'subscribed' },
      reachable: both,
    });
    expect(plan.grant).toEqual([]);
  });

  it('grants a channel that moves from another status to subscribed', () => {
    const plan = planIntakeGrants({
      given: { whatsapp: 'subscribed' },
      stored: { whatsapp: 'pending' },
      reachable: both,
    });
    expect(plan.grant).toEqual(['whatsapp']);
  });

  it('with a proof and no channels, grants the channels the contact can be reached on and fills their blank statuses', () => {
    const plan = planIntakeGrants({
      given: {},
      proof: { note: 'Signed at the expo stand' },
      reachable: both,
    });
    expect(plan.grant).toEqual(['whatsapp', 'email']);
    expect(plan.fillStatus).toEqual(['whatsapp', 'email']);
  });

  it('with a proof and only a phone, grants WhatsApp and never SMS', () => {
    const plan = planIntakeGrants({
      given: {},
      proof: { note: 'Said yes on the phone' },
      reachable: { phone: true, email: false },
    });
    expect(plan.grant).toEqual(['whatsapp']);
  });

  it('SMS is granted only when it is asked for', () => {
    const plan = planIntakeGrants({
      given: {},
      proof: { note: 'Ticked the SMS box', channels: ['sms'] },
      reachable: both,
    });
    expect(plan.grant).toEqual(['sms']);
    expect(plan.fillStatus).toEqual(['sms']);
  });

  it('does not overwrite a stored status when filling', () => {
    const plan = planIntakeGrants({
      given: {},
      stored: { whatsapp: 'pending' },
      proof: { note: 'Agreed by email' },
      reachable: { phone: true, email: false },
    });
    expect(plan.grant).toEqual(['whatsapp']);
    expect(plan.fillStatus).toEqual([]);
  });

  it('a proof on a contact with nothing to reach them on grants nothing', () => {
    const plan = planIntakeGrants({
      given: {},
      proof: { note: 'Agreed' },
      reachable: { phone: false, email: false },
    });
    expect(plan.grant).toEqual([]);
  });
});

describe('hasProof', () => {
  it('needs a note or the wording, not blanks', () => {
    expect(hasProof(undefined)).toBe(false);
    expect(hasProof({})).toBe(false);
    expect(hasProof({ note: '   ' })).toBe(false);
    expect(hasProof({ version: '3' })).toBe(false);
    expect(hasProof({ note: 'Said yes at the counter' })).toBe(true);
    expect(hasProof({ text: 'I agree to receive offers on WhatsApp.' })).toBe(true);
  });
});

describe('intakeEvidence', () => {
  it('keeps the wording cut to 300 characters, the hash of the whole text, the version and the extra keys', () => {
    const text = 'x'.repeat(500);
    const ev = intakeEvidence({ text, version: '4' }, { formId: 'f1', widgetId: undefined });
    expect(ev.consentText).toHaveLength(300);
    expect(ev.consentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.consentVersion).toBe('4');
    expect(ev.formId).toBe('f1');
    expect('widgetId' in ev).toBe(false);
  });

  it('has no text keys when there is no wording, and never an IP or a user agent', () => {
    const ev = intakeEvidence({ version: undefined }, { reference: 'google_sheets' });
    expect(ev).toEqual({ reference: 'google_sheets' });
  });
});
