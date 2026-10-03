import { z } from 'zod';

/**
 * Header templates of a custom-header provider (`{"x-access-token": "{{providerToken}}", "x-waba-id": "{{wabaId}}"}`).
 *
 * An operator types these, so they are untrusted input that ends up in every outbound request: the rules below keep a template from
 * smuggling a second header (CR/LF), hijacking the connection (hop-by-hop and framing headers), or leaking a secret into a header
 * it was not meant for (only the four placeholders exist, and nothing else in braces is allowed). Rendering re-checks every value.
 */

/** The only placeholders. Anything else inside `{{ }}` is refused at save time. */
export const HEADER_PLACEHOLDERS = ['providerToken', 'wabaId', 'phoneNumberId', 'channelToken'] as const;
export type HeaderPlaceholder = (typeof HEADER_PLACEHOLDERS)[number];

export const MAX_HEADER_TEMPLATES = 12;
export const MAX_HEADER_VALUE_LENGTH = 512;
export const MAX_RENDERED_VALUE_LENGTH = 4096;

/** Headers the HTTP client or the connection owns; a template naming one could change how the request is framed or routed. */
export const DENIED_HEADER_NAMES: readonly string[] = [
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-type',
  'content-encoding',
  'content-range',
  'accept',
  'accept-encoding',
  'expect',
  'cookie',
  'set-cookie',
  'origin',
  'referer',
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-http-method-override',
];

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** Visible ASCII and the space: no CR, LF, tab, NUL or any other control character, no non-ASCII. */
const TEMPLATE_VALUE = /^[\x20-\x7e]+$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export function placeholdersOf(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/** The refusals for one template map; an empty list means it is safe to store. Names are compared in lower case. */
export function headerTemplateProblems(templates: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const entries = Object.entries(templates);
  if (entries.length > MAX_HEADER_TEMPLATES) {
    problems.push(`At most ${MAX_HEADER_TEMPLATES} headers are allowed`);
  }
  const seen = new Set<string>();
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!HEADER_NAME.test(name)) {
      problems.push(`Header name "${rawName.slice(0, 40)}" is not a valid name (letters, digits and hyphens)`);
      continue;
    }
    if (seen.has(name)) problems.push(`Header "${name}" appears twice`);
    seen.add(name);
    if (DENIED_HEADER_NAMES.includes(name) || name.startsWith('sec-') || name.startsWith('proxy-')) {
      problems.push(`Header "${name}" is managed by the connection and cannot be set`);
      continue;
    }
    if (typeof rawValue !== 'string' || rawValue.length === 0) {
      problems.push(`Header "${name}" needs a value`);
      continue;
    }
    if (rawValue.length > MAX_HEADER_VALUE_LENGTH) {
      problems.push(`Header "${name}" is longer than ${MAX_HEADER_VALUE_LENGTH} characters`);
      continue;
    }
    if (!TEMPLATE_VALUE.test(rawValue)) {
      problems.push(`Header "${name}" holds a control or non-ASCII character`);
      continue;
    }
    const unknown = placeholdersOf(rawValue).filter((p) => !(HEADER_PLACEHOLDERS as readonly string[]).includes(p));
    if (unknown.length) {
      problems.push(`Header "${name}" uses an unknown placeholder: ${[...new Set(unknown)].join(', ')}`);
      continue;
    }
    // A brace that is not part of a known placeholder is a typo that would be sent literally.
    if (/[{}]/.test(rawValue.replace(PLACEHOLDER, ''))) {
      problems.push(`Header "${name}" has a stray brace; placeholders look like {{wabaId}}`);
    }
  }
  return problems;
}

/** Zod form: the object, lower-casing the names, refusing anything `headerTemplateProblems` lists. */
export const headerTemplatesSchema = z
  .record(z.string())
  .transform((v) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k.toLowerCase(), val])))
  .superRefine((v, ctx) => {
    for (const message of headerTemplateProblems(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

export type HeaderTemplates = Record<string, string>;

export type HeaderValues = Partial<Record<HeaderPlaceholder, string | undefined>>;

/** What each placeholder's value may look like once it is about to enter a header. Ids are narrow; tokens are printable and unbroken. */
const VALUE_RULES: Record<HeaderPlaceholder, RegExp> = {
  wabaId: /^[A-Za-z0-9_.:-]{1,128}$/,
  phoneNumberId: /^[A-Za-z0-9_.:-]{1,128}$/,
  providerToken: /^[\x21-\x7e]{1,4096}$/,
  channelToken: /^[\x21-\x7e]{1,4096}$/,
};

export class HeaderRenderError extends Error {
  constructor(readonly placeholder: HeaderPlaceholder) {
    super(`The value for {{${placeholder}}} is not allowed in a header`);
    this.name = 'HeaderRenderError';
  }
}

/**
 * Renders the templates for one call. A header whose placeholders are not all known is left out (the number id header on a call that
 * has no number), so a missing value never becomes a literal `{{phoneNumberId}}` on the wire. A value that is present but unsafe
 * (a token with a line break) throws: refusing the call is better than sending a forged header.
 */
export function renderHeaderTemplates(
  templates: Readonly<HeaderTemplates>,
  values: HeaderValues,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, template] of Object.entries(templates)) {
    let complete = true;
    const rendered = template.replace(PLACEHOLDER, (_m, rawKey: string) => {
      const key = rawKey as HeaderPlaceholder;
      const value = values[key];
      if (value === undefined || value === '') {
        complete = false;
        return '';
      }
      if (!VALUE_RULES[key]?.test(value)) throw new HeaderRenderError(key);
      return value;
    });
    if (complete && TEMPLATE_VALUE.test(rendered) && rendered.length <= MAX_RENDERED_VALUE_LENGTH) {
      out[name.toLowerCase()] = rendered;
    }
  }
  return out;
}

/** Secrets that a rendered header set carries, for scrubbing from errors and logs. */
export function secretValuesIn(values: HeaderValues): string[] {
  return [values.providerToken, values.channelToken].filter((v): v is string => typeof v === 'string' && v.length >= 6);
}
