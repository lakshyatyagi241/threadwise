import { describe, expect, it } from 'vitest';
import {
  CONSENT_EVIDENCE_KEYS,
  CONSENT_GATE_REASONS,
  minorRuleOf,
  recordPrivacyFlagSchema,
  type MinorRule,
} from '@crm/contracts';
import {
  NO_FACTS,
  decideConsent,
  isHeldAsMinor,
  type ConsentFacts,
  type DecideInput,
} from '../../../src/modules/contact-consent/consent-gate.rules';
import {
  NO_FLAGS,
  isGpcSignal,
  planFlagChange,
  type FlagsState,
} from '../../../src/modules/contact-consent/contact-privacy.rules';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const facts = (f: Partial<ConsentFacts> = {}): ConsentFacts => ({ ...NO_FACTS, ...f });
const decide = (i: Partial<DecideInput> & Pick<DecideInput, 'purpose'>) =>
  decideConsent({ channel: 'whatsapp', requireConsent: false, facts: facts(), ...i });

describe('the minor rule from the Compliance center settings', () => {
  it('maps the children setting and the parental-consent flag to one rule', () => {
    expect(minorRuleOf('unset', false)).toBe('off');
    expect(minorRuleOf('unset', true)).toBe('guardian');
    expect(minorRuleOf('may_include_minors', false)).toBe('guardian');
    expect(minorRuleOf('may_include_minors', true)).toBe('guardian');
    expect(minorRuleOf('no_minors', false)).toBe('block');
    // "We do not knowingly process minors" wins over the parental-consent flag: a flagged minor is held either way.
    expect(minorRuleOf('no_minors', true)).toBe('block');
  });
});

describe('planFlagChange', () => {
  it('turns a flag on with its time and source, and off again forgetting both', () => {
    const on = planFlagChange(NO_FLAGS, 'minor', true, 'manual', NOW);
    expect(on).toMatchObject({ ok: true, changed: true, steps: [{ kind: 'minor', value: true }] });
    if (!on.ok) throw new Error('unreachable');
    expect(on.next).toMatchObject({
      isMinor: true,
      minorSince: NOW.toISOString(),
      minorSource: 'manual',
    });
    const off = planFlagChange(on.next, 'minor', false, 'manual', NOW);
    if (!off.ok) throw new Error('unreachable');
    expect(off.next).toMatchObject({ isMinor: false, minorSince: null, minorSource: null });
  });

  it('keeps the first time and source when a flag is turned on again', () => {
    const first = planFlagChange(NO_FLAGS, 'sale_share_opt_out', true, 'gpc', NOW);
    if (!first.ok) throw new Error('unreachable');
    const later = new Date('2026-10-16T10:00:00.000Z');
    const again = planFlagChange(first.next, 'sale_share_opt_out', true, 'manual', later);
    expect(again).toMatchObject({ ok: true, changed: false });
    if (!again.ok) throw new Error('unreachable');
    expect(again.next).toMatchObject({
      doNotSellShare: true,
      doNotSellShareSince: NOW.toISOString(),
      doNotSellShareSource: 'gpc',
    });
  });

  it('refuses guardian consent for a contact that is not a minor, and allows clearing it', () => {
    expect(planFlagChange(NO_FLAGS, 'guardian_consent', true, 'manual', NOW)).toEqual({
      ok: false,
      reason: 'not_minor',
    });
    expect(planFlagChange(NO_FLAGS, 'guardian_consent', false, 'manual', NOW)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('clearing the minor flag clears guardian consent in a second history step', () => {
    const minor: FlagsState = {
      ...NO_FLAGS,
      isMinor: true,
      minorSince: 'x',
      minorSource: 'manual',
    };
    const withGuardian = planFlagChange(minor, 'guardian_consent', true, 'manual', NOW);
    if (!withGuardian.ok) throw new Error('unreachable');
    expect(withGuardian.next.guardianConsent).toBe(true);
    const adult = planFlagChange(withGuardian.next, 'minor', false, 'manual', NOW);
    if (!adult.ok) throw new Error('unreachable');
    expect(adult.steps).toEqual([
      { kind: 'minor', value: false },
      { kind: 'guardian_consent', value: false },
    ]);
    expect(adult.next).toMatchObject({
      isMinor: false,
      guardianConsent: false,
      guardianSince: null,
    });
    // A minor without guardian consent clears in one step.
    const plain = planFlagChange(minor, 'minor', false, 'manual', NOW);
    if (!plain.ok) throw new Error('unreachable');
    expect(plain.steps).toEqual([{ kind: 'minor', value: false }]);
  });
});

describe('the Global Privacy Control signal', () => {
  it('is exactly the header value 1', () => {
    expect(isGpcSignal('1')).toBe(true);
    expect(isGpcSignal(' 1 ')).toBe(true);
    expect(isGpcSignal(['1'])).toBe(true);
    for (const v of [undefined, '', '0', 'true', 'yes', '11', [], ['0', '1']]) {
      expect(isGpcSignal(v as string | string[] | undefined), String(v)).toBe(false);
    }
  });
});

describe('ConsentGate: a flagged minor', () => {
  const minor = facts({ minor: true });
  const guarded = facts({ minor: true, guardianConsent: true });
  const rules: MinorRule[] = ['off', 'guardian', 'block'];

  it('is held for marketing under block, held under guardian until guardian consent is on record, never under off', () => {
    expect(decide({ purpose: 'marketing', minorRule: 'block', facts: minor })).toEqual({
      decision: 'deny',
      reason: 'subject_minor',
    });
    expect(decide({ purpose: 'marketing', minorRule: 'block', facts: guarded })).toEqual({
      decision: 'deny',
      reason: 'subject_minor',
    });
    expect(decide({ purpose: 'marketing', minorRule: 'guardian', facts: minor })).toEqual({
      decision: 'deny',
      reason: 'subject_minor',
    });
    expect(decide({ purpose: 'marketing', minorRule: 'guardian', facts: guarded })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
    expect(decide({ purpose: 'marketing', minorRule: 'off', facts: minor })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
    expect(decide({ purpose: 'marketing', facts: minor })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
  });

  it('guardian consent does not replace the marketing grant: the strict switch still needs one', () => {
    expect(
      decide({ purpose: 'marketing', requireConsent: true, minorRule: 'guardian', facts: guarded }),
    ).toEqual({ decision: 'deny', reason: 'no_consent_recorded' });
    expect(
      decide({
        purpose: 'marketing',
        requireConsent: true,
        minorRule: 'guardian',
        facts: facts({ minor: true, guardianConsent: true, ledgerState: 'granted' }),
      }),
    ).toEqual({ decision: 'allow', reason: 'granted' });
  });

  it('a withdrawal is reported as a withdrawal, before the minor hold', () => {
    expect(
      decide({
        purpose: 'marketing',
        minorRule: 'block',
        facts: facts({ minor: true, unsubscribedFlag: true }),
      }),
    ).toEqual({ decision: 'deny', reason: 'withdrawn' });
  });

  it('never holds a service message, whatever the rule', () => {
    for (const minorRule of rules) {
      expect(decide({ purpose: 'service_messaging', minorRule, facts: minor })).toEqual({
        decision: 'allow',
        reason: 'utility_exempt',
      });
      expect(
        decide({ purpose: 'service_messaging', minorRule, replyWindowOpen: true, facts: minor }),
      ).toEqual({ decision: 'allow', reason: 'inbound_reply_window' });
    }
  });

  it('isHeldAsMinor is false for a contact that is not flagged', () => {
    for (const rule of [undefined, ...rules]) {
      expect(isHeldAsMinor(rule, facts())).toBe(false);
    }
  });
});

describe('ConsentGate: sale or sharing opt-out', () => {
  it('denies third-party sharing with its own reason, and changes nothing else', () => {
    expect(
      decide({ purpose: 'third_party_sharing', facts: facts({ saleShareOptOut: true }) }),
    ).toEqual({ decision: 'deny', reason: 'sale_share_opted_out' });
    expect(decide({ purpose: 'third_party_sharing' })).toEqual({
      decision: 'deny',
      reason: 'no_consent_recorded',
    });
    // Marketing and service messages are not "sale or sharing".
    expect(decide({ purpose: 'marketing', facts: facts({ saleShareOptOut: true }) })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
    expect(
      decide({ purpose: 'service_messaging', facts: facts({ saleShareOptOut: true }) }).decision,
    ).toBe('allow');
  });
});

describe('the vocabulary', () => {
  it('has the new reasons and the guardian evidence key', () => {
    expect(CONSENT_GATE_REASONS).toContain('subject_minor');
    expect(CONSENT_GATE_REASONS).toContain('sale_share_opted_out');
    expect(CONSENT_EVIDENCE_KEYS).toContain('guardianConsentRef');
  });

  it('the record schema takes only the known evidence keys and the three person sources', () => {
    const ok = recordPrivacyFlagSchema.parse({
      kind: 'guardian_consent',
      value: true,
      note: ' signed ',
      evidence: { guardianConsentRef: 'F-1' },
    });
    expect(ok).toMatchObject({
      source: 'manual',
      note: 'signed',
      evidence: { guardianConsentRef: 'F-1' },
    });
    expect(
      recordPrivacyFlagSchema.safeParse({ kind: 'minor', value: true, source: 'gpc' }).success,
    ).toBe(false);
    expect(recordPrivacyFlagSchema.safeParse({ kind: 'age', value: true }).success).toBe(false);
    expect(
      recordPrivacyFlagSchema.safeParse({ kind: 'minor', value: true, evidence: { ip: '1.2.3.4' } })
        .success,
    ).toBe(false);
  });
});
