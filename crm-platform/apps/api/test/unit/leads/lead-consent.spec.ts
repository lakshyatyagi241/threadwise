import { describe, expect, it } from 'vitest';
import { isYes, leadConsentFromBody, planLeadGrant } from '../../../src/modules/leads/lead-consent';

/**
 * Consent that rides with a lead (BL-168, privacy spec 4.3.2). POLICY: a lead is not consent. Nothing is granted unless the sender says
 * the person agreed AND names something a person can read later (wording, version, form or ad).
 */
const both = { phone: true, email: true };

describe('isYes', () => {
  it('reads real yes words and booleans, and nothing else', () => {
    for (const v of [true, 1, 'true', 'Yes', 'y', '1', 'accepted', 'ja', 'oui', ' Agreed ']) {
      expect(isYes(v), String(v)).toBe(true);
    }
    for (const v of [false, 0, 2, 'false', 'no', '0', '', 'maybe', null, undefined, {}, []]) {
      expect(isYes(v), String(v)).toBe(false);
    }
  });
});

describe('leadConsentFromBody', () => {
  it('returns nothing for a body with no consent: a lead without proof behaves exactly as before', () => {
    expect(leadConsentFromBody({ name: 'A', phone: '+919876543210' })).toBeUndefined();
    expect(leadConsentFromBody(null)).toBeUndefined();
    expect(leadConsentFromBody([])).toBeUndefined();
    expect(leadConsentFromBody('consent')).toBeUndefined();
  });

  it('reads the nested consent object, whatever the key spelling', () => {
    const c = leadConsentFromBody({
      lead: { consent: { given: true } },
      consent: {
        Given: 'yes',
        text: 'I agree to hear about offers.',
        version: 'v3',
        at: '2026-10-01T08:00:00+05:30',
        form_id: 'F-77',
        adId: 'AD-1',
        channels: ['whatsapp', 'sms', 'fax'],
      },
    });
    expect(c).toEqual({
      given: true,
      text: 'I agree to hear about offers.',
      version: 'v3',
      at: '2026-10-01T02:30:00.000Z',
      formId: 'F-77',
      adId: 'AD-1',
      channels: ['whatsapp', 'sms'],
    });
  });

  it('reads flat consent_* keys (a form post or a Zapier step)', () => {
    const c = leadConsentFromBody({
      name: 'A',
      consent_given: 'true',
      'consent-text': 'Wording',
      consentVersion: '2',
      consent_form_id: 'f1',
      consent_channels: 'whatsapp, email',
    });
    expect(c).toEqual({
      given: true,
      text: 'Wording',
      version: '2',
      formId: 'f1',
      channels: ['whatsapp', 'email'],
    });
  });

  it('a consent that is not a yes is returned as given=false, and a bad date or oversize text is bounded', () => {
    expect(leadConsentFromBody({ consent: { given: 'no', text: 'x' } })?.given).toBe(false);
    expect(leadConsentFromBody({ consent: { given: 'maybe' } })?.given).toBe(false);
    const c = leadConsentFromBody({
      consent: { given: true, text: 'x'.repeat(5000), version: 'v'.repeat(200), at: 'not a date' },
    })!;
    expect(c.text).toHaveLength(2000);
    expect(c.version).toHaveLength(64);
    expect(c.at).toBeUndefined();
  });

  it('does not look for a field called consent inside the payload', () => {
    expect(leadConsentFromBody({ lead: { consent: { given: true, text: 'x' } } })).toBeUndefined();
  });
});

describe('planLeadGrant', () => {
  it('grants nothing without proof, with a no, or with a bare yes', () => {
    expect(planLeadGrant(undefined, both)).toBeNull();
    expect(planLeadGrant({ given: false, text: 'T' }, both)).toBeNull();
    expect(planLeadGrant({ given: true }, both)).toBeNull();
  });

  it('a yes with readable evidence grants the reachable channels, never sms unless named', () => {
    const p = planLeadGrant(
      {
        given: true,
        text: 'T',
        version: '2',
        at: '2026-10-01T00:00:00.000Z',
        formId: 'F',
        adId: 'A',
      },
      both,
    )!;
    expect(p.proof).toEqual({
      channels: ['whatsapp', 'email'],
      text: 'T',
      version: '2',
      at: '2026-10-01T00:00:00.000Z',
    });
    expect(p.evidence).toEqual({ leadFormId: 'F', adId: 'A' });
    expect(
      planLeadGrant({ given: true, formId: 'F' }, { phone: true, email: false })!.proof.channels,
    ).toEqual(['whatsapp']);
    expect(
      planLeadGrant({ given: true, formId: 'F' }, { phone: false, email: true })!.proof.channels,
    ).toEqual(['email']);
  });

  it('named channels are honoured when the lead can be reached on them', () => {
    expect(
      planLeadGrant({ given: true, text: 'T', channels: ['sms'] }, both)!.proof.channels,
    ).toEqual(['sms']);
    expect(
      planLeadGrant(
        { given: true, text: 'T', channels: ['sms', 'email'] },
        { phone: false, email: true },
      )!.proof.channels,
    ).toEqual(['email']);
    expect(
      planLeadGrant({ given: true, text: 'T', channels: ['sms'] }, { phone: false, email: true }),
    ).toBeNull();
    expect(planLeadGrant({ given: true, text: 'T' }, { phone: false, email: false })).toBeNull();
  });
});
