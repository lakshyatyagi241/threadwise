import { API_LIBRARY_METHODS, type ApiLibraryMethod } from '@crm/contracts';
import type { ImportedRequest } from './form-model';

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

const DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
]);
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
    else if (t === '-F' || t === '--form') {
      const f = next();
      const at = f.indexOf('=');
      if (at > 0) form.push([f.slice(0, at), f.slice(at + 1)]);
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
  const hasPayload = data.length > 0 || form.length > 0;
  let verb = method ?? (hasPayload && !getMode ? 'POST' : 'GET');
  if (!API_LIBRARY_METHODS.includes(verb as ApiLibraryMethod)) verb = 'GET';

  if (getMode && data.length > 0) {
    // -G puts the data in the query string instead of the body.
    url += (url.includes('?') ? '&' : '?') + data.join('&');
    data.length = 0;
  }

  if (form.length > 0) {
    // The server sets the multipart Content-Type (with its boundary), so it must not stay among the headers.
    return {
      method: verb as ApiLibraryMethod,
      url,
      headers: headers.filter((h) => h.key.toLowerCase() !== 'content-type'),
      body: Object.fromEntries(form),
      payloadType: 'multipart/form-data',
    };
  }

  let body: unknown = undefined;
  if (data.length > 0) {
    const raw = data.join('&');
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
  };
}
