import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_DEFAULTS,
  COMPLIANCE_REGIMES,
  REGIME_PROFILES,
  buildDpaTemplate,
  effectivePolicy,
  isInsideWindow,
  minutesOfDayIn,
  saveConsentNoticeSchema,
  suggestRegimes,
  updateComplianceSettingsSchema,
} from '@crm/contracts';

describe('suggestRegimes', () => {
  it('suggests nothing without a country, and the baseline alone for an unknown one', () => {
    expect(suggestRegimes(null)).toEqual([]);
    expect(suggestRegimes('  ')).toEqual([]);
    expect(suggestRegimes('NZ')).toEqual(['generic']);
  });

  it('maps the countries the profiles are written for', () => {
    expect(suggestRegimes('de')).toEqual(['gdpr_eu']);
    expect(suggestRegimes('NO')).toEqual(['gdpr_eu']);
    expect(suggestRegimes('GB')).toEqual(['uk_gdpr']);
    expect(suggestRegimes('IN')).toEqual(['dpdp_in', 'trai_in']);
    expect(suggestRegimes('US')).toEqual(['ccpa_us', 'tcpa_us']);
    expect(suggestRegimes('BR')).toEqual(['lgpd_br']);
    expect(suggestRegimes('SG')).toEqual(['pdpa_sg']);
  });

  it('only ever suggests known profiles', () => {
    for (const c of ['DE', 'GB', 'IN', 'US', 'BR', 'SG', 'JP']) {
      for (const r of suggestRegimes(c)) expect(COMPLIANCE_REGIMES).toContain(r);
    }
  });
});

describe('effectivePolicy: the strictest wins', () => {
  it('is the baseline alone with no profile, and for generic', () => {
    for (const regimes of [[], ['generic' as const]]) {
      expect(effectivePolicy(regimes)).toEqual({
        marketingOptIn: false,
        requestDays: null,
        minorAge: null,
        callingWindow: null,
        quietHours: null,
        dndRegistries: [],
        requirements: [],
      });
    }
  });

  it('takes the shortest answer time, the highest minor age and an opt-in from any profile', () => {
    const e = effectivePolicy(['gdpr_eu', 'ccpa_us', 'lgpd_br', 'dpdp_in']);
    expect(e.requestDays).toBe(15);
    expect(e.minorAge).toBe(18);
    expect(e.marketingOptIn).toBe(true);
  });

  it('CCPA alone does not require opt-in', () => {
    expect(effectivePolicy(['ccpa_us']).marketingOptIn).toBe(false);
    expect(effectivePolicy(['ccpa_us']).requestDays).toBe(45);
  });

  it('narrows the calling window to the latest start and the earliest end', () => {
    const e = effectivePolicy(['tcpa_us', 'trai_in']);
    expect(e.callingWindow).toEqual({ start: '09:00', end: '21:00' });
    expect(e.quietHours).toEqual({ start: '21:00', end: '09:00' });
    expect([...e.dndRegistries].sort()).toEqual(['trai_ndnc', 'us_dnc']);
  });

  it('unions the requirements once, in the catalogue order, and ignores duplicates', () => {
    const e = effectivePolicy(['gdpr_eu', 'gdpr_eu', 'uk_gdpr', 'dpdp_in']);
    expect(e.requirements).toEqual([
      'dpo_contact',
      'grievance_officer',
      'notice_languages',
      'parental_flag',
      'subprocessor_locations',
      'request_days',
      'marketing_opt_in',
    ]);
  });

  it('a profile that is off adds nothing', () => {
    expect(effectivePolicy(['pdpa_sg']).requirements).not.toContain('grievance_officer');
  });

  it('every profile is listed under its own id and the quiet period is the complement of the window', () => {
    for (const id of COMPLIANCE_REGIMES) {
      const p = REGIME_PROFILES[id];
      expect(p.id).toBe(id);
      if (p.callingWindow && p.quietHours) {
        expect(p.quietHours.start).toBe(p.callingWindow.end);
        expect(p.quietHours.end).toBe(p.callingWindow.start);
      }
    }
  });
});

describe('isInsideWindow', () => {
  const quiet = { start: '21:00', end: '08:00' };
  const m = (h: number, min = 0) => h * 60 + min;

  it('wraps midnight for a quiet period', () => {
    expect(isInsideWindow(m(22), quiet)).toBe(true);
    expect(isInsideWindow(m(0), quiet)).toBe(true);
    expect(isInsideWindow(m(7, 59), quiet)).toBe(true);
    expect(isInsideWindow(m(8), quiet)).toBe(false);
    expect(isInsideWindow(m(20, 59), quiet)).toBe(false);
    expect(isInsideWindow(m(21), quiet)).toBe(true);
  });

  it('a same-day window includes its start and excludes its end', () => {
    const calling = { start: '08:00', end: '21:00' };
    expect(isInsideWindow(m(8), calling)).toBe(true);
    expect(isInsideWindow(m(20, 59), calling)).toBe(true);
    expect(isInsideWindow(m(21), calling)).toBe(false);
    expect(isInsideWindow(m(3), calling)).toBe(false);
  });

  it('an empty window (start equals end) contains nothing', () => {
    expect(isInsideWindow(m(12), { start: '12:00', end: '12:00' })).toBe(false);
  });

  it('reads the clock in the zone given', () => {
    const at = new Date('2026-10-15T20:00:00Z');
    expect(minutesOfDayIn(at, 'UTC')).toBe(20 * 60);
    expect(minutesOfDayIn(at, 'Asia/Kolkata')).toBe(1 * 60 + 30);
  });
});

describe('settings and notice contracts', () => {
  it('accepts the defaults as a first save and cleans a repeated profile and weekday', () => {
    const parsed = updateComplianceSettingsSchema.parse({
      ...COMPLIANCE_DEFAULTS,
      regimes: ['dpdp_in', 'dpdp_in', 'trai_in'],
      callingWindow: { ...COMPLIANCE_DEFAULTS.callingWindow, days: [5, 1, 1, 3] },
      privacyUrl: '',
    });
    expect(parsed.regimes).toEqual(['dpdp_in', 'trai_in']);
    expect(parsed.callingWindow.days).toEqual([1, 3, 5]);
    expect(parsed.privacyUrl).toBeNull();
    expect(parsed.rowVersion).toBeUndefined();
  });

  it('refuses a link that is not https, a clock that is not HH:MM and a bad email', () => {
    const bad = (patch: object) =>
      updateComplianceSettingsSchema.safeParse({ ...COMPLIANCE_DEFAULTS, ...patch }).success;
    expect(bad({ privacyUrl: 'http://example.com/p' })).toBe(false);
    expect(bad({ quietHours: { enabled: true, start: '25:00', end: '08:00' } })).toBe(false);
    expect(bad({ dpo: { name: 'A', email: 'not-an-email', phone: '', address: '' } })).toBe(false);
  });

  it('the consent notice takes an optional https terms link and stays backward compatible', () => {
    const old = saveConsentNoticeSchema.parse({ enabled: true, text: 'I agree', url: null });
    expect(old.termsUrl).toBeNull();
    const withTerms = saveConsentNoticeSchema.parse({
      enabled: true,
      text: 'I agree',
      url: 'https://example.com/privacy',
      termsUrl: 'https://example.com/terms',
    });
    expect(withTerms.termsUrl).toBe('https://example.com/terms');
    expect(
      saveConsentNoticeSchema.safeParse({ enabled: false, text: '', termsUrl: 'ftp://x' }).success,
    ).toBe(false);
  });
});

describe('buildDpaTemplate', () => {
  it('fills in the workspace details and says it is a template, not an agreement', () => {
    const text = buildDpaTemplate({
      workspaceName: 'Acme Ltd',
      officer: { name: 'Sam Rao', email: 'privacy@acme.test' },
      privacyUrl: 'https://acme.test/privacy',
      termsUrl: null,
      regimes: ['dpdp_in'],
      subprocessors: [
        { name: 'Mailer Co', purpose: 'Email delivery', location: 'Ireland', dpaUrl: null },
      ],
    });
    expect(text).toContain('Acme Ltd');
    expect(text).toContain('privacy@acme.test');
    expect(text).toContain('Mailer Co: Email delivery; location Ireland; DPA [link]');
    expect(text).toContain('- dpdp_in');
    expect(text).toContain('not legal advice');
    expect(text).not.toMatch(/\bcompliant\b/i);
  });

  it('leaves brackets for what is not known yet', () => {
    const text = buildDpaTemplate({
      workspaceName: '',
      officer: { name: '', email: '' },
      privacyUrl: null,
      termsUrl: null,
      regimes: [],
      subprocessors: [],
    });
    expect(text).toContain('[legal name, address]');
    expect(text).toContain('No sub-processors are listed yet');
    expect(text).toContain('None chosen yet');
  });
});
