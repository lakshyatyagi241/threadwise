import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import {
  API_LIBRARY_SECRET_MASK,
  API_LIBRARY_TOKEN_RE,
  apiLibraryIsSensitiveName,
  type ApiLibraryBody,
  type ApiLibraryMapping,
  type ApiLibraryVariable,
} from '@crm/contracts';

/**
 * The rules of the API Library that need no database and no network: how variables are merged into a request, how the request is
 * written down for a log without its secrets, and how a response field is found by its path. Everything here is a pure function so
 * it is tested alone (test/unit/api-library).
 */

/** Variable values by lower-cased name. */
export type VariableValues = ReadonlyMap<string, string>;

const TOKEN_G = new RegExp(API_LIBRARY_TOKEN_RE.source, 'g');

// --- variables --------------------------------------------------------------------------------------------------------------

/**
 * The value of every declared variable. Order of precedence: an explicit override (a flow node's input, a test run's value), then
 * what the caller can look up (the run's variables, then the contact's property), then the default saved with the API. An empty
 * answer counts as no answer, so a blank contact property falls back to the default as the old console did.
 */
export async function resolveVariables(
  declared: readonly ApiLibraryVariable[],
  sources: {
    overrides?: Readonly<Record<string, string>>;
    lookup?: (name: string) => Promise<string | undefined | null> | string | undefined | null;
  } = {},
): Promise<Map<string, string>> {
  const overrides = new Map<string, string>();
  for (const [k, v] of Object.entries(sources.overrides ?? {})) overrides.set(k.toLowerCase(), v);
  const out = new Map<string, string>();
  for (const v of declared) {
    const key = v.name.toLowerCase();
    const given = overrides.get(key);
    if (given !== undefined && given !== '') {
      out.set(key, given);
      continue;
    }
    const found = sources.lookup ? await sources.lookup(v.name) : undefined;
    out.set(key, found !== undefined && found !== null && found !== '' ? found : v.defaultValue);
  }
  return out;
}

const valueOf = (values: VariableValues, raw: string): string =>
  values.get(raw.trim().toLowerCase()) ?? '';

/** Fills a header value or a body string. An undeclared token renders empty (the save rules make that unreachable). */
export function renderText(template: string, values: VariableValues): string {
  return template.replace(TOKEN_G, (_m, raw: string) => valueOf(values, raw));
}

/** Where the part of the URL that holds the host ends: tokens up to there are not percent-encoded, so `{{base_url}}/x` still works. */
function authorityEnd(template: string): number {
  const scheme = template.indexOf('://');
  const start = scheme >= 0 ? scheme + 3 : 0;
  const rest = template.slice(start).search(/[/?#]/);
  return rest < 0 ? template.length : start + rest;
}

/**
 * Fills the URL. A value placed in the host part goes in as typed; one in the path or the query string is percent-encoded, so a
 * contact called "A & B" cannot add a parameter or end the path.
 */
export function renderUrl(template: string, values: VariableValues): string {
  const hostEnd = authorityEnd(template);
  return template.replace(TOKEN_G, (_m, raw: string, offset: number) => {
    const v = valueOf(values, raw);
    return offset < hostEnd ? v : encodeURIComponent(v);
  });
}

/** Every string leaf of a JSON payload filled in; numbers, booleans and nulls stay as they are. */
export function renderBody(body: ApiLibraryBody, values: VariableValues): ApiLibraryBody {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return renderText(v, values);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  return body === null ? null : (walk(body) as ApiLibraryBody);
}

/** A header ready to send: the value is filled in and the plain text of a secret is still here (it never reaches a log). */
export interface OutHeader {
  key: string;
  value: string;
  secret: boolean;
}

export function renderHeaders(
  headers: ReadonlyArray<{ key: string; value: string; secret: boolean }>,
  values: VariableValues,
): OutHeader[] {
  return headers.map((h) => ({
    key: h.key,
    // A line break in a value would end the header: a contact whose name holds one must not be able to add another.
    value: renderText(h.value, values)
      .replace(/[\r\n]+/g, ' ')
      .trim(),
    secret: h.secret || apiLibraryIsSensitiveName(h.key),
  }));
}

/** The multipart body of text fields. */
export function buildMultipart(fields: Readonly<Record<string, string>>, boundary: string): string {
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name.replace(/["\r\n]/g, '_')}"\r\n\r\n${value}\r\n`,
  );
  return `${parts.join('')}--${boundary}--\r\n`;
}

// --- masking ----------------------------------------------------------------------------------------------------------------

export function maskHeaders(headers: readonly OutHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.key] = h.secret ? API_LIBRARY_SECRET_MASK : h.value;
  return out;
}

/** Masks the value of every query parameter that reads like a secret (`?api_key=...`). The rest of the URL is kept. */
export function maskUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const masked = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        /* keep the raw name */
      }
      return apiLibraryIsSensitiveName(name)
        ? `${pair.slice(0, eq)}=${API_LIBRARY_SECRET_MASK}`
        : pair;
    })
    .join('&');
  return `${url.slice(0, q + 1)}${masked}${hash < 0 ? '' : url.slice(hash)}`;
}

/** Masks the value of every key that reads like a secret, at any depth. */
export function maskJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((v) => maskJson(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        apiLibraryIsSensitiveName(k) && v !== null && typeof v !== 'object'
          ? API_LIBRARY_SECRET_MASK
          : maskJson(v, depth + 1),
      ]),
    );
  }
  return value;
}

// "…token…": "value" or a bare scalar; the key part may carry any text around the word. Used only when the text is JSON-shaped but cut
// (an answer larger than the log keeps), where the structure cannot be parsed.
const SECRET_PAIR =
  /("(?:[^"\\]|\\.)*(?:authorization|token|secret|password|passwd|api[-_ ]?key|cookie|credential|signature|bearer|private[-_ ]?key)(?:[^"\\]|\\.)*"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,}\]\s]+)/gi;

/**
 * A JSON text with its secret-looking keys masked. Text that parses is masked by key at any depth; JSON-shaped text that does not parse
 * (cut in the middle) is masked pair by pair; anything else is returned as is (it is cut by the caller).
 */
export function maskJsonText(text: string): string {
  try {
    return JSON.stringify(maskJson(JSON.parse(text)));
  } catch {
    return /^\s*[{[]/.test(text)
      ? text.replace(SECRET_PAIR, (_m, key: string) => `${key}"${API_LIBRARY_SECRET_MASK}"`)
      : text;
  }
}

/** The URL with every variable at its default: how the saved address reads when nothing else is known. */
export function urlWithDefaults(
  url: string,
  variables: ReadonlyArray<{ name: string; defaultValue: string }>,
): string {
  return renderUrl(url, new Map(variables.map((v) => [v.name.toLowerCase(), v.defaultValue])));
}

/** Whether two URLs point at the same scheme, host and port (a path or query may differ). False when either is not a URL. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

/** The response headers kept in a log: all of them, with cookies and anything secret-looking masked. */
export function maskResponseHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let n = 0;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || n >= 60) continue;
    n += 1;
    out[k] = apiLibraryIsSensitiveName(k)
      ? Array.isArray(v)
        ? v.map(() => API_LIBRARY_SECRET_MASK)
        : API_LIBRARY_SECRET_MASK
      : v;
  }
  return out;
}

// --- response paths ---------------------------------------------------------------------------------------------------------

type Seg = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'all' };

/** `data.items[0].name` -> key data, key items, index 0, key name. `[]` is every element. Null for a path that cannot be read. */
export function parsePath(path: string): Seg[] | null {
  const segs: Seg[] = [];
  for (const part of path.trim().split('.')) {
    const m = /^([^[\]]*)((?:\[\d*\])*)$/.exec(part);
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] !== '') segs.push({ kind: 'key', key: m[1]! });
    for (const b of m[2]!.matchAll(/\[(\d*)\]/g))
      segs.push(b[1] === '' ? { kind: 'all' } : { kind: 'index', index: Number(b[1]) });
  }
  return segs.length > 0 ? segs : null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Reads one field of a parsed response. `a.b[1].c` is one value; `a.b[].c` collects `c` of every element into a list. A numeric key
 * on a list reads the element (the old console wrote `data.1.name`). `found` is false when any step is missing.
 */
export function extractByPath(root: unknown, path: string): { found: boolean; value: unknown } {
  const segs = parsePath(path);
  if (!segs) return { found: false, value: undefined };
  const walk = (cur: unknown, i: number): { found: boolean; value: unknown } => {
    if (i === segs.length) return { found: true, value: cur };
    const seg = segs[i]!;
    if (seg.kind === 'all') {
      if (!Array.isArray(cur)) return { found: false, value: undefined };
      // `a[].b[]` is one flat list, not a list of lists.
      const nested = segs.slice(i + 1).some((x) => x.kind === 'all');
      const items: unknown[] = [];
      for (const el of cur) {
        const r = walk(el, i + 1);
        if (!r.found) continue;
        if (nested && Array.isArray(r.value)) items.push(...r.value);
        else items.push(r.value);
      }
      return { found: true, value: items };
    }
    if (seg.kind === 'index') {
      if (!Array.isArray(cur) || seg.index >= cur.length) return { found: false, value: undefined };
      return walk(cur[seg.index], i + 1);
    }
    if (Array.isArray(cur) && /^\d+$/.test(seg.key)) {
      const idx = Number(seg.key);
      return idx < cur.length ? walk(cur[idx], i + 1) : { found: false, value: undefined };
    }
    if (isObject(cur) && Object.prototype.hasOwnProperty.call(cur, seg.key))
      return walk(cur[seg.key], i + 1);
    return { found: false, value: undefined };
  };
  return walk(root, 0);
}

/** How a value is written into a contact property or a flow variable: lists of plain values are comma-joined, records are JSON. */
export function valueToText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (
    Array.isArray(v) &&
    v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))
  )
    return v.map((x) => valueToText(x)).join(', ');
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

export interface MappedValue {
  contactProperty: string;
  value: string;
  /** The answer had no usable value at the path, so the default was used. */
  fromDefault: boolean;
}

/** The contact property writes a response asks for. A path with no value and no default writes nothing. */
export function applyMapping(
  mapping: readonly ApiLibraryMapping[],
  response: unknown,
): MappedValue[] {
  const out: MappedValue[] = [];
  for (const m of mapping) {
    const hit = extractByPath(response, m.path);
    const text = hit.found ? valueToText(hit.value) : '';
    if (text.trim() !== '')
      out.push({ contactProperty: m.contactProperty, value: text, fromDefault: false });
    else if (m.defaultValue !== '')
      out.push({ contactProperty: m.contactProperty, value: m.defaultValue, fromDefault: true });
  }
  return out;
}

/** `{ "Orders.data.id": 42 }`: the response paths a flow reads as `{{ApiName.<path>}}`; a path the answer lacks is set empty. */
export function responseVariableValues(
  apiName: string,
  paths: readonly string[],
  response: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of paths) {
    const hit = extractByPath(response, p);
    out[`${apiName}.${p}`] = hit.found ? hit.value : '';
  }
  return out;
}

// --- reading an answer ---------------------------------------------------------------------------------------------------

const BINARY_TYPE =
  /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|x-7z|vnd\.|msword|wasm)/i;

/** Bytes a reader can show as text: a content type that is a file, or a NUL byte near the start, means it is not. */
export function looksBinary(contentType: string | null, bytes: Buffer): boolean {
  if (contentType && BINARY_TYPE.test(contentType.trim())) return true;
  return bytes.subarray(0, 8192).includes(0);
}

export interface ReadAnswer {
  /** What to show: the text, or one line naming what was not shown. */
  text: string;
  /** The answer is text (JSON can be read from it). */
  isText: boolean;
  /** The real size of the answer after any compression was undone. */
  sizeBytes: number;
}

/**
 * Turns the bytes of an answer into what the screen shows. A compressed answer (gzip, deflate, brotli: some servers send one
 * whatever was asked) is unpacked first, with the output held to `maxBytes`; a file (image, PDF, archive) is named, not printed as
 * symbols; the size is the bytes, not the length of a text made from them.
 */
export function readAnswer(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  maxBytes: number,
): ReadAnswer {
  const type = typeof headers['content-type'] === 'string' ? headers['content-type'] : null;
  const encoding = String(headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  let bytes = raw;
  let note = '';
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip')
      bytes = gunzipSync(raw, { maxOutputLength: maxBytes });
    else if (encoding === 'deflate') bytes = inflateSync(raw, { maxOutputLength: maxBytes });
    else if (encoding === 'br') bytes = brotliDecompressSync(raw, { maxOutputLength: maxBytes });
  } catch {
    note = ' (it could not be unpacked)';
    bytes = raw;
  }
  if (note !== '' || looksBinary(type, bytes)) {
    return {
      text: `[Not shown: ${type ?? 'binary data'}, ${bytes.length} bytes${note}]`,
      isText: false,
      sizeBytes: bytes.length,
    };
  }
  return { text: bytes.toString('utf8'), isText: true, sizeBytes: bytes.length };
}

// --- secrets the other server repeats back ---------------------------------------------------------------------------------

/** A value shorter than this is not worth hiding: it would also hit ordinary words in the reply. */
const MIN_SECRET_LENGTH = 4;

/**
 * The secret values this request carried: the value of every query parameter that reads like a secret, and every secret header's
 * value (for `Authorization: Bearer abc` also `abc` alone). A server that echoes its request (a debugging endpoint, an error page)
 * repeats them in its answer, which would otherwise be shown and stored in the clear.
 */
export function secretValuesOf(url: string, headers: readonly OutHeader[]): string[] {
  const out = new Set<string>();
  const add = (v: string) => {
    const t = v.trim();
    if (t.length >= MIN_SECRET_LENGTH) out.add(t);
  };
  const q = url.indexOf('?');
  if (q >= 0) {
    const hash = url.indexOf('#', q);
    for (const pair of url.slice(q + 1, hash < 0 ? undefined : hash).split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      let name = pair.slice(0, eq);
      let value = pair.slice(eq + 1);
      try {
        name = decodeURIComponent(name);
        value = decodeURIComponent(value);
      } catch {
        /* keep the raw text */
      }
      if (apiLibraryIsSensitiveName(name)) add(value);
    }
  }
  for (const h of headers) {
    if (!(h.secret || apiLibraryIsSensitiveName(h.key))) continue;
    add(h.value);
    const word = /^\s*(?:bearer|basic|token)\s+(.+)$/i.exec(h.value);
    if (word) add(word[1]!);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** `text` with every given secret (and its URL-encoded form) replaced by the mask. */
export function scrubSecretValues(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      if (form !== '') out = out.split(form).join(API_LIBRARY_SECRET_MASK);
    }
  }
  return out;
}

/** The same for a response's headers (a value or a list of values). */
export function scrubSecretHeaders(
  headers: Readonly<Record<string, string | string[]>>,
  secrets: readonly string[],
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? v.map((x) => scrubSecretValues(x, secrets))
        : scrubSecretValues(v, secrets),
    ]),
  );
}
