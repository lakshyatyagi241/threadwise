import { describe, expect, it } from 'vitest';
import {
  cleanEvidence,
  csvCell,
  csvLine,
  flagAfter,
  transition,
} from '../../../src/modules/contact-consent/consent.rules';
import { mergeSettings } from '../../../src/modules/contact-consent/consent-settings.service';
import { CONSENT_SETTINGS_DEFAULTS } from '@crm/contracts';

describe('state derivation', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  it('the first event sets the state', () => {
    expect(transition(null, 'withdrawn', t0)).toEqual({
      nextState: 'withdrawn',
      stateChanged: true,
    });
    expect(transition(null, 'granted', t0)).toEqual({ nextState: 'granted', stateChanged: true });
  });
  it('the same state again is not a change', () => {
    const prior = { state: 'withdrawn', lastOccurredAt: t0.toISOString() };
    expect(transition(prior, 'withdrawn', new Date('2026-02-01T00:00:00Z')).stateChanged).toBe(
      false,
    );
  });
  it('a later event flips it', () => {
    const prior = { state: 'withdrawn', lastOccurredAt: t0.toISOString() };
    expect(transition(prior, 'granted', new Date('2026-02-01T00:00:00Z'))).toEqual({
      nextState: 'granted',
      stateChanged: true,
    });
  });
  it('a late-reported older event is history only', () => {
    const prior = { state: 'withdrawn', lastOccurredAt: '2026-03-01T00:00:00Z' };
    expect(transition(prior, 'granted', new Date('2026-02-01T00:00:00Z'))).toEqual({
      nextState: null,
      stateChanged: false,
    });
  });
});

describe('contact flag roll-up', () => {
  it('a withdrawal always sets the flag', () => {
    expect(flagAfter('withdrawn', undefined, false)).toBe(true);
    expect(flagAfter('withdrawn', 'granted', false)).toBe(true);
  });
  it('a grant clears it only when it reverses a ledger withdrawal and nothing else is withdrawn', () => {
    expect(flagAfter('granted', 'withdrawn', false)).toBe(false);
    expect(flagAfter('granted', 'withdrawn', true)).toBeNull();
  });
  it('a grant never clears a legacy flag the ledger knows nothing about', () => {
    expect(flagAfter('granted', undefined, false)).toBeNull();
    expect(flagAfter('granted', 'granted', false)).toBeNull();
  });
});

describe('evidence', () => {
  it('keeps only known keys, trimmed and cut, and never an ip', () => {
    const out = cleanEvidence({
      ip: '1.2.3.4',
      userAgent: 'x',
      keyword: ' stop ',
      consentText: 'a'.repeat(500),
      formId: null,
      fileName: '',
    } as unknown as Record<string, unknown>);
    expect(Object.keys(out).sort()).toEqual(['consentText', 'keyword']);
    expect(out.keyword).toBe('stop');
    expect(out.consentText).toHaveLength(300);
  });
});

describe('csv cells', () => {
  it('neutralises formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('quotes commas, quotes and newlines; null is empty', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvLine(['a', null, undefined, 3])).toBe('a,,,3');
  });
});

describe('settings merge', () => {
  it('no row is the defaults (detection on, policy off)', () => {
    const v = mergeSettings(null);
    expect(v.detectionEnabled).toBe(true);
    expect(v.requireConsentForMarketing).toBe(false);
    expect(v.optOutKeywords.en).toContain('STOP');
    expect(v.footerText.en).toBe('Reply STOP to unsubscribe');
  });
  it('a saved row overrides only what it carries', () => {
    const v = mergeSettings({
      detectionEnabled: false,
      requireConsentForMarketing: true,
      autoReplyEnabled: false,
      footerDefaultOn: false,
      config: { optOutKeywords: { en: ['halt'] } },
      rowVersion: 2,
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(v.optOutKeywords).toEqual({ en: ['halt'] });
    expect(v.optInKeywords).toEqual(CONSENT_SETTINGS_DEFAULTS.optInKeywords);
    expect(v.requireConsentForMarketing).toBe(true);
  });
});
