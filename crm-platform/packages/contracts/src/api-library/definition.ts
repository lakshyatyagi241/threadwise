/**
 * api-library (ALIB): the definition of a saved API call, shared by create, update and test-run. Owner-requested feature carried
 * over from the old console (not a Reference port). See docs/api/api-library.md.
 *
 * A definition is a request template: the URL, header values and body strings may hold `{{variable}}` tokens. Every token must be
 * declared in `variables` with a default (the value used by a test run and when a flow cannot supply one).
 */
import { z } from 'zod';

export const API_LIBRARY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type ApiLibraryMethod = (typeof API_LIBRARY_METHODS)[number];
export const apiLibraryMethodSchema = z.enum(API_LIBRARY_METHODS);

/** The methods that carry a payload (the old console showed the payload editor for these only). */
export const API_LIBRARY_BODY_METHODS = [
  'POST',
  'PUT',
  'PATCH',
] as const satisfies readonly ApiLibraryMethod[];
export const apiLibraryMethodHasBody = (m: string): boolean =>
  (API_LIBRARY_BODY_METHODS as readonly string[]).includes(m);

export const API_LIBRARY_PAYLOAD_TYPES = ['application/json', 'multipart/form-data'] as const;
export type ApiLibraryPayloadType = (typeof API_LIBRARY_PAYLOAD_TYPES)[number];
export const apiLibraryPayloadTypeSchema = z.enum(API_LIBRARY_PAYLOAD_TYPES);

/** Letters, digits and underscore only (the name is the prefix of the variables a flow reads: `{{Name.field}}`). */
export const API_LIBRARY_NAME_RE = /^[A-Za-z0-9_]+$/;
export const API_LIBRARY_NAME_MAX = 64;
export const API_LIBRARY_URL_MAX = 2048;
export const API_LIBRARY_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const API_LIBRARY_MAX_HEADERS = 30;
export const API_LIBRARY_MAX_VARIABLES = 50;
export const API_LIBRARY_MAX_MAPPINGS = 100;
export const API_LIBRARY_MAX_RESPONSE_VARIABLES = 100;
export const API_LIBRARY_FUNCTION_MAX = 20_000;
/** The request body, serialised, may not exceed this (the saved definition, not a run). */
export const API_LIBRARY_BODY_MAX_BYTES = 256 * 1024;

/**
 * What a secret header reads as everywhere it is shown (detail, list, logs). Sending this exact value back on an update keeps the stored
 * secret; sending anything else replaces it. The real value is never returned by any route.
 */
export const API_LIBRARY_SECRET_MASK = '********';

/** The `{{token}}` syntax the flow engine uses (spaces inside are allowed). */
export const API_LIBRARY_TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** The distinct token names in a text, in order of first appearance. */
export function apiLibraryTokensOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(API_LIBRARY_TOKEN_RE)) {
    const name = m[1]!.trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Replaces every token through `lookup`; a token `lookup` has no answer for becomes an empty string (as in the flow engine). */
export function apiLibraryRender(
  text: string,
  lookup: (name: string) => string | undefined,
): string {
  return text.replace(API_LIBRARY_TOKEN_RE, (_m, raw: string) => lookup(raw.trim()) ?? '');
}

/** The string leaves of a JSON value (object values, array items), for token scanning and rendering. */
export function apiLibraryLeafStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) apiLibraryLeafStrings(v, out);
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) apiLibraryLeafStrings(v, out);
  return out;
}

const SENSITIVE_PARTS = [
  'authorization',
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'cookie',
  'credential',
  'signature',
  'bearer',
  'privatekey',
  'xauth',
];

/**
 * Whether a header, query-parameter or JSON key reads like a secret (Authorization, X-API-Key, access_token, client_secret, ...). The
 * name is compared without case and without `-`, `_`, `.` and spaces. Used to pre-tick the "secret" box and to mask logs.
 */
export function apiLibraryIsSensitiveName(name: string): boolean {
  const compact = name.toLowerCase().replace(/[-_.\s]/g, '');
  return compact === 'auth' || SENSITIVE_PARTS.some((p) => compact.includes(p));
}

/** A response path: `data.items[0].name` (one element) or `data.items[].name` (every element, collected into a list). */
export const API_LIBRARY_PATH_RE =
  /^[^\s.[\]][^\s[\].]*(?:\[\d*\])*(?:\.[^\s.[\]][^\s[\].]*(?:\[\d*\])*)*$/;

// --- pieces ---------------------------------------------------------------------------------------------------------------

/** Where the old console's chip menu got a variable from: a contact property, another saved API's response field, or a flow variable. */
export const API_LIBRARY_VARIABLE_SOURCES = ['contact', 'api', 'flow'] as const;
export const apiLibraryVariableSourceSchema = z.enum(API_LIBRARY_VARIABLE_SOURCES);

export const apiLibraryVariableSchema = z.object({
  /** What is between the braces: `phone`, `order_id`, or `OtherApi.data.id` for another saved API's response field. */
  name: z.string().trim().min(1).max(160),
  source: apiLibraryVariableSourceSchema.default('contact'),
  /** Used by a test run, and by a flow that has no value for the name. Required, as in the old console. */
  defaultValue: z.string().min(1, 'A default value is required').max(2000),
});
export type ApiLibraryVariable = z.infer<typeof apiLibraryVariableSchema>;

export const apiLibraryHeaderInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(API_LIBRARY_HEADER_NAME_RE, 'Not a valid header name'),
  /** May hold tokens. `API_LIBRARY_SECRET_MASK` keeps the stored value of a secret header on update. */
  value: z.string().max(4000),
  /** Masked on every read and in logs. Authorization, API-key, token-like names are secret whatever this says. */
  secret: z.boolean().default(false),
});
export type ApiLibraryHeaderInput = z.infer<typeof apiLibraryHeaderInputSchema>;

export const apiLibraryHeaderSchema = apiLibraryHeaderInputSchema.extend({ secret: z.boolean() });
export type ApiLibraryHeader = z.infer<typeof apiLibraryHeaderSchema>;

/**
 * A JSON payload (object or array whose strings may hold tokens) or, for multipart/form-data, an object of field name to text value.
 * Null: no payload.
 */
export const apiLibraryBodySchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .nullable();
export type ApiLibraryBody = z.infer<typeof apiLibraryBodySchema>;

/** Response -> contact: where in the answer to read, which contact property to write. */
export const apiLibraryMappingSchema = z.object({
  /** `data.items[0].name`, or `data.items[].name` for every element. */
  path: z.string().trim().min(1).max(300).regex(API_LIBRARY_PATH_RE, 'Not a valid response path'),
  /** A contact property key (see GET /api-library/contact-properties). */
  contactProperty: z.string().trim().min(1).max(120),
  /** Written when the path is missing or empty in the answer. Empty: nothing is written then. */
  defaultValue: z.string().max(2000).default(''),
});
export type ApiLibraryMapping = z.infer<typeof apiLibraryMappingSchema>;

// --- the definition -------------------------------------------------------------------------------------------------------

const definitionFields = {
  method: apiLibraryMethodSchema,
  /** May hold tokens. http or https; no credentials in the URL (use a header). */
  url: z.string().trim().min(1).max(API_LIBRARY_URL_MAX),
  payloadType: apiLibraryPayloadTypeSchema.default('application/json'),
  variables: z.array(apiLibraryVariableSchema).max(API_LIBRARY_MAX_VARIABLES).default([]),
  headers: z.array(apiLibraryHeaderInputSchema).max(API_LIBRARY_MAX_HEADERS).default([]),
  body: apiLibraryBodySchema.default(null),
  /** JavaScript defining `function processPayload(payload) { ... return payload; }`; run in the sandbox on the rendered JSON payload. */
  functionCode: z.string().max(API_LIBRARY_FUNCTION_MAX).nullable().default(null),
  mapping: z.array(apiLibraryMappingSchema).max(API_LIBRARY_MAX_MAPPINGS).default([]),
  /** Response paths a flow can read as `{{ApiName.<path>}}` (the old console's "use in bot"). */
  responseVariables: z
    .array(
      z.string().trim().min(1).max(300).regex(API_LIBRARY_PATH_RE, 'Not a valid response path'),
    )
    .max(API_LIBRARY_MAX_RESPONSE_VARIABLES)
    .default([]),
};

const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
]);

export interface ApiLibraryDefinitionShape {
  method: ApiLibraryMethod;
  url: string;
  payloadType: ApiLibraryPayloadType;
  variables: ApiLibraryVariable[];
  headers: ApiLibraryHeaderInput[];
  body: ApiLibraryBody;
  functionCode: string | null;
  mapping: ApiLibraryMapping[];
  responseVariables: string[];
}

/** Every token the URL, header values and body strings use, in order of first appearance. */
export function apiLibraryDefinitionTokens(
  d: Pick<ApiLibraryDefinitionShape, 'url' | 'headers' | 'body'>,
): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    for (const n of apiLibraryTokensOf(t)) if (!out.includes(n)) out.push(n);
  };
  add(d.url);
  for (const h of d.headers) add(h.value);
  for (const s of apiLibraryLeafStrings(d.body)) add(s);
  return out;
}

/** The cross-field rules, as `[path, message]` problems (empty when the definition is acceptable). Pure: the API runs it again on save. */
export function apiLibraryDefinitionProblems(
  d: ApiLibraryDefinitionShape,
): Array<[string, string]> {
  const problems: Array<[string, string]> = [];
  const hasBody = apiLibraryMethodHasBody(d.method);

  const declared = new Map<string, ApiLibraryVariable>();
  d.variables.forEach((v, i) => {
    const k = v.name.toLowerCase();
    if (declared.has(k))
      problems.push([`variables.${i}.name`, `Variable "${v.name}" is declared twice`]);
    declared.set(k, v);
  });
  for (const token of apiLibraryDefinitionTokens(d)) {
    if (!declared.has(token.toLowerCase()))
      problems.push(['variables', `Variable "${token}" is used but has no default value`]);
  }

  const lookup = (n: string) => declared.get(n.toLowerCase())?.defaultValue;
  const rendered = apiLibraryRender(d.url, lookup);
  // Not `new URL`: the contracts package has no DOM/Node lib. The server parses the rendered URL again before it connects.
  const m = /^(https?):\/\/([^\s/?#]*)([/?#]\S*)?$/i.exec(rendered);
  if (!m || m[2] === '') {
    problems.push([
      'url',
      /^[a-z][a-z0-9+.-]*:\/\//i.test(rendered) && !m
        ? 'The URL must start with http:// or https://'
        : 'A valid URL is required',
    ]);
  } else if (m[2]!.includes('@')) {
    problems.push(['url', 'Put credentials in a header, not in the URL']);
  }

  const seen = new Set<string>();
  d.headers.forEach((h, i) => {
    const k = h.key.toLowerCase();
    if (seen.has(k)) problems.push([`headers.${i}.key`, `Header "${h.key}" is set twice`]);
    seen.add(k);
    if (FORBIDDEN_HEADERS.has(k))
      problems.push([
        `headers.${i}.key`,
        `Header "${h.key}" is set by the server and cannot be changed`,
      ]);
    if (k === 'content-type' && d.payloadType === 'multipart/form-data')
      problems.push([
        `headers.${i}.key`,
        'Content-Type is set by the server for multipart/form-data',
      ]);
  });

  if (!hasBody) {
    if (d.body !== null && !(typeof d.body === 'object' && Object.keys(d.body).length === 0))
      problems.push(['body', `${d.method} requests cannot carry a payload`]);
    if (d.functionCode !== null)
      problems.push(['functionCode', `${d.method} requests have no payload to process`]);
    if (d.payloadType === 'multipart/form-data')
      problems.push(['payloadType', `${d.method} requests cannot use multipart/form-data`]);
  } else if (d.payloadType === 'multipart/form-data') {
    if (d.body !== null && Array.isArray(d.body))
      problems.push(['body', 'Form data must be an object of field names and text values']);
    else if (d.body !== null && Object.values(d.body).some((v) => typeof v !== 'string'))
      problems.push(['body', 'Every form field value must be text']);
    if (d.functionCode !== null)
      problems.push(['functionCode', 'A processing function works on JSON payloads only']);
  }
  if (d.body !== null && JSON.stringify(d.body).length > API_LIBRARY_BODY_MAX_BYTES)
    problems.push(['body', 'The payload is too large']);
  if (
    d.functionCode !== null &&
    !/\bfunction\s+processPayload\s*\(|\bprocessPayload\s*=/.test(d.functionCode)
  )
    problems.push(['functionCode', 'The code must define function processPayload(payload)']);

  const paths = new Set<string>();
  d.mapping.forEach((m, i) => {
    if (paths.has(m.path)) problems.push([`mapping.${i}.path`, `"${m.path}" is mapped twice`]);
    paths.add(m.path);
  });
  return problems;
}

export const apiLibraryDefinitionObject = z.object(definitionFields);

/** Attaches `apiLibraryDefinitionProblems` to a zod object that has all the definition fields. */
export function withApiLibraryDefinitionRules<T extends z.ZodTypeAny>(
  schema: T,
): z.ZodEffects<T, z.output<T>, z.input<T>> {
  return schema.superRefine((v, ctx) => {
    for (const [path, message] of apiLibraryDefinitionProblems(v as ApiLibraryDefinitionShape))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
        message,
      });
  }) as z.ZodEffects<T, z.output<T>, z.input<T>>;
}

export const apiLibraryNameSchema = z
  .string()
  .trim()
  .min(1, 'API name is required')
  .max(API_LIBRARY_NAME_MAX)
  .regex(API_LIBRARY_NAME_RE, 'Use letters, numbers and underscores only');

/** Create. The name is permanent (flows reference `{{Name.field}}`), so update has no name. */
export const createApiLibraryApiSchema = withApiLibraryDefinitionRules(
  z.object({ name: apiLibraryNameSchema, ...definitionFields }),
);
export type CreateApiLibraryApiInput = z.infer<typeof createApiLibraryApiSchema>;

/** Update replaces the whole definition (the form sends all of it) and carries the optimistic lock. */
export const updateApiLibraryApiSchema = withApiLibraryDefinitionRules(
  z.object({ ...definitionFields, rowVersion: z.number().int().positive() }),
);
export type UpdateApiLibraryApiInput = z.infer<typeof updateApiLibraryApiSchema>;
