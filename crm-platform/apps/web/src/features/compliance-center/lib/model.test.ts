import { describe, expect, it } from 'vitest';
import { COMPLIANCE_DEFAULTS } from '@crm/contracts';
import {
  dpaFileName,
  emptyForm,
  formFromSettings,
  formProblems,
  isHttpsUrl,
  settingsDirty,
  subprocessorProblems,
  subprocessorToInput,
  emptySubprocessor,
  toSettingsInput,
  toggleDay,
  toggleRegime,
} from './model';

describe('the settings form', () => {
  it('starts from the defaults, with strings where the API has nulls', () => {
    const f = emptyForm();
    expect(f.privacyUrl).toBe('');
    expect(f.windowTimezone).toBe('');
    expect(f.consentManager).toEqual({ name: '', url: '', registrationId: '' });
    expect(f.regimes).toEqual([]);
  });

  it('sends nulls for empty boxes and leaves the version out of a first save', () => {
    const f = {
      ...emptyForm(),
      regimes: ['dpdp_in' as const],
      privacyUrl: ' https://a.test/p ',
      secondaryNoticeLocale: ' HI ',
    };
    const first = toSettingsInput(f, null);
    expect(first.privacyUrl).toBe('https://a.test/p');
    expect(first.termsUrl).toBeNull();
    expect(first.windowTimezone).toBeNull();
    expect(first.secondaryNoticeLocale).toBe('hi');
    expect('rowVersion' in first).toBe(false);
    expect(toSettingsInput(f, 4).rowVersion).toBe(4);
  });

  it('round-trips what the API returned', () => {
    const f = formFromSettings({
      ...COMPLIANCE_DEFAULTS,
      privacyUrl: 'https://a.test/p',
      windowTimezone: 'Asia/Kolkata',
    });
    expect(toSettingsInput(f, 2)).toMatchObject({
      privacyUrl: 'https://a.test/p',
      windowTimezone: 'Asia/Kolkata',
      rowVersion: 2,
    });
  });

  it('is dirty only when what would be sent changes (spaces do not count)', () => {
    const base = emptyForm();
    expect(settingsDirty({ ...base, privacyUrl: '   ' }, base)).toBe(false);
    expect(settingsDirty({ ...base, regimes: ['gdpr_eu'] }, base)).toBe(true);
  });

  it('finds the problems the server would refuse', () => {
    const f = {
      ...emptyForm(),
      privacyUrl: 'http://a.test',
      dpo: { name: '', email: 'nope', phone: '', address: '' },
      quietHours: { enabled: true, start: '21:00', end: '21:00' },
      callingWindow: { enabled: true, start: '21:00', end: '08:00', days: [] },
      secondaryNoticeLocale: 'EN',
    };
    expect(
      formProblems(f)
        .map((p) => p.path)
        .sort(),
    ).toEqual(
      [
        'callingWindow.days',
        'callingWindow.end',
        'dpo.email',
        'privacyUrl',
        'quietHours.end',
        'secondaryNoticeLocale',
      ].sort(),
    );
    expect(formProblems(emptyForm())).toEqual([]);
  });

  it('a switched-off window is not checked', () => {
    const f = {
      ...emptyForm(),
      callingWindow: { enabled: false, start: '21:00', end: '08:00', days: [] },
    };
    expect(formProblems(f)).toEqual([]);
  });

  it('toggles days (kept sorted) and profiles', () => {
    expect(toggleDay([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleDay([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleRegime(['gdpr_eu'], 'dpdp_in')).toEqual(['gdpr_eu', 'dpdp_in']);
    expect(toggleRegime(['gdpr_eu', 'dpdp_in'], 'gdpr_eu')).toEqual(['dpdp_in']);
  });

  it('accepts https links only', () => {
    expect(isHttpsUrl('https://a.test')).toBe(true);
    expect(isHttpsUrl('http://a.test')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('the sub-processor form', () => {
  it('needs a name and https links', () => {
    expect(subprocessorProblems(emptySubprocessor()).map((p) => p.path)).toEqual(['name']);
    const f = {
      ...emptySubprocessor(),
      name: 'Mailer',
      websiteUrl: 'ftp://x',
      dpaUrl: 'https://x.test/dpa',
    };
    expect(subprocessorProblems(f)).toEqual([{ path: 'websiteUrl', key: 'httpsOnly' }]);
  });

  it('sends trimmed values and nulls for empty ones', () => {
    const input = subprocessorToInput({
      ...emptySubprocessor(),
      name: '  Mailer ',
      location: ' Ireland ',
    });
    expect(input).toMatchObject({
      name: 'Mailer',
      location: 'Ireland',
      websiteUrl: null,
      addedOn: null,
      status: 'active',
    });
  });

  it('names the DPA download after the workspace', () => {
    expect(dpaFileName('Acme & Sons, Ltd.')).toBe('dpa-template-acme-sons-ltd.md');
    expect(dpaFileName('***')).toBe('dpa-template-workspace.md');
  });
});
