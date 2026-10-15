import { describe, expect, it } from 'vitest';
import {
  CONSENT_GATE_REASONS,
  PURPOSES,
  PURPOSE_IDS,
  PURPOSE_REGISTRY,
  consentChannelOfKind,
  resolvePurposeId,
  validatePurposeRegistry,
  type ConsentGateReason,
} from '@crm/contracts';
import {
  NO_FACTS,
  decideConsent,
  failureResult,
  messagePurpose,
  type ConsentFacts,
  type DecideInput,
} from '../../../src/modules/contact-consent/consent-gate.rules';

const facts = (f: Partial<ConsentFacts> = {}): ConsentFacts => ({ ...NO_FACTS, ...f });
const decide = (i: Partial<DecideInput> & Pick<DecideInput, 'purpose'>) =>
  decideConsent({ channel: 'whatsapp', requireConsent: false, facts: facts(), ...i });

describe('the purpose registry', () => {
  it('is valid and keeps the two ledger values valid', () => {
    expect(() => validatePurposeRegistry()).not.toThrow();
    expect(PURPOSES.map((p) => p.id)).toEqual([...PURPOSE_IDS]);
    expect(resolvePurposeId('marketing')).toBe('marketing_messaging');
    expect(resolvePurposeId('utility')).toBe('service_messaging');
    expect(PURPOSE_REGISTRY.marketing_messaging.ledgerPurpose).toBe('marketing');
    expect(PURPOSE_REGISTRY.service_messaging.ledgerPurpose).toBe('utility');
  });

  it('refuses a broken entry', () => {
    const broken = {
      ...PURPOSE_REGISTRY,
      call_recording: { ...PURPOSE_REGISTRY.call_recording, noticeKey: null },
    };
    expect(() => validatePurposeRegistry(broken)).toThrow(/notice required/);
  });

  it('maps the new channels', () => {
    expect(consentChannelOfKind('voice')).toBe('voice');
    expect(consentChannelOfKind('call')).toBe('voice');
    expect(consentChannelOfKind('rcs')).toBe('rcs');
    expect(consentChannelOfKind('whatsapp_qr')).toBe('whatsapp');
    expect(consentChannelOfKind('carrier_pigeon')).toBeNull();
  });
});

describe('ConsentGate truth table', () => {
  // marketing, switch OFF (today's behaviour)
  it('marketing, switch off: everyone but a withdrawn contact is allowed', () => {
    expect(decide({ purpose: 'marketing' })).toEqual({ decision: 'allow', reason: 'policy_off' });
    expect(
      decide({ purpose: 'marketing_messaging', facts: facts({ ledgerState: 'granted' }) }),
    ).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
  });
  it('marketing: the roll-up flag alone is a withdrawal, on any channel and whatever the switch says', () => {
    for (const requireConsent of [false, true]) {
      expect(
        decide({ purpose: 'marketing', requireConsent, facts: facts({ unsubscribedFlag: true }) }),
      ).toEqual({ decision: 'deny', reason: 'withdrawn' });
    }
  });
  it('marketing: a ledger withdrawal denies even when the flag was cleared', () => {
    expect(decide({ purpose: 'marketing', facts: facts({ ledgerState: 'withdrawn' }) })).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
  });
  // marketing, switch ON
  it('marketing, switch on: a grant is needed', () => {
    expect(decide({ purpose: 'marketing', requireConsent: true })).toEqual({
      decision: 'deny',
      reason: 'no_consent_recorded',
    });
    expect(
      decide({
        purpose: 'marketing',
        requireConsent: true,
        facts: facts({ ledgerState: 'granted' }),
      }),
    ).toEqual({ decision: 'allow', reason: 'granted' });
  });
  it('marketing, switch on, channel without a consent mapping: denied as unmapped; switch off: allowed', () => {
    expect(
      decide({ purpose: 'marketing', channel: 'carrier_pigeon', requireConsent: true }),
    ).toEqual({
      decision: 'deny',
      reason: 'channel_unmapped',
    });
    expect(decide({ purpose: 'marketing', channel: 'carrier_pigeon' })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
    // The flag still applies on an unmapped channel.
    expect(
      decide({
        purpose: 'marketing',
        channel: 'carrier_pigeon',
        facts: facts({ unsubscribedFlag: true }),
      }),
    ).toEqual({ decision: 'deny', reason: 'withdrawn' });
  });
  // service
  it('STOP (marketing withdrawn) does not block service messages', () => {
    const stopped = facts({ unsubscribedFlag: true });
    expect(decide({ purpose: 'service_messaging', facts: stopped })).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
    expect(decide({ purpose: 'utility', facts: stopped, requireConsent: true })).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
  });
  it('a reply inside the window is always allowed, even after the service purpose was withdrawn', () => {
    expect(
      decide({
        purpose: 'service_messaging',
        replyWindowOpen: true,
        facts: facts({ ledgerState: 'withdrawn' }),
      }),
    ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
  });
  it('a withdrawn service purpose blocks a business-initiated service message', () => {
    expect(
      decide({ purpose: 'service_messaging', facts: facts({ ledgerState: 'withdrawn' }) }),
    ).toEqual({
      decision: 'deny',
      reason: 'withdrawn',
    });
  });
  // other purposes
  it('purposes with a notice to deliver answer needs_notice', () => {
    for (const purpose of ['call_recording', 'voice_ai_conversation'] as const) {
      const r = decide({ purpose, channel: 'voice', modality: 'voice' });
      expect(r.decision).toBe('needs_notice');
      expect(r.reason).toBe('notice_required');
      expect(r.noticeKey).toBe(PURPOSE_REGISTRY[purpose].noticeKey);
    }
  });
  it('a call recording is allowed only with the delivered notice AND the recorded answer (BL-144)', () => {
    const rec = { purpose: 'call_recording', channel: 'voice', modality: 'voice' } as const;
    expect(decide({ ...rec, noticeEvidence: { delivered: false } }).decision).toBe('needs_notice');
    // the notice alone is not consent
    expect(decide({ ...rec, noticeEvidence: { delivered: true } }).decision).toBe('needs_notice');
    expect(decide({ ...rec, noticeEvidence: { delivered: true, consent: 'granted' } })).toEqual({
      decision: 'allow',
      reason: 'consent_evidence_recorded',
    });
    expect(decide({ ...rec, noticeEvidence: { delivered: true, consent: 'declined' } })).toEqual({
      decision: 'deny',
      reason: 'consent_declined',
    });
    // a grant with no delivered notice is not evidence
    expect(
      decide({ ...rec, noticeEvidence: { delivered: false, consent: 'granted' } }).decision,
    ).toBe('needs_notice');
  });
  it('the workspace switch is checked before anything else, even with a grant on the record', () => {
    const r = decide({
      purpose: 'call_recording',
      channel: 'voice',
      modality: 'voice',
      purposeEnabled: false,
      noticeEvidence: { delivered: true, consent: 'granted' },
    });
    expect(r).toEqual({ decision: 'deny', reason: 'purpose_not_enabled' });
  });
  it('a notice-first purpose with no grant duty is allowed once its notice is delivered', () => {
    const r = decide({
      purpose: 'voice_ai_conversation',
      channel: 'voice',
      modality: 'voice',
      noticeEvidence: { delivered: true },
    });
    expect(r).toEqual({ decision: 'allow', reason: 'notice_delivered' });
  });
  it('a purpose that does not apply to the channel or modality is denied', () => {
    expect(decide({ purpose: 'call_recording', channel: 'sms' }).reason).toBe(
      'purpose_not_applicable',
    );
    expect(decide({ purpose: 'push_notifications' }).reason).toBe('purpose_not_applicable');
  });
  it('purposes with no opt-in requirement are allowed by policy; mandatory ones wait for the generalised ledger', () => {
    expect(decide({ purpose: 'ai_content_processing' })).toEqual({
      decision: 'allow',
      reason: 'no_grant_required_by_policy',
    });
    expect(decide({ purpose: 'analytics_profiling' }).decision).toBe('allow');
    expect(decide({ purpose: 'third_party_sharing' })).toEqual({
      decision: 'deny',
      reason: 'no_consent_recorded',
    });
  });
  // failure
  it('a gate failure fails closed for marketing and open for service replies', () => {
    expect(failureResult(PURPOSE_REGISTRY.marketing_messaging)).toEqual({
      decision: 'deny',
      reason: 'gate_unavailable_closed',
    });
    expect(failureResult(PURPOSE_REGISTRY.third_party_sharing).decision).toBe('deny');
    expect(failureResult(PURPOSE_REGISTRY.service_messaging)).toEqual({
      decision: 'allow',
      reason: 'gate_unavailable_open',
    });
  });

  it('every reason in the closed set is reachable and nothing outside it is returned', () => {
    const seen = new Set<ConsentGateReason>();
    const all: Array<Partial<DecideInput> & Pick<DecideInput, 'purpose'>> = [
      { purpose: 'marketing' },
      { purpose: 'marketing', requireConsent: true, facts: facts({ ledgerState: 'granted' }) },
      { purpose: 'service_messaging' },
      { purpose: 'service_messaging', replyWindowOpen: true },
      { purpose: 'ai_content_processing' },
      { purpose: 'marketing', facts: facts({ unsubscribedFlag: true }) },
      { purpose: 'marketing', requireConsent: true },
      { purpose: 'marketing', requireConsent: true, channel: 'x' },
      { purpose: 'call_recording', channel: 'sms' },
      { purpose: 'call_recording', channel: 'voice' },
      { purpose: 'call_recording', channel: 'voice', purposeEnabled: false },
      {
        purpose: 'call_recording',
        channel: 'voice',
        noticeEvidence: { delivered: true, consent: 'granted' },
      },
      {
        purpose: 'call_recording',
        channel: 'voice',
        noticeEvidence: { delivered: true, consent: 'declined' },
      },
      { purpose: 'voice_ai_conversation', channel: 'voice', noticeEvidence: { delivered: true } },
      { purpose: 'marketing', minorRule: 'block', facts: facts({ minor: true }) },
      { purpose: 'third_party_sharing', facts: facts({ saleShareOptOut: true }) },
    ];
    for (const i of all) seen.add(decide(i).reason);
    seen.add(failureResult(PURPOSE_REGISTRY.marketing_messaging).reason);
    seen.add(failureResult(PURPOSE_REGISTRY.service_messaging).reason);
    expect([...seen].sort()).toEqual([...CONSENT_GATE_REASONS].sort());
  });
});

describe('the purpose of a message sent to a conversation', () => {
  it('free-form text and files are service replies', () => {
    expect(messagePurpose({ isTemplate: false })).toBe('service_messaging');
    expect(messagePurpose({ isTemplate: false, templateCategory: 'marketing' })).toBe(
      'service_messaging',
    );
  });
  it('a template takes its category', () => {
    expect(messagePurpose({ isTemplate: true, templateCategory: 'MARKETING' })).toBe(
      'marketing_messaging',
    );
    expect(messagePurpose({ isTemplate: true, templateCategory: 'utility' })).toBe(
      'service_messaging',
    );
    expect(messagePurpose({ isTemplate: true, templateCategory: 'authentication' })).toBe(
      'service_messaging',
    );
    expect(messagePurpose({ isTemplate: true })).toBe('service_messaging');
  });
});
