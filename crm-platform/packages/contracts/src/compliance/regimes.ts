import { z } from 'zod';
import { DEFAULT_MINOR_AGE } from '../contact-consent/age';
import type { ConsentRegime } from '../contact-consent/vocabulary';

/**
 * Regime profiles (spec docs/specs/privacy-and-data-governance.md section 11, backlog BL-172). Every workspace gets the baseline; a
 * profile is a workspace setting that switches on the extras one law asks for. Several can be on at once and the strictest rule wins
 * (`effectivePolicy`). A profile is a tool to help a workspace comply: nothing here says a workspace IS compliant, and every number is a
 * design default that counsel confirms (spec section 10).
 */
export const COMPLIANCE_REGIMES = [
  'gdpr_eu',
  'uk_gdpr',
  'dpdp_in',
  'ccpa_us',
  'tcpa_us',
  'trai_in',
  'lgpd_br',
  'pdpa_sg',
  'generic',
] as const;
export const complianceRegimeSchema = z.enum(COMPLIANCE_REGIMES);
export type ComplianceRegime = (typeof COMPLIANCE_REGIMES)[number];

/** Which Do-Not-Call / DND registry a workspace says it scrubs against. A hook: nothing is fetched from a registry (BL-181). */
export const DND_REGISTRIES = ['none', 'trai_ndnc', 'us_dnc', 'sg_dnc', 'custom'] as const;
export const dndRegistrySchema = z.enum(DND_REGISTRIES);
export type DndRegistry = (typeof DND_REGISTRIES)[number];

/** `HH:MM`, 24 hours. */
export const complianceClockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24 hours.');

/** What a regime adds to the checklist. The ids are also the keys of the checklist's locale text. */
export const COMPLIANCE_REQUIREMENTS = [
  'dpo_contact',
  'grievance_officer',
  'notice_languages',
  'parental_flag',
  'opt_out_notice',
  'quiet_hours',
  'calling_window',
  'dnd_registry',
  'subprocessor_locations',
  'request_days',
  'marketing_opt_in',
] as const;
export type ComplianceRequirement = (typeof COMPLIANCE_REQUIREMENTS)[number];

export interface RegimeProfile {
  id: ComplianceRegime;
  /** The extras this profile puts on the checklist. */
  requirements: readonly ComplianceRequirement[];
  /** Days to answer a person's request (design default); null when the profile sets none. */
  requestDays: number | null;
  /** Under this age a person is a minor for the profile; null when it sets none. */
  minorAge: number | null;
  /** The profile asks for a recorded opt-in before marketing. */
  marketingOptIn: boolean;
  /** Hours in which marketing messages should not be sent: `start` to `end`, wrapping midnight. */
  quietHours: { start: string; end: string } | null;
  /** The only hours marketing calls are made. */
  callingWindow: { start: string; end: string } | null;
  dndRegistry: DndRegistry | null;
  /** The hint the consent ledger vocabulary carries for this profile (nothing reads it yet). */
  consentHints: readonly ConsentRegime[];
}

export const REGIME_PROFILES: Readonly<Record<ComplianceRegime, RegimeProfile>> = {
  gdpr_eu: {
    id: 'gdpr_eu',
    requirements: ['dpo_contact', 'subprocessor_locations', 'request_days', 'marketing_opt_in'],
    requestDays: 30,
    minorAge: 16,
    marketingOptIn: true,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['gdpr', 'eprivacy'],
  },
  uk_gdpr: {
    id: 'uk_gdpr',
    requirements: ['dpo_contact', 'subprocessor_locations', 'request_days', 'marketing_opt_in'],
    requestDays: 30,
    minorAge: 13,
    marketingOptIn: true,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['gdpr', 'eprivacy'],
  },
  dpdp_in: {
    id: 'dpdp_in',
    requirements: [
      'grievance_officer',
      'notice_languages',
      'parental_flag',
      'request_days',
      'marketing_opt_in',
    ],
    requestDays: 30,
    minorAge: 18,
    marketingOptIn: true,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['dpdp'],
  },
  ccpa_us: {
    id: 'ccpa_us',
    requirements: ['opt_out_notice', 'request_days'],
    requestDays: 45,
    minorAge: 16,
    marketingOptIn: false,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['none'],
  },
  tcpa_us: {
    id: 'tcpa_us',
    requirements: ['quiet_hours', 'calling_window', 'dnd_registry', 'marketing_opt_in'],
    requestDays: null,
    minorAge: null,
    marketingOptIn: true,
    quietHours: { start: '21:00', end: '08:00' },
    callingWindow: { start: '08:00', end: '21:00' },
    dndRegistry: 'us_dnc',
    consentHints: ['tcpa_ctia'],
  },
  trai_in: {
    id: 'trai_in',
    requirements: ['quiet_hours', 'calling_window', 'dnd_registry', 'marketing_opt_in'],
    requestDays: null,
    minorAge: null,
    marketingOptIn: true,
    quietHours: { start: '21:00', end: '09:00' },
    callingWindow: { start: '09:00', end: '21:00' },
    dndRegistry: 'trai_ndnc',
    consentHints: ['trai_dlt'],
  },
  lgpd_br: {
    id: 'lgpd_br',
    requirements: ['dpo_contact', 'subprocessor_locations', 'request_days', 'marketing_opt_in'],
    requestDays: 15,
    minorAge: 18,
    marketingOptIn: true,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['none'],
  },
  pdpa_sg: {
    id: 'pdpa_sg',
    requirements: ['dpo_contact', 'dnd_registry', 'request_days', 'marketing_opt_in'],
    requestDays: 30,
    minorAge: 13,
    marketingOptIn: true,
    quietHours: null,
    callingWindow: null,
    dndRegistry: 'sg_dnc',
    consentHints: ['none'],
  },
  generic: {
    id: 'generic',
    requirements: [],
    requestDays: null,
    minorAge: null,
    marketingOptIn: false,
    quietHours: null,
    callingWindow: null,
    dndRegistry: null,
    consentHints: ['none'],
  },
};

/** The 27 EU member states and the three EEA states that are not members. */
export const GDPR_EU_COUNTRIES: readonly string[] = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
];

/**
 * The country names a billing form can hold, for the countries a profile is written for. Anything else reads as unknown. A checkout
 * form takes free text (up to 80 characters), so the code or the common name is accepted.
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  austria: 'AT',
  belgium: 'BE',
  bulgaria: 'BG',
  croatia: 'HR',
  cyprus: 'CY',
  czechia: 'CZ',
  'czech republic': 'CZ',
  denmark: 'DK',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  deutschland: 'DE',
  greece: 'GR',
  hungary: 'HU',
  ireland: 'IE',
  italy: 'IT',
  latvia: 'LV',
  lithuania: 'LT',
  luxembourg: 'LU',
  malta: 'MT',
  netherlands: 'NL',
  'the netherlands': 'NL',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  slovakia: 'SK',
  slovenia: 'SI',
  spain: 'ES',
  sweden: 'SE',
  iceland: 'IS',
  liechtenstein: 'LI',
  norway: 'NO',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  india: 'IN',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  america: 'US',
  brazil: 'BR',
  brasil: 'BR',
  singapore: 'SG',
};

/** An ISO 3166-1 alpha-2 code from what a form holds: a two-letter code, or the name of a country a profile covers. Else null. */
export function countryCodeOf(input: string | null | undefined): string | null {
  const t = (input ?? '').trim();
  if (t === '') return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_NAMES[t.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')] ?? null;
}

/**
 * The profiles a country suggests. A suggestion only: the workspace accepts, changes or ignores it. Anything unknown is `generic`,
 * which is the baseline alone.
 */
export function suggestRegimes(country: string | null | undefined): ComplianceRegime[] {
  const c = countryCodeOf(country) ?? '';
  if (c === '') return [];
  if (GDPR_EU_COUNTRIES.includes(c)) return ['gdpr_eu'];
  switch (c) {
    case 'GB':
      return ['uk_gdpr'];
    case 'IN':
      return ['dpdp_in', 'trai_in'];
    case 'US':
      return ['ccpa_us', 'tcpa_us'];
    case 'BR':
      return ['lgpd_br'];
    case 'SG':
      return ['pdpa_sg'];
    default:
      return ['generic'];
  }
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** The age below which a person is a minor in this workspace: the highest of the switched-on profiles' ages, else 18 (BL-211, spec 11.10). */
export function workspaceMinorAge(regimes: readonly ComplianceRegime[]): number {
  return effectivePolicy(regimes).minorAge ?? DEFAULT_MINOR_AGE;
}

export interface EffectivePolicy {
  /** Opt-in before marketing: true as soon as one profile asks for it. */
  marketingOptIn: boolean;
  /** The smallest number of days over the profiles, or null when none sets one. */
  requestDays: number | null;
  /** The highest age treated as a minor, or null. */
  minorAge: number | null;
  /** The narrowest allowed calling window (latest start, earliest end), or null. Null also when two windows do not overlap. */
  callingWindow: { start: string; end: string } | null;
  /** The widest quiet period that covers every profile's: the complement of the calling window when one exists. */
  quietHours: { start: string; end: string } | null;
  /** The registries the profiles name, without `none`. */
  dndRegistries: DndRegistry[];
  /** Every requirement of every profile that is on, once. */
  requirements: ComplianceRequirement[];
}

/**
 * The strictest-wins merge of the profiles that are switched on (spec 11.4). Pure: no clock, no workspace data. A profile that is off
 * adds nothing; an empty list is the baseline alone.
 */
export function effectivePolicy(regimes: readonly ComplianceRegime[]): EffectivePolicy {
  const profiles = [...new Set(regimes)].map((r) => REGIME_PROFILES[r]);
  const days = profiles.map((p) => p.requestDays).filter((d): d is number => d !== null);
  const ages = profiles.map((p) => p.minorAge).filter((a): a is number => a !== null);
  const windows = profiles.map((p) => p.callingWindow).filter((w) => w !== null);
  let callingWindow: EffectivePolicy['callingWindow'] = null;
  if (windows.length > 0) {
    const start = Math.max(...windows.map((w) => minutes(w.start)));
    const end = Math.min(...windows.map((w) => minutes(w.end)));
    if (start < end) {
      const f = (n: number) =>
        `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      callingWindow = { start: f(start), end: f(end) };
    }
  }
  return {
    marketingOptIn: profiles.some((p) => p.marketingOptIn),
    requestDays: days.length > 0 ? Math.min(...days) : null,
    minorAge: ages.length > 0 ? Math.max(...ages) : null,
    callingWindow,
    quietHours: callingWindow ? { start: callingWindow.end, end: callingWindow.start } : null,
    dndRegistries: [
      ...new Set(profiles.map((p) => p.dndRegistry).filter((d): d is DndRegistry => d !== null)),
    ],
    requirements: COMPLIANCE_REQUIREMENTS.filter((r) =>
      profiles.some((p) => p.requirements.includes(r)),
    ),
  };
}

/**
 * Is `minutesOfDay` (0 to 1439) inside a window `start` to `end`? A window whose end is before its start wraps midnight (a quiet period
 * 21:00 to 08:00). Equal start and end is an empty window. Pure and tested; `decideSendWindow` (send-window.ts) builds the hold decision on it.
 */
export function isInsideWindow(
  minutesOfDay: number,
  window: { start: string; end: string },
): boolean {
  const s = minutes(window.start);
  const e = minutes(window.end);
  if (s === e) return false;
  return s < e ? minutesOfDay >= s && minutesOfDay < e : minutesOfDay >= s || minutesOfDay < e;
}

/** Minutes since midnight of `at` in the IANA zone `timeZone` (the contact's, the fallback zone or the workspace's: see `resolveContactZones`). */
export function minutesOfDayIn(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}
