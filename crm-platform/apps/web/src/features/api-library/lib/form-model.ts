import {
  API_LIBRARY_SECRET_MASK,
  apiLibraryDefinitionTokens,
  apiLibraryIsSensitiveName,
  apiLibraryMethodHasBody,
  apiLibraryTokensOf,
  createApiLibraryApiSchema,
  testApiLibraryApiSchema,
  updateApiLibraryApiSchema,
  type ApiLibraryBody,
  type ApiLibraryDetail,
  type ApiLibraryMethod,
  type ApiLibraryPayloadType,
  type ApiLibraryVariable,
  type CreateApiLibraryApiInput,
  type TestApiLibraryApiInput,
  type UpdateApiLibraryApiInput,
} from '@crm/contracts';
import type { ZodIssue } from 'zod';

/**
 * The create / edit form as the person sees it, and the translation to and from the contract. The form keeps text (the JSON
 * payload is a string until it is saved) and row ids (so a row keeps its identity while its neighbours move); the contract
 * wants parsed bodies and plain arrays. Everything here is pure so it is testable without a browser.
 */
export interface HeaderRow {
  id: string;
  key: string;
  value: string;
  secret: boolean;
}
export interface FieldRow {
  id: string;
  key: string;
  value: string;
}
export interface MappingRow {
  id: string;
  path: string;
  contactProperty: string;
  defaultValue: string;
}

export interface ApiFormState {
  name: string;
  method: ApiLibraryMethod;
  url: string;
  payloadType: ApiLibraryPayloadType;
  headers: HeaderRow[];
  /** The JSON payload as typed. Used when `payloadType` is JSON. */
  bodyText: string;
  /** The form-data fields. Used when `payloadType` is multipart/form-data. */
  fieldRows: FieldRow[];
  useFunction: boolean;
  functionCode: string;
  variables: ApiLibraryVariable[];
  mapping: MappingRow[];
  responseVariables: string[];
}

/** What the old console pre-filled in its function editor, kept as a starting point. */
export const DEFAULT_FUNCTION_CODE = `function processPayload(payload) { // Do not rename this function
  payload.status = "Updated"; // Add or change fields here
  return payload;
}`;

let seq = 0;
export const newRowId = (): string => `r${++seq}`;

export const emptyHeader = (): HeaderRow => ({ id: newRowId(), key: '', value: '', secret: false });
export const emptyField = (): FieldRow => ({ id: newRowId(), key: '', value: '' });
export const emptyMapping = (path = ''): MappingRow => ({
  id: newRowId(),
  path,
  contactProperty: '',
  defaultValue: '',
});

export function emptyForm(): ApiFormState {
  return {
    name: '',
    method: 'GET',
    url: '',
    payloadType: 'application/json',
    headers: [],
    bodyText: '',
    fieldRows: [],
    useFunction: false,
    functionCode: DEFAULT_FUNCTION_CODE,
    variables: [],
    mapping: [],
    responseVariables: [],
  };
}

// --- variables ---------------------------------------------------------------------------------------------------------------

/** A name with a dot reads another saved API's answer (`Orders.data.id`); everything else starts as a contact property. */
export const variableSourceOf = (name: string): ApiLibraryVariable['source'] =>
  hintedSources.get(name.toLowerCase()) ?? (name.includes('.') ? 'api' : 'contact');

/**
 * Where the person said a variable comes from, when they put it in from the menu: a name typed into the Flow variable box is a flow
 * variable, which its spelling alone cannot tell from a contact property. Kept by name for the session, so the variable is declared
 * with the source it was added with whichever field the token ends up in.
 */
const hintedSources = new Map<string, ApiLibraryVariable['source']>();
export function rememberVariableSource(name: string, source: ApiLibraryVariable['source']): void {
  hintedSources.set(name.trim().toLowerCase(), source);
}

/** Forgets what was remembered: a form that opens starts with no hints, so one API's choice never decides another's (and never outlives the form). */
export function forgetVariableSources(): void {
  hintedSources.clear();
}

/** The payload as a value, or undefined when the text is not a JSON object or array. */
/**
 * Quotes every `{{token}}` that stands alone as a JSON value (outside any string), as a string that starts with the raw mark, so the
 * text parses as JSON: `{"price": {{price}}}` becomes `{"price": "\u0001{{price}}"}`. A token inside a string is left as it is.
 */
export function quoteBareTokens(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      const inner = end < 0 ? '' : text.slice(i + 2, end);
      if (end >= 0 && inner.trim() !== '' && !/[{}"]/.test(inner)) {
        out += `"\\u0001{{${inner}}}"`;
        i = end + 1;
      } else out += c;
    } else out += c;
  }
  return out;
}

/** The JSON text of a saved payload, a raw token written back without its quotes. */
export function bodyToText(body: unknown): string {
  return JSON.stringify(body, null, 2).replace(/"\\u0001(\{\{[^{}]+?\}\})"/g, '$1');
}

function parsedBody(text: string): ApiLibraryBody | undefined {
  const t = text.trim();
  if (t === '') return null;
  try {
    const v: unknown = JSON.parse(quoteBareTokens(t));
    return v !== null && typeof v === 'object' ? (v as ApiLibraryBody) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The payload the form holds, whatever the method is: its value, or (text that is not JSON yet) the tokens scanned as plain text.
 * Multipart form fields are always a value.
 */
function heldPayload(state: ApiFormState): { body: ApiLibraryBody; textTokens: string[] } {
  if (state.payloadType === 'multipart/form-data') {
    const rows = state.fieldRows.filter((r) => r.key.trim() !== '');
    return { body: Object.fromEntries(rows.map((r) => [r.key.trim(), r.value])), textTokens: [] };
  }
  const parsed = parsedBody(state.bodyText);
  return parsed === undefined
    ? { body: null, textTokens: apiLibraryTokensOf(state.bodyText) }
    : { body: parsed, textTokens: [] };
}

/** Every `{{token}}` the request sends: the URL, the header values and, for a method that carries a payload, the payload. */
export function sentTokens(state: ApiFormState): string[] {
  const hasBody = apiLibraryMethodHasBody(state.method);
  const held = heldPayload(state);
  const out = apiLibraryDefinitionTokens({
    url: state.url,
    headers: state.headers
      .filter((h) => h.key.trim() !== '')
      .map((h) => ({ key: h.key, value: h.value, secret: h.secret })),
    body: hasBody ? held.body : null,
  });
  if (hasBody) for (const t of held.textTokens) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * Every `{{token}}` the form holds: the sent ones, and those in a payload the method does not send. A GET keeps its payload in the
 * form (only the request leaves it out), so the variables of that payload keep their defaults for when the method changes back.
 */
export function usedTokens(state: ApiFormState): string[] {
  const out = sentTokens(state);
  const held = heldPayload(state);
  const hidden = [
    ...apiLibraryDefinitionTokens({ url: '', headers: [], body: held.body }),
    ...held.textTokens,
  ];
  for (const t of hidden) if (!out.includes(t)) out.push(t);
  return out;
}

/** The declared variables the request sends. The others (used only by a payload the method does not send) stay in the form, hidden. */
export function sentVariables(state: ApiFormState): ApiLibraryVariable[] {
  const sent = new Set(sentTokens(state).map((t) => t.toLowerCase()));
  return state.variables.filter((v) => sent.has(v.name.toLowerCase()));
}

/** Writes the rows the form showed back into its variables. The hidden ones keep their values. */
export function withSentVariables(
  state: ApiFormState,
  shown: ApiLibraryVariable[],
): ApiLibraryVariable[] {
  const byName = new Map(shown.map((v) => [v.name.toLowerCase(), v]));
  return state.variables.map((v) => byName.get(v.name.toLowerCase()) ?? v);
}

/**
 * Declares every token in use (a new one starts with an empty default the person must fill in) and drops the ones no longer used.
 * An existing declaration keeps its default and source, matched ignoring case as the API does.
 */
export function syncVariables(state: ApiFormState): ApiFormState {
  const old = new Map(state.variables.map((v) => [v.name.toLowerCase(), v]));
  const next = usedTokens(state).map(
    (name): ApiLibraryVariable =>
      old.get(name.toLowerCase()) ?? {
        name,
        source: variableSourceOf(name),
        defaultValue: '',
      },
  );
  const same =
    next.length === state.variables.length && next.every((v, i) => v === state.variables[i]);
  return same ? state : { ...state, variables: next };
}

// --- form <-> contract -------------------------------------------------------------------------------------------------------

export function fromDetail(d: ApiLibraryDetail): ApiFormState {
  const isForm = d.payloadType === 'multipart/form-data';
  const body = d.body;
  return {
    name: d.name,
    method: d.method,
    url: d.url,
    payloadType: d.payloadType,
    headers: d.headers.map((h) => ({
      id: newRowId(),
      key: h.key,
      value: h.value,
      secret: h.secret,
    })),
    bodyText:
      !isForm &&
      body !== null &&
      !(typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)
        ? bodyToText(body)
        : '',
    fieldRows:
      isForm && body !== null && !Array.isArray(body)
        ? Object.entries(body).map(([key, value]) => ({
            id: newRowId(),
            key,
            value: typeof value === 'string' ? value : String(value ?? ''),
          }))
        : [],
    useFunction: d.functionCode !== null,
    functionCode: d.functionCode ?? DEFAULT_FUNCTION_CODE,
    variables: d.variables,
    mapping: d.mapping.map((m) => ({ id: newRowId(), ...m })),
    responseVariables: d.responseVariables,
  };
}

/** What the old console's "Import API's" produced from a cURL command (see curl.ts). */
/** A part of a pasted command that could not be imported (a file to upload): shown, never dropped without a word. */
export interface ImportNote {
  code: 'file';
  name: string;
}

export interface ImportedRequest {
  /** What of the command was left out. */
  skipped?: ImportNote[];
  method: ApiLibraryMethod;
  url: string;
  headers: Array<{ key: string; value: string }>;
  /** A JSON payload, or the raw text when it was not JSON. */
  body: unknown;
  payloadType: ApiLibraryPayloadType;
}

export function fromImport(i: ImportedRequest): ApiFormState {
  const base = emptyForm();
  const isForm = i.payloadType === 'multipart/form-data';
  const obj = i.body !== null && typeof i.body === 'object' && !Array.isArray(i.body);
  return syncVariables({
    ...base,
    method: i.method,
    url: i.url,
    payloadType: isForm ? 'multipart/form-data' : 'application/json',
    headers: i.headers.map((h) => ({
      id: newRowId(),
      key: h.key,
      value: h.value,
      secret: apiLibraryIsSensitiveName(h.key),
    })),
    bodyText:
      !isForm &&
      i.body !== undefined &&
      i.body !== null &&
      !(obj && Object.keys(i.body as object).length === 0)
        ? typeof i.body === 'string'
          ? i.body
          : JSON.stringify(i.body, null, 2)
        : '',
    fieldRows:
      isForm && obj
        ? Object.entries(i.body as Record<string, unknown>).map(([key, value]) => ({
            id: newRowId(),
            key,
            value: String(value ?? ''),
          }))
        : [],
  });
}

export type BodyProblem = 'json' | 'shape';

/** The payload the form holds as a contract value; or why the text is not one. */
export function bodyOf(state: ApiFormState): { body: ApiLibraryBody } | { problem: BodyProblem } {
  if (!apiLibraryMethodHasBody(state.method)) return { body: null };
  if (state.payloadType === 'multipart/form-data') {
    const rows = state.fieldRows.filter((r) => r.key.trim() !== '');
    return {
      body: rows.length === 0 ? null : Object.fromEntries(rows.map((r) => [r.key.trim(), r.value])),
    };
  }
  const t = state.bodyText.trim();
  if (t === '') return { body: null };
  let v: unknown;
  try {
    v = JSON.parse(quoteBareTokens(t));
  } catch {
    return { problem: 'json' };
  }
  if (v === null || typeof v !== 'object') return { problem: 'shape' };
  if (!Array.isArray(v) && Object.keys(v).length === 0) return { body: null };
  return { body: v as ApiLibraryBody };
}

/** Live feedback under the JSON editor. */
export function jsonStatus(text: string): 'empty' | 'valid' | 'invalid' | 'shape' {
  if (text.trim() === '') return 'empty';
  const r = bodyOf({ ...emptyForm(), method: 'POST', bodyText: text });
  if ('body' in r) return 'valid';
  return r.problem === 'json' ? 'invalid' : 'shape';
}

function definitionOf(state: ApiFormState) {
  const hasBody = apiLibraryMethodHasBody(state.method);
  const b = bodyOf(state);
  const payloadType: ApiLibraryPayloadType = hasBody ? state.payloadType : 'application/json';
  const rows = state.headers.filter((h) => h.key.trim() !== '');
  return {
    bodyProblem: 'problem' in b ? b.problem : null,
    headerRowIds: rows.map((h) => h.id),
    def: {
      method: state.method,
      url: state.url.trim(),
      payloadType,
      variables: sentVariables(state).map((v) => ({
        name: v.name,
        source: v.source,
        defaultValue: v.defaultValue,
      })),
      headers: rows.map((h) => ({ key: h.key.trim(), value: h.value, secret: h.secret })),
      body: 'body' in b ? b.body : null,
      functionCode:
        hasBody && payloadType === 'application/json' && state.useFunction
          ? state.functionCode
          : null,
      mapping: state.mapping
        .filter((m) => m.path.trim() !== '' || m.contactProperty.trim() !== '')
        .map((m) => ({
          path: m.path.trim(),
          contactProperty: m.contactProperty.trim(),
          defaultValue: m.defaultValue,
        })),
      responseVariables: state.responseVariables,
    },
  };
}

export interface FormErrors {
  /** By field: `name`, `method`, `url`, `body`, `functionCode`, `payloadType`, `header:<rowId>`, `variable:<name>`, `mapping:<rowId>` (the path), `mappingProperty:<rowId>` (the contact property). */
  fields: Record<string, string>;
  /** Problems with no single field (shown above the buttons). */
  general: string[];
}
export const noErrors = (): FormErrors => ({ fields: {}, general: [] });

function mapIssues(issues: ZodIssue[], state: ApiFormState, headerRowIds: string[]): FormErrors {
  const out = noErrors();
  const mappingRows = state.mapping.filter(
    (m) => m.path.trim() !== '' || m.contactProperty.trim() !== '',
  );
  const put = (key: string, message: string) => {
    if (!(key in out.fields)) out.fields[key] = message;
  };
  for (const issue of issues) {
    const [head, idx, leaf] = issue.path;
    const n = typeof idx === 'number' ? idx : -1;
    if (head === 'headers' && n >= 0 && headerRowIds[n])
      put(`header:${headerRowIds[n]}`, issue.message);
    else if (head === 'variables' && n >= 0 && state.variables[n])
      put(`variable:${state.variables[n]!.name.toLowerCase()}`, issue.message);
    else if (head === 'variables') out.general.push(issue.message);
    else if (head === 'mapping' && n >= 0 && mappingRows[n])
      put(
        `${leaf === 'contactProperty' ? 'mappingProperty' : 'mapping'}:${mappingRows[n]!.id}`,
        issue.message,
      );
    else if (head === 'responseVariables') out.general.push(issue.message);
    else if (
      typeof head === 'string' &&
      ['name', 'method', 'url', 'body', 'functionCode', 'payloadType'].includes(head)
    )
      put(head, issue.message);
    else out.general.push(leaf ? `${String(head)}: ${issue.message}` : issue.message);
  }
  return out;
}

export type Built<T> = { ok: true; input: T } | { ok: false; errors: FormErrors };

/**
 * Where JSON text stops making sense, as a 1-based line and column, or null when the text parses (or the engine names no place:
 * then the end of the text is the best guess, which is what "unexpected end" means).
 */
export function jsonErrorAt(text: string): { line: number; column: number } | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    const ff = /line (\d+) column (\d+)/.exec(m);
    if (ff) return { line: Number(ff[1]), column: Number(ff[2]) };
    const at = /position (\d+)/.exec(m);
    const pos = Math.min(at ? Number(at[1]) : text.length, text.length);
    const before = text.slice(0, pos).split('\n');
    return { line: before.length, column: before[before.length - 1]!.length + 1 };
  }
}

/** The one sentence for a payload that is not JSON: says where it breaks. */
export function jsonProblemMessage(text: string): string {
  const at = jsonErrorAt(text.trim());
  return at
    ? `This is not valid JSON (it breaks near line ${at.line}, column ${at.column}).`
    : 'This is not valid JSON.';
}

function bodyErrors(problem: BodyProblem, text: string): FormErrors {
  return {
    fields: {
      body:
        problem === 'json'
          ? jsonProblemMessage(text)
          : 'The payload must be a JSON object or list.',
    },
    general: [],
  };
}

/** The create body, or the problems to show (the same shared rules the API runs again on save). */
export function buildCreate(state: ApiFormState): Built<CreateApiLibraryApiInput> {
  const d = definitionOf(state);
  if (d.bodyProblem) return { ok: false, errors: bodyErrors(d.bodyProblem, state.bodyText) };
  const r = createApiLibraryApiSchema.safeParse({ name: state.name, ...d.def });
  return r.success
    ? { ok: true, input: r.data }
    : { ok: false, errors: mapIssues(r.error.issues, state, d.headerRowIds) };
}

export function buildUpdate(
  state: ApiFormState,
  rowVersion: number,
): Built<UpdateApiLibraryApiInput> {
  const d = definitionOf(state);
  if (d.bodyProblem) return { ok: false, errors: bodyErrors(d.bodyProblem, state.bodyText) };
  const r = updateApiLibraryApiSchema.safeParse({ ...d.def, rowVersion });
  return r.success
    ? { ok: true, input: r.data }
    : { ok: false, errors: mapIssues(r.error.issues, state, d.headerRowIds) };
}

/** The test body. `apiId` lets a header held as the mask use the stored secret (same address only). */
export function buildTest(state: ApiFormState, apiId?: string): Built<TestApiLibraryApiInput> {
  const d = definitionOf(state);
  if (d.bodyProblem) return { ok: false, errors: bodyErrors(d.bodyProblem, state.bodyText) };
  const r = testApiLibraryApiSchema.safeParse({
    ...d.def,
    ...(state.name.trim() !== '' ? { name: state.name.trim() } : {}),
    ...(apiId ? { apiId } : {}),
  });
  return r.success
    ? { ok: true, input: r.data }
    : { ok: false, errors: mapIssues(r.error.issues, state, d.headerRowIds) };
}

/** Changes in what is sent invalidate a test run; mapping and response variables do not (they only read the answer). */
export function requestSignature(state: ApiFormState): string {
  const d = definitionOf(state);
  return JSON.stringify({
    ...d.def,
    mapping: undefined,
    responseVariables: undefined,
    bodyText: state.bodyText,
  });
}

/** Everything the form holds, for the unsaved-changes guard. */
export function fullSignature(state: ApiFormState): string {
  return JSON.stringify({
    name: state.name,
    method: state.method,
    url: state.url,
    payloadType: state.payloadType,
    headers: state.headers.map(({ key, value, secret }) => ({ key, value, secret })),
    bodyText: state.bodyText,
    fieldRows: state.fieldRows.map(({ key, value }) => ({ key, value })),
    useFunction: state.useFunction,
    functionCode: state.functionCode,
    variables: state.variables,
    mapping: state.mapping.map(({ path, contactProperty, defaultValue }) => ({
      path,
      contactProperty,
      defaultValue,
    })),
    responseVariables: state.responseVariables,
  });
}

// --- secrets -----------------------------------------------------------------------------------------------------------------

export const isMasked = (value: string): boolean => value === API_LIBRARY_SECRET_MASK;

/** `scheme://host:port` of a URL template (tokens left as typed), or null when it does not start like a URL. */
export function originOf(url: string): string | null {
  const m = /^(https?):\/\/([^\s/?#]*)/i.exec(url.trim());
  return m ? `${m[1]!.toLowerCase()}://${m[2]!.toLowerCase()}` : null;
}

/**
 * A secret kept as the mask stays with the address it was saved for; pointing the API at another host means typing it again (the
 * API answers 422 / `invalid` otherwise). True when that is about to happen, so the form can say so before the person saves.
 */
export function keptSecretsAtRisk(savedUrl: string, state: ApiFormState): boolean {
  const before = originOf(savedUrl);
  const after = originOf(state.url);
  if (before === null || after === null || before === after) return false;
  return state.headers.some((h) => h.secret && isMasked(h.value));
}

/** A header is secret when ticked or when its name reads like one (the API decides the same way). */
export const headerIsSecret = (h: Pick<HeaderRow, 'key' | 'secret'>): boolean =>
  h.secret || apiLibraryIsSensitiveName(h.key);

/**
 * A password-like header (an Authorization header, an API key, or one ticked secret) going to a plain `http://` address would cross
 * the network readable by anyone on the way. True when the form is about to do that; it only warns, because some servers on a
 * private network have no https.
 */
export function secretOverPlainHttp(state: ApiFormState): boolean {
  if (!/^http:\/\//i.test(state.url.trim())) return false;
  return state.headers.some((h) => h.key.trim() !== '' && headerIsSecret(h));
}
