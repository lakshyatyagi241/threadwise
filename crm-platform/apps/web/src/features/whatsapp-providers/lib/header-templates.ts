import type { AuthScheme, CredentialMode } from '../api/schemas';

/** The values a header template may mention; each is filled in per call on the server. */
export const PLACEHOLDERS = ['providerToken', 'wabaId', 'phoneNumberId'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** One editable row. Rows (not a record) so two rows can briefly share a name while the operator types. */
export interface HeaderRow {
  name: string;
  value: string;
}

export type HeaderIssueCode =
  | 'nameEmpty'
  | 'nameInvalid'
  | 'nameReserved'
  | 'nameDuplicate'
  | 'valueEmpty'
  | 'valueInvalid'
  | 'unknownPlaceholder'
  | 'unbalancedBraces';

export interface HeaderIssue {
  row: number;
  field: 'name' | 'value';
  code: HeaderIssueCode;
  /** The offending placeholder or name, for the message. */
  detail?: string;
}

/** Headers the HTTP client owns; a template must not override them. */
const RESERVED = new Set([
  'host',
  'content-length',
  'content-type',
  'connection',
  'transfer-encoding',
  'accept-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'cookie',
]);

/** RFC 9110 token characters. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

export const isPlaceholder = (name: string): name is Placeholder =>
  (PLACEHOLDERS as readonly string[]).includes(name);

/** The placeholders a template value mentions, in order, without duplicates. */
export function placeholdersIn(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(PLACEHOLDER_RE)) {
    const name = m[1] ?? '';
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function rowsFromRecord(record: Readonly<Record<string, string>>): HeaderRow[] {
  return Object.entries(record).map(([name, value]) => ({ name, value }));
}

/** Rows to the wire record: blank rows dropped, names lower-cased the way HTTP treats them. */
export function recordFromRows(rows: readonly HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const name = r.name.trim().toLowerCase();
    if (!name && !r.value.trim()) continue;
    out[name] = r.value.trim();
  }
  return out;
}

/** Every problem in the rows, in row order. An empty list means the editor is valid. */
export function validateHeaderRows(rows: readonly HeaderRow[]): HeaderIssue[] {
  const issues: HeaderIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const name = row.name.trim();
    const value = row.value.trim();
    // A completely blank row is just an unfilled line the operator added; recordFromRows drops it.
    if (!name && !value) return;
    if (!name) issues.push({ row: i, field: 'name', code: 'nameEmpty' });
    else if (!TOKEN.test(name)) issues.push({ row: i, field: 'name', code: 'nameInvalid' });
    else if (RESERVED.has(name.toLowerCase()))
      issues.push({ row: i, field: 'name', code: 'nameReserved', detail: name });
    else {
      const lower = name.toLowerCase();
      if (seen.has(lower))
        issues.push({ row: i, field: 'name', code: 'nameDuplicate', detail: name });
      else seen.set(lower, i);
    }
    if (!value) {
      issues.push({ row: i, field: 'value', code: 'valueEmpty' });
      return;
    }
    if (CONTROL.test(row.value)) {
      issues.push({ row: i, field: 'value', code: 'valueInvalid' });
      return;
    }
    const stripped = value.replace(PLACEHOLDER_RE, '');
    if (/[{}]/.test(stripped)) issues.push({ row: i, field: 'value', code: 'unbalancedBraces' });
    for (const p of placeholdersIn(value)) {
      if (!isPlaceholder(p))
        issues.push({ row: i, field: 'value', code: 'unknownPlaceholder', detail: p });
    }
  });
  return issues;
}

/**
 * Whether the set of rows can authenticate a call in the given mode. `platform_token` + custom headers needs the platform
 * credential in at least one header (otherwise every call would go out unauthenticated); the other combinations carry their token
 * elsewhere (Bearer, or the channel's own token).
 */
export function missingTokenPlaceholder(
  rows: readonly HeaderRow[],
  authScheme: AuthScheme,
  credentialMode: CredentialMode,
): boolean {
  if (authScheme !== 'custom_headers' || credentialMode !== 'platform_token') return false;
  return !rows.some((r) => placeholdersIn(r.value).includes('providerToken'));
}

export interface PreviewValues {
  wabaId?: string;
  phoneNumberId?: string;
}

/** What the secret looks like in a preview: never the secret, only that one goes there. */
export const MASK = '••••••••';

/** Hides the middle of an id the operator typed, so a screenshot of the preview is safe to share. */
export function maskId(id: string): string {
  const v = id.trim();
  if (v.length <= 4) return v ? MASK : '';
  return `${MASK}${v.slice(-4)}`;
}

/**
 * The headers one call would carry, with every secret masked. An unknown placeholder is left as typed so it is visible (the
 * validator flags it); ids use the test values when given, otherwise `<wabaId>` style stand-ins.
 */
export function previewHeaders(
  rows: readonly HeaderRow[],
  values: PreviewValues = {},
): Array<{ name: string; value: string }> {
  const fill: Record<Placeholder, string> = {
    providerToken: MASK,
    wabaId: values.wabaId?.trim() ? values.wabaId.trim() : '<wabaId>',
    phoneNumberId: values.phoneNumberId?.trim() ? values.phoneNumberId.trim() : '<phoneNumberId>',
  };
  return rows
    .filter((r) => r.name.trim() && r.value.trim())
    .map((r) => ({
      name: r.name.trim().toLowerCase(),
      value: r.value
        .trim()
        .replace(PLACEHOLDER_RE, (whole, name: string) =>
          isPlaceholder(name.trim()) ? fill[name.trim() as Placeholder] : whole,
        ),
    }));
}

/** The Bearer header the platform sends when the scheme is `bearer`, masked, for the same preview list. */
export function bearerPreview(): Array<{ name: string; value: string }> {
  return [{ name: 'authorization', value: `Bearer ${MASK}` }];
}
