import {
  COMPANY_ADDRESS_MAX,
  COMPANY_EMAIL_MAX,
  COMPANY_INDUSTRY_MAX,
  COMPANY_NAME_MAX,
  COMPANY_NOTES_MAX,
  COMPANY_PHONE_MAX,
  COMPANY_SIZE_RANGE_MAX,
  COMPANY_WEBSITE_MAX,
  type CompanyResponse,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from '@crm/contracts';

/** The new / edit company form: every field as the input holds it (a string), and the rules the API holds it to. */
export interface CompanyFormValues {
  name: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  sizeRange: string;
  address: string;
  notes: string;
  /** A member id, or empty for nobody. */
  ownerId: string;
}

export const EMPTY_FORM: CompanyFormValues = {
  name: '',
  industry: '',
  website: '',
  email: '',
  phone: '',
  sizeRange: '',
  address: '',
  notes: '',
  ownerId: '',
};

/** The longest each input may be (the inputs' `maxLength`, and what the API refuses above). */
export const LIMITS = {
  name: COMPANY_NAME_MAX,
  industry: COMPANY_INDUSTRY_MAX,
  website: COMPANY_WEBSITE_MAX,
  email: COMPANY_EMAIL_MAX,
  phone: COMPANY_PHONE_MAX,
  sizeRange: COMPANY_SIZE_RANGE_MAX,
  address: COMPANY_ADDRESS_MAX,
  notes: COMPANY_NOTES_MAX,
} as const;

export function fromCompany(c: CompanyResponse): CompanyFormValues {
  return {
    name: c.name,
    industry: c.industry ?? '',
    website: c.website ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    sizeRange: c.sizeRange ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    ownerId: c.owner?.id ?? '',
  };
}

export type FormErrorKind = 'required' | 'tooLong' | 'email';
export type FormErrors = Partial<Record<keyof CompanyFormValues, FormErrorKind>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors the API's rules so a mistake is caught before the call; the API still has the last word. */
export function validate(v: CompanyFormValues): FormErrors {
  const errors: FormErrors = {};
  if (v.name.trim() === '') errors.name = 'required';
  for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
    if (!errors[key] && v[key].trim().length > LIMITS[key]) errors[key] = 'tooLong';
  }
  if (!errors.email && v.email.trim() !== '' && !EMAIL.test(v.email.trim())) errors.email = 'email';
  return errors;
}

const text = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** A new company. `ownerId` is always sent: the form shows who it will belong to (the person creating it, by default). */
export function toCreateInput(v: CompanyFormValues): CreateCompanyInput {
  return {
    name: v.name.trim(),
    industry: text(v.industry),
    website: text(v.website),
    email: text(v.email),
    phone: text(v.phone),
    sizeRange: text(v.sizeRange),
    address: text(v.address),
    notes: text(v.notes),
    ownerId: v.ownerId === '' ? null : v.ownerId,
  };
}

/** Only what changed, with the version that was read; `null` when nothing changed (no call, no new version). */
export function toUpdateInput(
  v: CompanyFormValues,
  c: Pick<CompanyResponse, 'rowVersion'> & CompanyResponse,
): UpdateCompanyInput | null {
  const before = fromCompany(c);
  const out: Record<string, unknown> = {};
  let changed = false;
  const set = (key: string, value: unknown) => {
    out[key] = value;
    changed = true;
  };
  if (v.name.trim() !== before.name) set('name', v.name.trim());
  for (const key of [
    'industry',
    'website',
    'email',
    'phone',
    'sizeRange',
    'address',
    'notes',
  ] as const) {
    if (v[key].trim() !== before[key].trim()) set(key, text(v[key]));
  }
  if (v.ownerId !== before.ownerId) set('ownerId', v.ownerId === '' ? null : v.ownerId);
  return changed ? ({ ...out, rowVersion: c.rowVersion } as UpdateCompanyInput) : null;
}

/**
 * A link for the company's website. WaDesk stores free text and printed it as a dead link; here a bare domain gets `https://`
 * and anything that is not plain http(s) (`javascript:`, `data:`, a sentence) is not a link at all.
 */
export function websiteHref(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '' || /\s/.test(v)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
