import {
  COMPLIANCE_DEFAULTS,
  type ChecklistStatus,
  type ComplianceSettings,
  type ComplianceSettingsValues,
  type SubprocessorInput,
  type UpdateComplianceSettingsInput,
} from '@crm/contracts';

/**
 * The Compliance center form. Links and the optional text fields are strings while a person types (an empty box is `''`) and
 * become `null` on the way out, so the form never holds a `null` in an input.
 */
export interface SettingsForm extends Omit<
  ComplianceSettingsValues,
  | 'privacyUrl'
  | 'termsUrl'
  | 'optOutNoticeUrl'
  | 'consentManager'
  | 'windowTimezone'
  | 'secondaryNoticeLocale'
> {
  privacyUrl: string;
  termsUrl: string;
  optOutNoticeUrl: string;
  consentManager: { name: string; url: string };
  windowTimezone: string;
  secondaryNoticeLocale: string;
}

export function formFromSettings(s: ComplianceSettings | ComplianceSettingsValues): SettingsForm {
  return {
    regimes: [...s.regimes],
    privacyUrl: s.privacyUrl ?? '',
    termsUrl: s.termsUrl ?? '',
    dpo: { ...s.dpo },
    grievanceOfficer: { ...s.grievanceOfficer },
    childrenPolicy: s.childrenPolicy,
    parentalConsentRequired: s.parentalConsentRequired,
    offerSaleShareOptOut: s.offerSaleShareOptOut,
    optOutNoticeUrl: s.optOutNoticeUrl ?? '',
    consentManager: { name: s.consentManager.name, url: s.consentManager.url ?? '' },
    quietHours: { ...s.quietHours },
    callingWindow: { ...s.callingWindow, days: [...s.callingWindow.days] },
    windowTimezone: s.windowTimezone ?? '',
    dndRegistry: s.dndRegistry,
    secondaryNoticeLocale: s.secondaryNoticeLocale ?? '',
    subprocessorsPublic: s.subprocessorsPublic,
  };
}

export const emptyForm = (): SettingsForm => formFromSettings(COMPLIANCE_DEFAULTS);

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function toSettingsInput(
  f: SettingsForm,
  rowVersion: number | null,
): UpdateComplianceSettingsInput {
  const officer = (o: SettingsForm['dpo']) => ({
    name: o.name.trim(),
    email: o.email.trim(),
    phone: o.phone.trim(),
    address: o.address.trim(),
  });
  return {
    regimes: f.regimes,
    privacyUrl: orNull(f.privacyUrl),
    termsUrl: orNull(f.termsUrl),
    dpo: officer(f.dpo),
    grievanceOfficer: officer(f.grievanceOfficer),
    childrenPolicy: f.childrenPolicy,
    parentalConsentRequired: f.parentalConsentRequired,
    offerSaleShareOptOut: f.offerSaleShareOptOut,
    optOutNoticeUrl: orNull(f.optOutNoticeUrl),
    consentManager: { name: f.consentManager.name.trim(), url: orNull(f.consentManager.url) },
    quietHours: f.quietHours,
    callingWindow: f.callingWindow,
    windowTimezone: orNull(f.windowTimezone),
    dndRegistry: f.dndRegistry,
    secondaryNoticeLocale: orNull(f.secondaryNoticeLocale)?.toLowerCase() ?? null,
    subprocessorsPublic: f.subprocessorsPublic,
    ...(rowVersion === null ? {} : { rowVersion }),
  };
}

/** Has the person changed anything? Compared on what would be sent. */
export function settingsDirty(form: SettingsForm, baseline: SettingsForm): boolean {
  return (
    JSON.stringify(toSettingsInput(form, null)) !== JSON.stringify(toSettingsInput(baseline, null))
  );
}

export const isHttpsUrl = (v: string): boolean => /^https:\/\/\S+$/i.test(v.trim());
const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A problem is a field path and a message key under `compliance-center.problems`. Mirrors the server's rules. */
export interface Problem {
  path: string;
  key: 'httpsOnly' | 'email' | 'quietEmpty' | 'windowOrder' | 'daysEmpty' | 'englishFirst';
}

export function formProblems(f: SettingsForm): Problem[] {
  const out: Problem[] = [];
  for (const [path, value] of [
    ['privacyUrl', f.privacyUrl],
    ['termsUrl', f.termsUrl],
    ['optOutNoticeUrl', f.optOutNoticeUrl],
    ['consentManager.url', f.consentManager.url],
  ] as const) {
    if (value.trim() !== '' && !isHttpsUrl(value)) out.push({ path, key: 'httpsOnly' });
  }
  for (const [path, value] of [
    ['dpo.email', f.dpo.email],
    ['grievanceOfficer.email', f.grievanceOfficer.email],
  ] as const) {
    if (value.trim() !== '' && !isEmail(value)) out.push({ path, key: 'email' });
  }
  if (f.quietHours.enabled && f.quietHours.start === f.quietHours.end) {
    out.push({ path: 'quietHours.end', key: 'quietEmpty' });
  }
  if (f.callingWindow.enabled) {
    if (minutes(f.callingWindow.start) >= minutes(f.callingWindow.end)) {
      out.push({ path: 'callingWindow.end', key: 'windowOrder' });
    }
    if (f.callingWindow.days.length === 0)
      out.push({ path: 'callingWindow.days', key: 'daysEmpty' });
  }
  if (f.secondaryNoticeLocale.trim().toLowerCase() === 'en') {
    out.push({ path: 'secondaryNoticeLocale', key: 'englishFirst' });
  }
  return out;
}

export const problemFor = (problems: Problem[], path: string): Problem['key'] | undefined =>
  problems.find((p) => p.path === path)?.key;

export function toggleDay(days: number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

export function toggleRegime<T extends string>(regimes: T[], regime: T): T[] {
  return regimes.includes(regime) ? regimes.filter((r) => r !== regime) : [...regimes, regime];
}

export const STATUS_TONE: Record<ChecklistStatus, 'success' | 'warning' | 'danger'> = {
  built: 'success',
  partial: 'warning',
  open: 'danger',
};

// ---- sub-processors -------------------------------------------------------------------------------------------------------------

export interface SubprocessorForm {
  name: string;
  purpose: string;
  dataCategories: string;
  location: string;
  websiteUrl: string;
  dpaUrl: string;
  status: SubprocessorInput['status'];
  addedOn: string;
  noticeSentOn: string;
}

export const emptySubprocessor = (): SubprocessorForm => ({
  name: '',
  purpose: '',
  dataCategories: '',
  location: '',
  websiteUrl: '',
  dpaUrl: '',
  status: 'active',
  addedOn: '',
  noticeSentOn: '',
});

export const subprocessorToForm = (s: SubprocessorInput): SubprocessorForm => ({
  name: s.name,
  purpose: s.purpose,
  dataCategories: s.dataCategories,
  location: s.location,
  websiteUrl: s.websiteUrl ?? '',
  dpaUrl: s.dpaUrl ?? '',
  status: s.status,
  addedOn: s.addedOn ?? '',
  noticeSentOn: s.noticeSentOn ?? '',
});

export const subprocessorToInput = (f: SubprocessorForm): SubprocessorInput => ({
  name: f.name.trim(),
  purpose: f.purpose.trim(),
  dataCategories: f.dataCategories.trim(),
  location: f.location.trim(),
  websiteUrl: orNull(f.websiteUrl),
  dpaUrl: orNull(f.dpaUrl),
  status: f.status,
  addedOn: orNull(f.addedOn),
  noticeSentOn: orNull(f.noticeSentOn),
});

export function subprocessorProblems(
  f: SubprocessorForm,
): Array<{ path: string; key: 'required' | 'httpsOnly' }> {
  const out: Array<{ path: string; key: 'required' | 'httpsOnly' }> = [];
  if (f.name.trim() === '') out.push({ path: 'name', key: 'required' });
  for (const [path, v] of [
    ['websiteUrl', f.websiteUrl],
    ['dpaUrl', f.dpaUrl],
  ] as const) {
    if (v.trim() !== '' && !isHttpsUrl(v)) out.push({ path, key: 'httpsOnly' });
  }
  return out;
}

/** A file name for the DPA download. */
export const dpaFileName = (workspace: string): string =>
  `dpa-template-${
    workspace
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace'
  }.md`;
