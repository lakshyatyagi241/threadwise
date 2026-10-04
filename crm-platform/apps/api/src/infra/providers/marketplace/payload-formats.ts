import type { InboundDelivery } from '@crm/contracts';
import { parseXml, unwrapXmlDocument, XmlError } from './xml';

/**
 * What a portal's sender can send to a connection's address, and how each is read into the plain JSON value the recipe's mapping works on:
 *  - `json`: a JSON document (an object or a list of objects);
 *  - `form`: `application/x-www-form-urlencoded`, with nested keys (`lead[phone]=1`, `items[]=a`, `a[b][c]=1`);
 *  - `xml`: one XML document (see ./xml.ts for what is refused and how it becomes a value);
 *  - `query`: the URL's query string, read like a form (a GET delivery, which is how JustDial's sender works).
 * Multipart bodies are never read. Everything here is pure: bytes in, value or a reason out.
 */

export type InboundFormat = InboundDelivery['formats'][number];
export type InboundMethod = InboundDelivery['methods'][number];

export interface RawDelivery {
  method: string;
  contentType: string | undefined;
  /** The request body (empty for a GET). */
  body: Buffer;
  /** The URL's query string without the `?`. */
  query: string;
}

export type FormatGuess = InboundFormat | 'multipart' | 'empty';

/**
 * What a delivery is, from its method, its Content-Type and (a sender with a wrong or missing Content-Type is common) its first
 * character. A GET is always the query string; a body-less POST with a query string is read as that too.
 */
export function guessFormat(d: RawDelivery): FormatGuess {
  if (d.method === 'GET') return d.query.trim() === '' ? 'empty' : 'query';
  const type = (d.contentType ?? '').toLowerCase();
  if (type.includes('multipart/')) return 'multipart';
  if (type.includes('json')) return 'json';
  if (type.includes('x-www-form-urlencoded')) return 'form';
  if (type.includes('xml')) return 'xml';
  const text = d.body
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (text === '') return d.query.trim() === '' ? 'empty' : 'query';
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  if (text.startsWith('<')) return 'xml';
  if (text.includes('=')) return 'form';
  return 'json';
}

// --- forms and query strings -----------------------------------------------------------------------------------------------------------

const MAX_PAIRS = 200;
const MAX_KEY = 200;
const MAX_VALUE = 10_000;
const MAX_NESTING = 5;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

function decodeComponent(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** `a[b][0]` is `['a', 'b', '0']`; `a[]` is `['a', '']` (append). A key that is not shaped like that is one flat key. */
function keyPath(key: string): string[] {
  const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(key);
  if (!m || !m[2]) return [key];
  const segments = [m[1]!];
  for (const part of m[2].matchAll(/\[([^[\]]*)\]/g)) segments.push(part[1]!);
  return segments.length > MAX_NESTING ? [key] : segments;
}

type Bag = Record<string, unknown>;

/** The container a key's next segment goes into: the one already there, else a list when the next segment is `[]` or an index, else an object. */
function containerFor(existing: unknown, next: string | undefined): Bag | unknown[] {
  if (existing !== null && typeof existing === 'object') return existing as Bag | unknown[];
  return next === '' || /^\d{1,3}$/.test(next ?? '') ? [] : {};
}

const own = (bag: Bag, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined;

function put(root: Bag, segments: string[], value: string): void {
  let node: Bag | unknown[] = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const last = i === segments.length - 1;
    const next = segments[i + 1];
    if (FORBIDDEN.has(seg)) return;
    if (Array.isArray(node)) {
      // `items[]` appends and `items[2]` sets that place; a name inside a list is not a place.
      if (seg === '') {
        if (last) {
          node.push(value);
        } else {
          const child = containerFor(undefined, next);
          node.push(child);
          node = child;
        }
      } else if (/^\d{1,3}$/.test(seg)) {
        const at = Number(seg);
        if (last) {
          node[at] = value;
        } else {
          const child = containerFor(node[at] as unknown, next);
          node[at] = child;
          node = child;
        }
      } else {
        return;
      }
    } else if (last) {
      const prev = own(node, seg);
      // A name sent twice (`a=1&a=2`) is a list.
      node[seg] =
        prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      const child = containerFor(own(node, seg), next);
      node[seg] = child;
      node = child;
    }
  }
}

/** Reads `a=1&lead[name]=x&lead[phone]=2` into `{ a: '1', lead: { name: 'x', phone: '2' } }`. Returns null for text that is not a form. */
export function parseForm(text: string): Record<string, unknown> | null {
  const out: Bag = {};
  let pairs = 0;
  for (const piece of text.replace(/^\?/, '').split('&')) {
    if (piece === '') continue;
    if (++pairs > MAX_PAIRS) break;
    const eq = piece.indexOf('=');
    const rawKey = eq === -1 ? piece : piece.slice(0, eq);
    const rawValue = eq === -1 ? '' : piece.slice(eq + 1);
    const key = decodeComponent(rawKey);
    const value = decodeComponent(rawValue);
    if (key === null || value === null || key === '' || key.length > MAX_KEY) continue;
    put(out, keyPath(key), value.slice(0, MAX_VALUE));
  }
  return Object.keys(out).length === 0 ? null : out;
}

// --- reading -----------------------------------------------------------------------------------------------------------------------------

export type ReadResult = { ok: true; value: unknown } | { ok: false; reason: string };

const isContainer = (v: unknown): boolean => v !== null && typeof v === 'object';

/** The delivery as a value. `reason` is a short machine word (`invalid_json`, `invalid_xml:doctype_refused`, `empty`, `not_an_object`). */
export function readDelivery(format: InboundFormat, d: RawDelivery): ReadResult {
  switch (format) {
    case 'json': {
      const text = d.body.toString('utf8').replace(/^\uFEFF/, '');
      if (text.trim() === '') return { ok: false, reason: 'empty' };
      try {
        const value: unknown = JSON.parse(text);
        return isContainer(value) ? { ok: true, value } : { ok: false, reason: 'not_an_object' };
      } catch {
        return { ok: false, reason: 'invalid_json' };
      }
    }
    case 'form': {
      const value = parseForm(d.body.toString('utf8'));
      return value ? { ok: true, value } : { ok: false, reason: 'empty' };
    }
    case 'query': {
      const value = parseForm(d.query);
      return value ? { ok: true, value } : { ok: false, reason: 'empty' };
    }
    case 'xml': {
      const text = d.body.toString('utf8');
      if (text.trim() === '') return { ok: false, reason: 'empty' };
      try {
        const value = unwrapXmlDocument(parseXml(text));
        return isContainer(value) ? { ok: true, value } : { ok: false, reason: 'not_an_object' };
      } catch (e) {
        if (e instanceof XmlError) return { ok: false, reason: `invalid_xml:${e.reason}` };
        throw e;
      }
    }
  }
}

/** A line for the connection's error, from a `reason` of `readDelivery`. */
export function describeReadFailure(format: InboundFormat, reason: string): string {
  if (reason === 'invalid_json') return 'The body is not valid JSON.';
  if (reason.startsWith('invalid_xml')) return 'The body is not valid XML.';
  if (reason === 'not_an_object')
    return `The ${format} delivery holds no lead (it is not an object or a list).`;
  if (reason === 'empty') return `The ${format} delivery is empty.`;
  return 'The delivery could not be read.';
}
