/**
 * Header text helpers for inbound mail: RFC 2047 encoded words ("=?UTF-8?B?...?=") and RFC 5322 address lists. Gmail returns header values as
 * they were sent, so a subject or a display name can still be encoded. Pure functions: no I/O, never throw.
 */

export interface ParsedAddress {
  name: string | null;
  address: string;
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase() === 'utf8' ? 'utf-8' : charset, {
      fatal: false,
    }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

/** Decodes the Q form: `_` is a space, `=XX` a byte. */
function decodeQ(text: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '_') out.push(0x20);
    else if (ch === '=' && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(ch.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** Decodes every encoded word in a header value; whitespace between two adjacent encoded words is dropped (RFC 2047 6.2). */
export function decodeWords(value: string): string {
  if (!value.includes('=?')) return value;
  const joined = value.replace(/(\?=)\s+(?==\?)/g, '$1');
  return joined.replace(ENCODED_WORD, (whole, charset: string, enc: string, text: string) => {
    try {
      const cs = charset.split('*')[0]!;
      const bytes = enc.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : decodeQ(text);
      return decodeBytes(bytes, cs);
    } catch {
      return whole;
    }
  });
}

/** Splits at commas that are not inside quotes, angle brackets, parentheses or a group. */
function splitList(value: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthParen = 0;
  let quoted = false;
  let current = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (quoted) {
      current += ch;
      if (ch === '\\' && i + 1 < value.length) {
        current += value[i + 1]!;
        i += 1;
      } else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '<') depthAngle += 1;
    else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
    else if (ch === '(') depthParen += 1;
    else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    if ((ch === ',' || ch === ';') && depthAngle === 0 && depthParen === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return t;
}

/** One `Name <addr>` / `addr` / `"Name" <addr>` entry, or null when no usable address is in it. */
function parseOne(entry: string): ParsedAddress | null {
  const angle = entry.match(/<([^<>]*)>\s*$/);
  let address: string;
  let rawName: string;
  if (angle) {
    address = angle[1]!.trim();
    rawName = entry.slice(0, angle.index).trim();
  } else {
    // "addr (Comment)" or bare "addr".
    const comment = entry.match(/^(\S+)\s*\(([^)]*)\)\s*$/);
    address = (comment ? comment[1]! : entry).trim();
    rawName = comment ? comment[2]! : '';
  }
  // A "mailto:" prefix or a route (`@a,@b:user@host`) is not an address we keep.
  address = address.replace(/^mailto:/i, '').replace(/^.*:(?=[^:]*@)/, '');
  if (!EMAIL_RE.test(address)) return null;
  const name = decodeWords(unquote(rawName)).replace(/\s+/g, ' ').trim();
  return { name: name || null, address: address.toLowerCase() };
}

/** Parses a To / Cc / From header into addresses (lower-cased, duplicates dropped). Garbage entries are skipped. */
export function parseAddressList(value: string | null | undefined): ParsedAddress[] {
  if (!value) return [];
  // A group ("Team: a@x.com, b@x.com;") loses its label and keeps its members.
  const flat = value.replace(/(^|,)\s*[^<>@",;:]+:\s*(?=[^;]*;)/g, '$1 ');
  const seen = new Set<string>();
  const out: ParsedAddress[] = [];
  for (const entry of splitList(flat)) {
    const parsed = parseOne(entry);
    if (!parsed || seen.has(parsed.address)) continue;
    seen.add(parsed.address);
    out.push(parsed);
  }
  return out;
}

/** The first address of a header, or null. */
export function parseFirstAddress(value: string | null | undefined): ParsedAddress | null {
  return parseAddressList(value)[0] ?? null;
}

/** Message ids from `In-Reply-To` / `References`: the `<...>` tokens without the brackets, in order, duplicates dropped. */
export function parseMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const m of value.matchAll(/<([^<>\s]+)>/g)) {
    if (!ids.includes(m[1]!)) ids.push(m[1]!);
  }
  return ids;
}

/** A header value with its parameters: `text/plain; charset="utf-8"` -> value + `{ charset: 'utf-8' }`. */
export function parseHeaderParams(value: string | null | undefined): {
  value: string;
  params: Record<string, string>;
} {
  if (!value) return { value: '', params: {} };
  const [first, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const piece of rest) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const key = piece.slice(0, eq).trim().toLowerCase();
    params[key] = unquote(piece.slice(eq + 1));
  }
  return { value: (first ?? '').trim().toLowerCase(), params };
}
