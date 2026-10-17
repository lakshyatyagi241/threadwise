import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { FieldResponse } from '@crm/contracts';
import type { ContactRow } from '../api/schemas';

/**
 * What the contact quick view and the details overview read from a contact beyond its columns: social links, the job title
 * property, the country of the phone number and the time zone. Pure, so each rule is tested without a browser.
 */

export const SOCIAL_NETWORKS = [
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'youtube',
  'telegram',
  'tiktok',
  'website',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface SocialLink {
  network: SocialNetwork;
  /** The property key the link came from. */
  key: string;
  url: string;
}

/** `linkedin_url`, `LinkedIn`, `x_profile` ... to the network they name; `null` when the key names none. */
export function networkOf(key: string): SocialNetwork | null {
  const base = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_(url|link|profile|handle|page|account)$/, '')
    .replace(/^(url|link|profile)_/, '');
  if (base === 'x') return 'twitter';
  return (SOCIAL_NETWORKS as readonly string[]).includes(base) ? (base as SocialNetwork) : null;
}

/** A value that is an http(s) address and nothing else (never `javascript:`, `data:` or a bare word); `null` otherwise. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2048) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The social profile links the contact's custom values hold, one per network, in the order of `SOCIAL_NETWORKS`. */
export function socialLinks(customFields: Readonly<Record<string, unknown>>): SocialLink[] {
  const found = new Map<SocialNetwork, SocialLink>();
  for (const [key, value] of Object.entries(customFields)) {
    const network = networkOf(key);
    const url = network ? webUrl(value) : null;
    if (network && url && !found.has(network)) found.set(network, { network, key, url });
  }
  return SOCIAL_NETWORKS.flatMap((n) => {
    const link = found.get(n);
    return link ? [link] : [];
  });
}

const JOB_TITLE_KEYS = ['job_title', 'jobtitle', 'designation'] as const;

/** The custom property the job title is kept in: an active, editable property of the workspace with one of the usual keys. */
export function jobTitleField(fields: readonly FieldResponse[] | undefined): FieldResponse | null {
  for (const key of JOB_TITLE_KEYS) {
    const f = (fields ?? []).find((x) => x.key === key && x.isActive && !x.isSystem);
    if (f) return f;
  }
  return null;
}

/** The job title text the contact holds under `field`, empty when none. */
export function jobTitleOf(
  c: Pick<ContactRow, 'customFields'>,
  field: FieldResponse | null,
): string {
  const v = field ? c.customFields[field.key] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

/** The country the phone number belongs to, by its dial code, named in `locale`; empty when the number is not valid. */
export function countryOfPhone(phone: string | null | undefined, locale: string): string {
  const parsed = phone ? parsePhoneNumberFromString(phone) : undefined;
  const code = parsed?.country;
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The time zone the contact's own property holds: the registry's `timezone`-typed property, else a property keyed `timezone`. */
export function timeZoneOf(
  c: Pick<ContactRow, 'customFields'>,
  fields: readonly FieldResponse[] | undefined,
): string {
  const field =
    (fields ?? []).find((f) => f.fieldType === 'timezone' && f.isActive) ??
    (fields ?? []).find((f) => f.key === 'timezone' && f.isActive);
  const v = field ? c.customFields[field.key] : c.customFields.timezone;
  return typeof v === 'string' ? v.trim() : '';
}
