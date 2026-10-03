import {
  DENIED_HEADER_NAMES,
  HEADER_PLACEHOLDERS,
  MAX_HEADER_TEMPLATES,
  MAX_HEADER_VALUE_LENGTH,
  headerTemplateProblems,
  placeholdersOf,
  renderHeaderTemplates,
  type HeaderPlaceholder,
  type HeaderTemplates,
  type WhatsappAuthScheme,
  type WhatsappCredentialMode,
} from '@crm/contracts';

/**
 * The custom-header editor's logic. The rules are the contract's (`@crm/contracts` header-templates), restated here as codes so the
 * screen can show them in the operator's language; a test keeps this list and the contract's in step.
 */

export interface HeaderRow {
  /** Stable key for React; never sent. */
  id: string;
  name: string;
  value: string;
}

export const PLACEHOLDERS: readonly HeaderPlaceholder[] = HEADER_PLACEHOLDERS;

export type HeaderProblemCode =
  | 'tooMany'
  | 'nameInvalid'
  | 'nameDenied'
  | 'nameDuplicate'
  | 'valueEmpty'
  | 'valueTooLong'
  | 'valueCharacters'
  | 'placeholderUnknown'
  | 'strayBrace'
  /** A custom-header provider needs one header that carries the credential its mode uses. */
  | 'credentialNotCarried';

export interface HeaderProblem {
  code: HeaderProblemCode;
  /** The row it belongs to; absent for a problem of the whole set. */
  rowId?: string;
  values?: Record<string, string | number>;
}

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TEMPLATE_VALUE = /^[\x20-\x7e]+$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

let rowSeq = 0;
export const newRowId = (): string => `row-${++rowSeq}`;

export function newRow(name = '', value = ''): HeaderRow {
  return { id: newRowId(), name, value };
}

/** The rows of a stored template map, in its own order. */
export function rowsFromTemplates(templates: Readonly<Record<string, string>>): HeaderRow[] {
  return Object.entries(templates).map(([name, value]) => newRow(name, value));
}

/** A starting point for a new custom-header provider: one header carrying the credential. */
export function starterRows(mode: WhatsappCredentialMode): HeaderRow[] {
  return [
    newRow('x-api-key', mode === 'platform_token' ? '{{providerToken}}' : '{{channelToken}}'),
  ];
}

/** Rows that are entirely blank are dropped (an operator adds one and never fills it). */
const filled = (rows: readonly HeaderRow[]) =>
  rows.filter((r) => r.name.trim() !== '' || r.value.trim() !== '');

/** The template map the API takes: names lower-cased and trimmed, values trimmed. */
export function templatesFromRows(rows: readonly HeaderRow[]): HeaderTemplates {
  const out: HeaderTemplates = {};
  for (const r of filled(rows)) out[r.name.trim().toLowerCase()] = r.value.trim();
  return out;
}

/** The placeholder a credential mode needs one header to carry (the API refuses a custom-header provider without it). */
export const carriedPlaceholder = (mode: WhatsappCredentialMode): HeaderPlaceholder =>
  mode === 'platform_token' ? 'providerToken' : 'channelToken';

/**
 * Everything wrong with the rows, as codes. Empty means the API will take them. Only used for a `custom_headers` provider; a
 * `bearer` provider carries no templates.
 */
export function headerProblems(
  rows: readonly HeaderRow[],
  mode: WhatsappCredentialMode,
): HeaderProblem[] {
  const problems: HeaderProblem[] = [];
  const list = filled(rows);
  if (list.length > MAX_HEADER_TEMPLATES)
    problems.push({ code: 'tooMany', values: { max: MAX_HEADER_TEMPLATES } });
  const seen = new Set<string>();
  for (const row of list) {
    const name = row.name.trim().toLowerCase();
    const value = row.value.trim();
    if (!HEADER_NAME.test(name)) {
      problems.push({ code: 'nameInvalid', rowId: row.id });
      continue;
    }
    if (seen.has(name)) problems.push({ code: 'nameDuplicate', rowId: row.id, values: { name } });
    seen.add(name);
    if (
      DENIED_HEADER_NAMES.includes(name) ||
      name.startsWith('sec-') ||
      name.startsWith('proxy-')
    ) {
      problems.push({ code: 'nameDenied', rowId: row.id, values: { name } });
      continue;
    }
    if (value.length === 0) {
      problems.push({ code: 'valueEmpty', rowId: row.id, values: { name } });
      continue;
    }
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      problems.push({
        code: 'valueTooLong',
        rowId: row.id,
        values: { name, max: MAX_HEADER_VALUE_LENGTH },
      });
      continue;
    }
    if (!TEMPLATE_VALUE.test(value)) {
      problems.push({ code: 'valueCharacters', rowId: row.id, values: { name } });
      continue;
    }
    const unknown = placeholdersOf(value).filter(
      (p) => !(HEADER_PLACEHOLDERS as readonly string[]).includes(p),
    );
    if (unknown.length) {
      problems.push({
        code: 'placeholderUnknown',
        rowId: row.id,
        values: { name, names: [...new Set(unknown)].join(', ') },
      });
      continue;
    }
    if (/[{}]/.test(value.replace(PLACEHOLDER, ''))) {
      problems.push({ code: 'strayBrace', rowId: row.id, values: { name } });
    }
  }
  const wanted = carriedPlaceholder(mode);
  const carried = list.some((r) => placeholdersOf(r.value.trim()).includes(wanted));
  if (!carried)
    problems.push({ code: 'credentialNotCarried', values: { placeholder: `{{${wanted}}}` } });
  return problems;
}

/** The contract's own verdict on the same rows, for a last safety check (and for the test that compares the two). */
export const contractProblems = (rows: readonly HeaderRow[]): string[] =>
  headerTemplateProblems(templatesFromRows(rows));

// --- preview ---------------------------------------------------------------------------------------------------------------

/** Obvious stand-ins; a real token never enters the preview. They pass the renderer's value rules. */
export const PREVIEW_VALUES: Readonly<Record<HeaderPlaceholder, string>> = {
  providerToken: '<provider-token>',
  channelToken: '<number-token>',
  wabaId: 'WABA_ID',
  phoneNumberId: 'PHONE_NUMBER_ID',
};

export interface PreviewHeader {
  name: string;
  value: string;
}

/**
 * The headers a call would carry, rendered with the stand-in values: `Authorization: Bearer <token>` for `bearer`, otherwise the
 * templates through the same renderer the API uses (so a header it would leave out is left out here too). A header that cannot
 * be rendered because it is invalid is simply absent: the problems list says why.
 */
export function previewHeaders(
  authScheme: WhatsappAuthScheme,
  rows: readonly HeaderRow[],
  mode: WhatsappCredentialMode,
): PreviewHeader[] {
  if (authScheme === 'bearer') {
    const token =
      mode === 'platform_token' ? PREVIEW_VALUES.providerToken : PREVIEW_VALUES.channelToken;
    return [{ name: 'authorization', value: `Bearer ${token}` }];
  }
  try {
    const rendered = renderHeaderTemplates(templatesFromRows(rows), PREVIEW_VALUES);
    return Object.entries(rendered).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/** Placeholders a template set uses that this credential mode never has on a call (so the header would always be left out). */
export function unreachablePlaceholders(
  rows: readonly HeaderRow[],
  mode: WhatsappCredentialMode,
): HeaderPlaceholder[] {
  // platform_token: customers hold no token of their own, so {{channelToken}} is never known.
  if (mode !== 'platform_token') return [];
  const used = new Set(filled(rows).flatMap((r) => placeholdersOf(r.value.trim())));
  return used.has('channelToken') ? ['channelToken'] : [];
}

/** Appends `{{name}}` to a row's value (the chip buttons under the editor). */
export const insertPlaceholder = (value: string, placeholder: HeaderPlaceholder): string =>
  `${value}{{${placeholder}}}`;
