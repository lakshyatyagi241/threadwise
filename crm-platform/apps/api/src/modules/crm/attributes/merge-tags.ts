import {
  MERGE_KEY_ALIASES,
  MERGE_TAG_PATTERN,
  countryCodeDigits,
  normalizeMergeKey,
  type ResolveMergeTagResponse,
} from '@crm/contracts';

type Source = ResolveMergeTagResponse['tokens'][number]['source'];

/** The contact side of the lookup: the columns a token can name, and the attribute values. */
export interface MergeContact {
  name: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  title: string | null;
  /** As stored, normally E.164. */
  phone: string | null;
  countryCode: string | null;
  email: string | null;
  address: string | null;
  language: string | null;
  /** Names, not ids (Reference's contact_group token printed the ids). */
  groups: string[];
  /** contacts.data: attribute values keyed by attribute key, and whatever integrations wrote. */
  data: Record<string, unknown>;
  /** The contact's company, when it has one the loader could read. */
  company?: MergeCompany | null;
}

/** The company the contact belongs to: what `{{company.industry}}` and `{{company.<property>}}` read. */
export interface MergeCompany {
  name: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  sizeRange: string | null;
  address: string | null;
  notes: string | null;
  /** companies.data: the values of the workspace's company properties, by property key. */
  data: Record<string, unknown>;
}

export interface MergeContext {
  contact?: MergeContact;
  /** ACTIVE attributes only: key -> default value. */
  attributeDefaults: ReadonlyMap<string, string | null>;
  system: { today: string; businessName: string; companyName: string };
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') return '';
  return String(v).trim();
};

/** "+91 9812345678" with country code "+91": the number without its country code. */
function localDigits(phone: string | null, countryCode: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const cc = countryCodeDigits(countryCode);
  return cc && digits.startsWith(cc) ? digits.slice(cc.length) : digits;
}

/** The value of a contact column token, or '' when the contact has none. */
function contactColumn(key: string, c: MergeContact): string | undefined {
  switch (key) {
    case 'name':
      return text(c.name);
    case 'first_name':
      return text(c.firstName);
    case 'middle_name':
      return text(c.middleName);
    case 'last_name':
      return text(c.lastName);
    case 'title':
      return text(c.title);
    // country code digits + local digits, unless the number already carries its code
    case 'phone':
      return (c.phone ?? '').replace(/\D/g, '');
    case 'mobile':
      return localDigits(c.phone, c.countryCode);
    case 'country_code':
      return text(c.countryCode);
    case 'email':
      return text(c.email);
    case 'address':
      return text(c.address);
    case 'language':
      return text(c.language);
    case 'groups':
    case 'contact_group':
      return c.groups.join(', ');
    default:
      return undefined;
  }
}

/** The built-in columns of a company a token can name: `{{company.industry}}`. `company.name` is not one (see `companyToken`). */
const COMPANY_COLUMNS: Record<string, keyof Omit<MergeCompany, 'data' | 'name'>> = {
  website: 'website',
  email: 'email',
  phone: 'phone',
  industry: 'industry',
  size: 'sizeRange',
  size_range: 'sizeRange',
  address: 'address',
};

/**
 * The value of a company token for the contact's company, or undefined when the token is not one or there is nothing to put there.
` * `company.<column>` is a built-in column of the company (not its internal notes), `company.<key>` one of the workspace's company properties, and
 * `company` / `contact_company` the company's name. `company_name` is NOT the contact's company: it is the sender's business name,
 * as since TW-CON-048, so a template that uses it keeps saying the same thing. The dotted spelling normalises to the underscore one
 * (`company.industry` is `company_industry`), so a saved reply, a template and a broadcast read it the same way.
 */
function companyToken(
  normalized: string,
  company: MergeCompany | null | undefined,
): string | undefined {
  if (!company) return undefined;
  if (normalized === 'company' || normalized === 'contact_company') {
    const v = text(company.name);
    return v === '' ? undefined : v;
  }
  if (!normalized.startsWith('company_') || normalized === 'company_name') return undefined;
  const rest = normalized.slice('company_'.length);
  const column = COMPANY_COLUMNS[rest];
  if (column) {
    const v = text(company[column]);
    return v === '' ? undefined : v;
  }
  for (const [k, v] of Object.entries(company.data)) {
    if (normalizeMergeKey(k) === rest) {
      const t = text(v);
      if (t !== '') return t;
    }
  }
  return undefined;
}

/**
 * One token to its value. Lookup order (TW-CON-048), for the key and its alias:
 *   1. a contact column     2. the contact's own attribute value (empty ones skipped)
 *   3. the workspace attribute's default (active attributes only)
 *   4. the contact's company: company.industry, company.<property>, company (BL-196)
 *   5. system tokens: today, business_name, company_name
 * Nothing found is the empty string, never the braces: a customer must not receive "{{city}}".
 */
export function resolveToken(
  raw: string,
  ctx: MergeContext,
): { key: string; value: string; source: Source } {
  const normalized = normalizeMergeKey(raw);
  const canonical = MERGE_KEY_ALIASES[normalized] ?? normalized;
  const candidates = [...new Set([canonical, normalized])];

  if (ctx.contact) {
    for (const key of candidates) {
      const col = contactColumn(key, ctx.contact);
      if (col !== undefined && col !== '') return { key: canonical, value: col, source: 'contact' };
    }
    for (const [k, v] of Object.entries(ctx.contact.data)) {
      if (candidates.includes(normalizeMergeKey(k))) {
        const t = text(v);
        if (t !== '') return { key: canonical, value: t, source: 'contact_attribute' };
      }
    }
  }
  for (const key of candidates) {
    const fallback = ctx.attributeDefaults.get(key);
    if (fallback) return { key: canonical, value: fallback, source: 'attribute_default' };
  }
  for (const key of candidates) {
    const fromCompany = companyToken(key, ctx.contact?.company);
    if (fromCompany !== undefined) return { key: canonical, value: fromCompany, source: 'company' };
  }
  const system: Record<string, string> = {
    today: ctx.system.today,
    business_name: ctx.system.businessName,
    company_name: ctx.system.companyName,
  };
  for (const key of candidates) {
    if (system[key]) return { key: canonical, value: system[key]!, source: 'system' };
  }
  return { key: canonical, value: '', source: 'unresolved' };
}

export function renderMergeTags(template: string, ctx: MergeContext): ResolveMergeTagResponse {
  const tokens: ResolveMergeTagResponse['tokens'] = [];
  const rendered = template.replace(MERGE_TAG_PATTERN, (match, inner: string) => {
    const r = resolveToken(inner, ctx);
    tokens.push({
      token: match,
      key: r.key,
      resolved: r.source !== 'unresolved',
      source: r.source,
    });
    return r.value;
  });
  return { rendered, tokens };
}
