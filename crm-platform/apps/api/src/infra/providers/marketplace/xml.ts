/**
 * A small, safe XML reader for what a portal's sender posts (99acres-style XML). It turns a document into plain JSON-like values and
 * nothing else: no DTD, no entity beyond the five predefined ones and numeric references, no external reference of any kind, so there is
 * nothing to expand and nothing to fetch (the two classic attacks on an XML endpoint, entity expansion and external entities, have no
 * foothold). A document that declares a DOCTYPE or an ENTITY is refused outright. Depth, node count and attribute count are capped.
 *
 * Shape of the result:
 *  - an element with only text is that text (trimmed);
 *  - an element with attributes or children is an object: attributes first (`<lead id="5">` gives `id: "5"`), then children by name; a
 *    name that repeats becomes an array; text mixed with them is `_text`;
 *  - namespace prefixes are dropped (`ns:name` is `name`), `xmlns` attributes are ignored, comments and processing instructions vanish.
 *
 * The document element is returned as `{ [name]: value }`; `unwrapXmlDocument` turns that into the lead (or the list of leads).
 */

export class XmlError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'XmlError';
  }
}

const MAX_DEPTH = 24;
const MAX_NODES = 5_000;
const MAX_ATTRIBUTES = 40;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `&amp;` and numeric references; any other `&name;` is left exactly as written (it is text, never a lookup). */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        // NUL and the other control characters are not text a lead can hold.
        if (!Number.isInteger(code) || code < 0x20 || code > 0x10ffff) return '';
        if (code >= 0xd800 && code <= 0xdfff) return '';
        return String.fromCodePoint(code);
      }
      return ENTITIES[body] ?? whole;
    },
  );
}

const localName = (n: string): string => {
  const i = n.lastIndexOf(':');
  return i === -1 ? n : n.slice(i + 1);
};

interface Open {
  name: string;
  attrs: Record<string, string>;
  children: Array<[string, unknown]>;
  text: string;
}

function valueOf(node: Open): unknown {
  const text = node.text.trim();
  const attrKeys = Object.keys(node.attrs);
  if (attrKeys.length === 0 && node.children.length === 0) return text;
  const out: Record<string, unknown> = {};
  for (const k of attrKeys) out[k] = node.attrs[k];
  for (const [k, v] of node.children) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (Object.prototype.hasOwnProperty.call(out, k)) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      out[k] = v;
    }
  }
  if (text) out._text = text;
  return out;
}

/** Where the `>` that closes a tag is, ignoring one inside a quoted attribute value. */
function tagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function readAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let count = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const name = m[1]!;
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    if (!NAME_RE.test(name)) throw new XmlError('bad_attribute');
    if (++count > MAX_ATTRIBUTES) throw new XmlError('too_many_attributes');
    const key = localName(name);
    if (FORBIDDEN_KEYS.has(key)) continue;
    attrs[key] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  // Whatever is left over besides whitespace is not an attribute (a bare word, an unquoted value): not XML.
  if (raw.replace(re, '').trim() !== '') throw new XmlError('bad_attribute');
  return attrs;
}

/** Parses one document. Throws `XmlError` with a short reason for anything that is not well-formed or is refused. */
export function parseXml(input: string): Record<string, unknown> {
  const s = input.replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(s)) throw new XmlError('doctype_refused');

  const stack: Open[] = [];
  let root: { name: string; value: unknown } | null = null;
  let nodes = 0;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      if (s.slice(i).trim() !== '' && !top) throw new XmlError('text_outside_root');
      if (top) top.text += decodeEntities(s.slice(i));
      break;
    }
    if (lt > i) {
      const between = s.slice(i, lt);
      if (top) top.text += decodeEntities(between);
      else if (between.trim() !== '') throw new XmlError('text_outside_root');
    }
    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end === -1) throw new XmlError('unterminated_comment');
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      if (end === -1 || !top) throw new XmlError('bad_cdata');
      top.text += s.slice(lt + 9, end);
      i = end + 3;
    } else if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      if (end === -1) throw new XmlError('unterminated_instruction');
      i = end + 2;
    } else if (s.startsWith('</', lt)) {
      const end = s.indexOf('>', lt);
      if (end === -1) throw new XmlError('unterminated_tag');
      const name = localName(s.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open.name !== name) throw new XmlError('mismatched_tag');
      const value = valueOf(open);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push([open.name, value]);
      else if (root) throw new XmlError('multiple_roots');
      else root = { name: open.name, value };
      i = end + 1;
    } else if (s.startsWith('<!', lt)) {
      throw new XmlError('markup_declaration_refused');
    } else {
      const end = tagEnd(s, lt + 1);
      if (end === -1) throw new XmlError('unterminated_tag');
      let inner = s.slice(lt + 1, end);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const nameMatch = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      if (!nameMatch || !NAME_RE.test(nameMatch[1]!)) throw new XmlError('bad_tag');
      if (++nodes > MAX_NODES) throw new XmlError('too_many_nodes');
      if (stack.length >= MAX_DEPTH) throw new XmlError('too_deep');
      const open: Open = {
        name: localName(nameMatch[1]!),
        attrs: readAttributes(nameMatch[2]!),
        children: [],
        text: '',
      };
      if (selfClosing) {
        const value = valueOf(open);
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push([open.name, value]);
        else if (root) throw new XmlError('multiple_roots');
        else root = { name: open.name, value };
      } else {
        stack.push(open);
      }
      i = end + 1;
    }
  }
  if (stack.length > 0) throw new XmlError('unclosed_tag');
  if (!root) throw new XmlError('empty_document');
  return { [root.name]: root.value };
}

/**
 * The lead (or list of leads) inside a parsed document: the document element's content, and when that is a single list
 * (`<leads><lead/><lead/></leads>`) the list, or a single wrapper object (`<response><lead>..</lead></response>`) the object. A recipe that
 * knows its portal's wrapper reads it with a path instead; this is what the generic mapping gets.
 */
export function unwrapXmlDocument(doc: Record<string, unknown>): unknown {
  const rootName = Object.keys(doc)[0];
  if (rootName === undefined) return doc;
  const content = doc[rootName];
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return content;
  const keys = Object.keys(content as Record<string, unknown>);
  if (keys.length === 1) {
    const only = (content as Record<string, unknown>)[keys[0]!];
    if (Array.isArray(only)) return only;
    if (only !== null && typeof only === 'object') return only;
  }
  return content;
}
