import { API_LIBRARY_METHODS, type ApiLibraryMethod } from '@crm/contracts';
import type { ImportNote, ImportedRequest } from './form-model';

/** Splits a command line the way a shell would: quotes group, a backslash escapes, a backslash-newline joins lines. */
export function shellSplit(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1]!))
        cur += text[++i];
      else cur += c;
    } else if (c === '$' && text[i + 1] === "'") {
      // Bash's $'...' quoting: \n, \t, \xHH and friends are turned into the characters they stand for.
      const read = ansiCQuoted(text, i + 2);
      cur += read.value;
      i = read.end;
      has = true;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur !== '') out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur !== '') out.push(cur);
  return out;
}

const ANSI_C_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  e: '\x1b',
  E: '\x1b',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
};

/** Reads the inside of a `$'...'` string that starts at `from`; `end` is the index of its closing quote. */
function ansiCQuoted(text: string, from: number): { value: string; end: number } {
  let value = '';
  let i = from;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") break;
    if (c !== '\\' || i + 1 >= text.length) {
      value += c;
      continue;
    }
    const n = text[++i]!;
    const hex = /^x[0-9a-fA-F]{1,2}/.exec(text.slice(i, i + 3));
    const uni = /^u[0-9a-fA-F]{1,4}/.exec(text.slice(i, i + 5));
    const oct = /^[0-7]{1,3}/.exec(text.slice(i, i + 3));
    if (hex) {
      value += String.fromCharCode(parseInt(hex[0].slice(1), 16));
      i += hex[0].length - 1;
    } else if (uni) {
      value += String.fromCharCode(parseInt(uni[0].slice(1), 16));
      i += uni[0].length - 1;
    } else if (oct) {
      value += String.fromCharCode(parseInt(oct[0], 8));
      i += oct[0].length - 1;
    } else value += ANSI_C_ESCAPES[n] ?? `\\${n}`;
  }
  return { value, end: i };
}

/** What curl's `--data-urlencode` makes of its argument (`name=content`, `=content`, `content`); a file (`@name`) is reported, not read. */
function urlencoded(arg: string, skipped: ImportNote[]): string {
  const enc = (v: string) =>
    encodeURIComponent(v).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const eq = arg.indexOf('=');
  const at = arg.indexOf('@');
  if (eq < 0 && at >= 0) {
    skipped.push({ code: 'file', name: arg.slice(0, at) || arg.slice(at + 1) });
    return '';
  }
  if (eq < 0) return enc(arg);
  const name = arg.slice(0, eq);
  return name === '' ? enc(arg.slice(eq + 1)) : `${name}=${enc(arg.slice(eq + 1))}`;
}

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii']);
const FLAGS_WITH_VALUE = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-u',
  '--user',
  '-b',
  '--cookie',
  '-F',
  '--form',
  '--form-string',
  '--data-urlencode',
  '--json',
  '--url',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-T',
  '--upload-file',
  ...DATA_FLAGS,
]);

const b64 = (s: string): string =>
  typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64');

/**
 * Reads a pasted `curl` command (the old console's "Import API's"): method, URL, headers, and a JSON or form-data payload.
 * Returns null when the text is not a curl command with an http(s) address.
 */
export function parseCurl(command: string): ImportedRequest | null {
  const tokens = shellSplit(command.trim());
  if (tokens[0] !== 'curl') return null;

  let method: string | null = null;
  let url = '';
  let getMode = false;
  const headers: Array<{ key: string; value: string }> = [];
  const data: string[] = [];
  const form: Array<[string, string]> = [];
  const skipped: ImportNote[] = [];
  let multipart = false;

  const setHeader = (key: string, value: string) => {
    const at = headers.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
    if (at >= 0) headers[at] = { key, value };
    else headers.push({ key, value });
  };

  for (let i = 1; i < tokens.length; i++) {
    let t = tokens[i]!;
    let inline: string | null = null;
    if (t.startsWith('--') && t.includes('=')) {
      inline = t.slice(t.indexOf('=') + 1);
      t = t.slice(0, t.indexOf('='));
    } else if (/^-[XHudFbAe]./.test(t) && !t.startsWith('--')) {
      inline = t.slice(2);
      t = t.slice(0, 2);
    }
    const next = (): string => inline ?? tokens[++i] ?? '';

    if (t === '-G' || t === '--get') getMode = true;
    else if (t === '-X' || t === '--request') method = next().toUpperCase();
    else if (t === '-H' || t === '--header') {
      const h = next();
      const at = h.indexOf(':');
      if (at > 0) setHeader(h.slice(0, at).trim(), h.slice(at + 1).trim());
    } else if (t === '-u' || t === '--user') setHeader('Authorization', `Basic ${b64(next())}`);
    else if (t === '-b' || t === '--cookie') setHeader('Cookie', next());
    else if (t === '-A' || t === '--user-agent') setHeader('User-Agent', next());
    else if (t === '--url') url = next();
    else if (DATA_FLAGS.has(t)) data.push(next());
    else if (t === '--data-urlencode') data.push(urlencoded(next(), skipped));
    else if (t === '--json') {
      data.push(next());
      setHeader('Content-Type', 'application/json');
      setHeader('Accept', 'application/json');
    } else if (t === '-F' || t === '--form' || t === '--form-string') {
      const f = next();
      multipart = true;
      const at = f.indexOf('=');
      if (at <= 0) continue;
      const value = f.slice(at + 1);
      // A file part (`name=@path`, `name=<path`) cannot be sent from here: it is said, not silently dropped.
      if (t !== '--form-string' && /^[@<]/.test(value))
        skipped.push({ code: 'file', name: f.slice(0, at) });
      else form.push([f.slice(0, at), value]);
    } else if (t === '-T' || t === '--upload-file') {
      next();
      method ??= 'PUT';
    } else if (t.startsWith('-')) {
      if (FLAGS_WITH_VALUE.has(t) && inline === null) i++;
    } else if (/^https?:\/\//i.test(t) && url === '') url = t;
  }
  if (!/^https?:\/\//i.test(url)) return null;

  const typeHeader =
    headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  const hasPayload = data.length > 0 || form.length > 0 || multipart;
  let verb = method ?? (hasPayload && !getMode ? 'POST' : 'GET');
  if (!API_LIBRARY_METHODS.includes(verb as ApiLibraryMethod)) verb = 'GET';

  if (getMode && data.length > 0) {
    // -G puts the data in the query string instead of the body.
    url += (url.includes('?') ? '&' : '?') + data.filter((d) => d !== '').join('&');
    data.length = 0;
  }

  if (multipart) {
    // The server sets the multipart Content-Type (with its boundary), so it must not stay among the headers.
    return {
      method: verb as ApiLibraryMethod,
      url,
      headers: headers.filter((h) => h.key.toLowerCase() !== 'content-type'),
      body: Object.fromEntries(form),
      payloadType: 'multipart/form-data',
      ...(skipped.length > 0 ? { skipped } : {}),
    };
  }

  let body: unknown = undefined;
  if (data.length > 0) {
    const raw = data.filter((d) => d !== '').join('&');
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return {
    method: verb as ApiLibraryMethod,
    url,
    headers: typeHeader.includes('multipart/form-data')
      ? headers.filter((h) => h.key.toLowerCase() !== 'content-type')
      : headers,
    body,
    payloadType: 'application/json',
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}
