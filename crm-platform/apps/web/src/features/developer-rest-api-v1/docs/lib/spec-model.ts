import { PLACEHOLDER_KEY } from '../../lib/keys-model';

/**
 * The pure half of the public developer reference (WD-API-149): the customer API's OpenAPI document turned into what the page shows.
 * Nothing here touches the network or the DOM. The document is untrusted input (it comes over HTTP), so every read is defensive and a
 * malformed corner drops that corner, never the page.
 */

type Json = Record<string, unknown>;

/** The prefix every customer-API path carries in the document (the API serves the resources at `/api/v1/...`). */
const API_PREFIX = '/api/v1';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof METHODS)[number];
/** Within one path the verbs are listed create-first, as a reader meets them. */
const METHOD_RANK: Record<HttpMethod, number> = { post: 0, get: 1, put: 2, patch: 3, delete: 4 };
export const GENERAL_TAG = 'General';
const MAX_DEPTH = 6;

export interface ParamRow {
  name: string;
  /** `path`, `query`, `header` or `cookie`. */
  place: string;
  type: string;
  required: boolean;
  description: string;
}

export interface BodyField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ResponseView {
  code: string;
  description: string;
  /** From the document's own example, else built from the schema, else null (no schema, nothing honest to show). */
  example: unknown;
  hasExample: boolean;
}

export interface EndpointView {
  id: string;
  method: HttpMethod;
  /** The path as the document has it. */
  path: string;
  /** The part before the path: the muted `/api/v1` prefix (empty when the path does not carry it). */
  prefix: string;
  /** The path after the prefix, shown in full weight. */
  shortPath: string;
  url: string;
  summary: string;
  description: string;
  tag: string;
  params: ParamRow[];
  bodyType: string | null;
  bodyFields: BodyField[];
  requestExample: unknown;
  hasRequestExample: boolean;
  curl: string;
  responses: ResponseView[];
}

export interface GroupView {
  tag: string;
  id: string;
  description: string;
  endpoints: EndpointView[];
}

export interface ReferenceView {
  title: string;
  version: string;
  groups: GroupView[];
  endpointCount: number;
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Follows a local `#/a/b/c` pointer. An unknown or external pointer resolves to an empty schema, never a throw. */
export function resolveRef(node: unknown, spec: unknown, seen = 0): Json {
  if (!isObj(node)) return {};
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  if (seen > 8 || !ref.startsWith('#/')) return {};
  let cur: unknown = spec;
  for (const part of ref.slice(2).split('/')) {
    cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
  }
  return resolveRef(cur, spec, seen + 1);
}

/** A schema with `allOf` flattened: properties and required lists merged, other keys kept from the first part that sets them. */
function flatten(schema: unknown, spec: unknown, depth = 0): Json {
  const s = resolveRef(schema, spec);
  if (!Array.isArray(s.allOf) || depth > MAX_DEPTH) return s;
  const merged: Json = { ...s };
  delete merged.allOf;
  const props: Json = isObj(s.properties) ? { ...s.properties } : {};
  const required: string[] = Array.isArray(s.required) ? s.required.map(String) : [];
  for (const part of s.allOf) {
    const p = flatten(part, spec, depth + 1);
    if (isObj(p.properties)) Object.assign(props, p.properties);
    if (Array.isArray(p.required)) required.push(...p.required.map(String));
    for (const [k, v] of Object.entries(p))
      if (!(k in merged) && k !== 'properties' && k !== 'required') merged[k] = v;
  }
  if (Object.keys(props).length) merged.properties = props;
  if (required.length) merged.required = [...new Set(required)];
  return merged;
}

/** The one type word shown for a schema: `array<string>`, `string (date-time)`, `object`; `string` when the schema says nothing. */
export function typeOf(schema: unknown, spec: unknown): string {
  const s = flatten(schema, spec);
  let t = s.type;
  if (Array.isArray(t)) t = t.find((x) => x !== 'null') ?? t[0];
  if (t === 'array') {
    const inner = isObj(s.items) ? typeOf(s.items, spec) : 'any';
    return `array<${inner}>`;
  }
  if (typeof t === 'string') return typeof s.format === 'string' ? `${t} (${s.format})` : t;
  if (isObj(s.properties)) return 'object';
  const alt = (Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : [])[0];
  return alt ? typeOf(alt, spec) : 'string';
}

/** The allowed values of an enum schema as ` (a, b)`, or an empty string. */
function enumHint(schema: unknown, spec: unknown): string {
  const s = flatten(schema, spec);
  return Array.isArray(s.enum) && s.enum.length ? ` (${s.enum.map(String).join(', ')})` : '';
}

function describe(schema: unknown, spec: unknown): string {
  return `${str(flatten(schema, spec).description).trim()}${enumHint(schema, spec)}`.trim();
}

/** A believable value for a property, chosen from its name first, then its format and type. */
function valueFor(key: string, schema: Json): unknown {
  const k = key.toLowerCase();
  const t = Array.isArray(schema.type)
    ? (schema.type.find((x) => x !== 'null') ?? schema.type[0])
    : schema.type;
  const format = str(schema.format);
  if (format === 'date-time') return '2026-06-13T10:24:00Z';
  if (format === 'date') return '2026-06-13';
  if (format === 'uuid') return '0192f1c4-7a52-7d3e-9c1b-3f4a5b6c7d8e';
  if (format === 'email' || k.includes('email')) return 'jane@example.com';
  if (format === 'uri' || format === 'url' || k.includes('url'))
    return 'https://example.com/image.jpg';
  if (t === 'string') {
    if (k === 'to' || k.includes('phone') || k.includes('mobile')) return '919812345678';
    if (k === 'first_name') return 'Jane';
    if (k === 'last_name') return 'Doe';
    if (k.includes('name')) return 'Acme Corp';
    if (k.includes('language')) return 'en_US';
    if (k.includes('timezone')) return 'Asia/Kolkata';
    if (k.includes('text') || k.includes('message') || k === 'body') return 'Hello';
    if (k.endsWith('_at') || k.includes('date')) return '2026-06-13T10:24:00Z';
    return 'string';
  }
  if (t === 'integer' || t === 'number')
    return typeof schema.minimum === 'number' ? schema.minimum : 1;
  if (t === 'boolean') return true;
  return 'string';
}

/** An example value for a schema: its own `example`/`default`/first enum value, else built from its shape. `undefined` for nothing. */
export function sampleFor(schema: unknown, spec: unknown, key = '', depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  const s = flatten(schema, spec);
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const alt = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
  if (alt && alt.length && !isObj(s.properties)) return sampleFor(alt[0], spec, key, depth + 1);
  let t = s.type;
  if (Array.isArray(t)) t = t.find((x) => x !== 'null') ?? t[0];
  if (isObj(s.properties) || t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(isObj(s.properties) ? s.properties : {})) {
      const v = sampleFor(prop, spec, name, depth + 1);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }
  if (t === 'array') {
    const item = sampleFor(s.items, spec, key, depth + 1);
    return item === undefined ? [] : [item];
  }
  return valueFor(key, s);
}

/** The documented content type of a request body: JSON first, then multipart, then url-encoded, else whatever the document has. */
export function pickBody(
  requestBody: unknown,
  spec: unknown,
): { type: string | null; schema: Json | null; example: unknown } {
  const rb = resolveRef(requestBody, spec);
  const content = isObj(rb.content) ? rb.content : null;
  if (!content) return { type: null, schema: null, example: undefined };
  const order = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'];
  const type = order.find((t) => t in content) ?? Object.keys(content)[0] ?? null;
  if (!type) return { type: null, schema: null, example: undefined };
  const media = resolveRef(content[type], spec);
  return {
    type,
    schema: isObj(media.schema) ? media.schema : null,
    example: exampleOfMedia(media, spec),
  };
}

/** `example`, else the first of `examples`, on a media object. */
function exampleOfMedia(media: Json, spec: unknown): unknown {
  if (media.example !== undefined) return media.example;
  if (isObj(media.examples)) {
    const first = Object.values(media.examples)[0];
    if (first !== undefined) {
      const ex = resolveRef(first, spec);
      if (ex.value !== undefined) return ex.value;
    }
  }
  return undefined;
}

const shellQuote = (s: string) => s.replace(/'/g, `'\\''`);

/** The copy-ready request: bearer header, and the body as `-d` (JSON), `-F` per field (multipart, files as `@path`) or `-d` (form). */
export function buildCurl(input: {
  method: string;
  url: string;
  bodyType: string | null;
  bodyExample: unknown;
  bodySchema: unknown;
  spec: unknown;
}): string {
  const lines = [`curl -X ${input.method.toUpperCase()} '${shellQuote(input.url)}' \\`];
  lines.push(`  -H 'Authorization: Bearer ${PLACEHOLDER_KEY}' \\`);
  const ex = input.bodyExample;
  const hasBody = isObj(ex) ? Object.keys(ex).length > 0 : ex !== undefined && ex !== null;
  if (hasBody && input.bodyType?.startsWith('multipart/') && isObj(ex)) {
    const props = flatten(input.bodySchema, input.spec).properties;
    for (const [k, v] of Object.entries(ex)) {
      const p = flatten(isObj(props) ? props[k] : undefined, input.spec);
      const isFile = p.format === 'binary' || p.format === 'base64';
      lines.push(`  -F '${shellQuote(`${k}=${isFile ? '@/path/to/file' : String(v)}`)}' \\`);
    }
  } else if (hasBody && input.bodyType === 'application/x-www-form-urlencoded' && isObj(ex)) {
    const form = new URLSearchParams(Object.entries(ex).map(([k, v]) => [k, String(v)])).toString();
    lines.push(`  -H 'Content-Type: application/x-www-form-urlencoded' \\`);
    lines.push(`  -d '${shellQuote(form)}'`);
  } else if (hasBody) {
    lines.push(`  -H 'Content-Type: application/json' \\`);
    lines.push(`  -d '${shellQuote(JSON.stringify(ex))}'`);
  }
  // The last line carries no continuation backslash.
  lines[lines.length - 1] = lines[lines.length - 1]!.replace(/ \\$/, '');
  return lines.join('\n');
}

function paramRows(params: unknown, spec: unknown): ParamRow[] {
  if (!Array.isArray(params)) return [];
  const rows: ParamRow[] = [];
  for (const raw of params) {
    const p = resolveRef(raw, spec);
    const name = str(p.name);
    if (!name) continue;
    const schema = p.schema;
    rows.push({
      name,
      place: str(p.in) || 'query',
      type: typeOf(schema, spec),
      required: p.required === true,
      description:
        `${str(p.description).trim() || str(flatten(schema, spec).description).trim()}${enumHint(schema, spec)}`.trim(),
    });
  }
  return rows;
}

function bodyFields(schema: unknown, spec: unknown): BodyField[] {
  const s = flatten(schema, spec);
  const props = isObj(s.properties) ? s.properties : {};
  const required = Array.isArray(s.required) ? s.required.map(String) : [];
  return Object.entries(props).map(([name, prop]) => ({
    name,
    type: typeOf(prop, spec),
    required: required.includes(name),
    description: describe(prop, spec),
  }));
}

function responseViews(responses: unknown, spec: unknown): ResponseView[] {
  if (!isObj(responses)) return [];
  return Object.keys(responses)
    .sort()
    .map((code) => {
      const r = resolveRef(responses[code], spec);
      const content = isObj(r.content) ? r.content : {};
      const type =
        'application/json' in content ? 'application/json' : (Object.keys(content)[0] ?? null);
      const media = type ? resolveRef(content[type], spec) : {};
      let example = exampleOfMedia(media, spec);
      if (example === undefined && isObj(media) && media.schema !== undefined)
        example = sampleFor(media.schema, spec);
      return {
        code,
        description: str(r.description).trim(),
        example,
        hasExample: example !== undefined,
      };
    });
}

/** Splits a document path into the muted prefix and the rest; the callable URL for it. */
export function locate(
  path: string,
  origin: string,
  baseUrl: string,
): { prefix: string; shortPath: string; url: string } {
  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
    return {
      prefix: API_PREFIX,
      shortPath: path.slice(API_PREFIX.length) || '/',
      url: `${origin.replace(/\/+$/, '')}${path}`,
    };
  }
  return { prefix: '', shortPath: path, url: `${baseUrl.replace(/\/+$/, '')}${path}` };
}

/** The tag text shown above a group: only the first paragraph, so long internal notes never leak. */
const firstParagraph = (s: string) =>
  s
    .split(/\n\s*\n/)[0]!
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Groups the document's operations by their first tag. Groups follow the document's own `tags` order (the server fixes it); a tag an
 * operation uses that the document does not list comes after, alphabetically; an operation with no tag goes to `General`, last.
 * Inside a group the order is path, then verb. A document that has no usable `paths` gives zero groups.
 */
export function buildReference(spec: unknown, origin: string): ReferenceView {
  const doc = isObj(spec) ? spec : {};
  const info = isObj(doc.info) ? doc.info : {};
  const baseUrl = `${origin.replace(/\/+$/, '')}${API_PREFIX}`;

  const declared: string[] = [];
  const overview = new Map<string, string>();
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags) {
      if (!isObj(t) || !str(t.name)) continue;
      const name = str(t.name);
      if (!declared.includes(name)) declared.push(name);
      const d = firstParagraph(str(t.description));
      if (d) overview.set(name, d);
    }
  }

  const byTag = new Map<string, EndpointView[]>();
  const paths = isObj(doc.paths) ? doc.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const tags = Array.isArray(op.tags)
        ? op.tags.filter((t): t is string => typeof t === 'string' && t !== '')
        : [];
      const tag = tags[0] ?? GENERAL_TAG;
      const where = locate(path, origin, baseUrl);
      const body = pickBody(op.requestBody, doc);
      const example =
        body.example !== undefined
          ? body.example
          : body.schema
            ? sampleFor(body.schema, doc)
            : undefined;
      const summary = str(op.summary).trim();
      const description = str(op.description).trim();
      const view: EndpointView = {
        id: `op-${method}-${slug(path)}`,
        method,
        path,
        ...where,
        summary,
        description: description === summary ? '' : description,
        tag,
        params: paramRows(
          [
            ...(Array.isArray(item.parameters) ? item.parameters : []),
            ...(Array.isArray(op.parameters) ? op.parameters : []),
          ],
          doc,
        ),
        bodyType: body.type,
        bodyFields: body.schema ? bodyFields(body.schema, doc) : [],
        requestExample: example,
        hasRequestExample: isObj(example) ? Object.keys(example).length > 0 : example !== undefined,
        curl: buildCurl({
          method,
          url: where.url,
          bodyType: body.type,
          bodyExample: example,
          bodySchema: body.schema,
          spec: doc,
        }),
        responses: responseViews(op.responses, doc),
      };
      byTag.set(tag, [...(byTag.get(tag) ?? []), view]);
    }
  }

  const extra = [...byTag.keys()]
    .filter((t) => !declared.includes(t) && t !== GENERAL_TAG)
    .sort((a, b) => a.localeCompare(b));
  const order = [
    ...declared,
    ...extra,
    ...(byTag.has(GENERAL_TAG) && !declared.includes(GENERAL_TAG) ? [GENERAL_TAG] : []),
  ];
  const groups: GroupView[] = [];
  for (const tag of order) {
    const endpoints = byTag.get(tag);
    if (!endpoints?.length) continue;
    endpoints.sort((a, b) =>
      a.path === b.path
        ? METHOD_RANK[a.method] - METHOD_RANK[b.method]
        : a.path.localeCompare(b.path),
    );
    groups.push({ tag, id: `grp-${slug(tag)}`, description: overview.get(tag) ?? '', endpoints });
  }
  return {
    title: str(info.title),
    version: str(info.version),
    groups,
    endpointCount: groups.reduce((n, g) => n + g.endpoints.length, 0),
  };
}

/** The endpoint matches when every word of the query appears in its method, path, summary or group name. An empty query matches all. */
export function endpointMatches(e: EndpointView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${e.method} ${e.path} ${e.summary} ${e.tag}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The reference narrowed to the matching endpoints; a group with none left is dropped. */
export function filterReference(ref: ReferenceView, query: string): ReferenceView {
  if (!query.trim()) return ref;
  const groups = ref.groups
    .map((g) => ({ ...g, endpoints: g.endpoints.filter((e) => endpointMatches(e, query)) }))
    .filter((g) => g.endpoints.length > 0);
  return { ...ref, groups, endpointCount: groups.reduce((n, g) => n + g.endpoints.length, 0) };
}

/** The brand name out of the document's title (`<brand> API`), for when the site settings are unreachable; empty when it has none. */
export function brandFromTitle(title: string): string {
  return title.replace(/\s+API$/i, '').trim();
}
