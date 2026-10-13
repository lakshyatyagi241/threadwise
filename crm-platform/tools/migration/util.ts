import { createHash } from 'node:crypto';

/** Mongo ObjectId as read from Extended JSON. `toString()` is the 24-char hex. */
export class Oid {
  constructor(readonly hex: string) {}
  toString(): string {
    return this.hex;
  }
  toJSON(): string {
    return this.hex;
  }
  /** Seconds-resolution creation time embedded in the id. */
  get date(): Date {
    return new Date(parseInt(this.hex.slice(0, 8), 16) * 1000);
  }
}

export type Doc = Record<string, unknown>;

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

/** RFC 4122 v5 uuid. Deterministic ids make `ON CONFLICT (org_id, uuid)` a real idempotency key on every tenant table. */
const NS = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'); // the DNS namespace, reused on purpose
export function uuidv5(name: string): string {
  const h = createHash('sha1').update(NS).update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** A Mongo value as a Date: Date, ISO string, or epoch number (ms, or seconds when small). Null when unreadable. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (v instanceof Oid) return v.date;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const t = v.trim();
    const d = /^\d{9,13}$/.test(t) ? toDate(Number(t)) : new Date(t);
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }
  return null;
}

export const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'string' ? v : String(v)).trim();
  return s === '' ? null : s;
};

/** Mongo booleans in this data are sometimes the strings "true"/"1"/"yes" or the numbers 1/0. */
export function bool(v: unknown, dflt = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', '1', 'yes', 'y', 't'].includes(v.trim().toLowerCase());
  if (typeof v === 'number') return v !== 0;
  return dflt;
}

/** Soft delete as every collection in this data spells it: an is_deleted flag, or a deleted_time that is set. */
export function isDeleted(doc: Doc): boolean {
  if (bool(doc.is_deleted)) return true;
  const t = doc.deleted_time;
  return t !== undefined && t !== null && !(typeof t === 'string' && t.trim() === '');
}

/** Own-property assignment that is safe for keys like "__proto__" and "constructor". */
export function setOwn(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/**
 * ONE shared definition of "credential-looking", used for contacts.data, field definitions, quarantine docs and reports.
 *
 * NAMES are split into words (snake_case, kebab-case, camelCase alike: `normalKey` -> normal, key). A name is credential-looking when
 *  - some word CONTAINS token / secret / password / passwd / pwd / apikey / authkey / bearer / credential / privatekey / passphrase
 *    (so the all-lowercase compounds `authtoken`, `sessiontoken`, `bearertoken`, `AUTHTOKEN` and `pwd` are caught), or is jwt / oauth /
 *    authorization, or
 *  - it is api+key, private+key, auth+key, or a `key` word preceded by a qualifier (access_key, signing_key, session_key ...), or
 *  - it is on the always-secret list.
 * It is NOT when `key`, `auth` or `private` merely appear as an ordinary word (`key_account`, `primary_key`, `auth_status`, `private_notes`,
 * `keyword`, `author` are plain CRM data and are kept).
 * A credential-looking name drops the entry when its value is a string, object or array; numbers and booleans are kept (`tokens_used`,
 * `input_token_price` are counters and prices) unless the name is on the always-secret list.
 * VALUES are checked under any name: a string that IS a bearer token, a JWT, an OpenAI/Stripe/GitHub/Slack/AWS/Google/Meta key or a PEM
 * block drops the entry; the same tokens, `secret=value` pairs and PEM blocks inside longer free text are replaced by [redacted];
 * a string holding a JSON object is parsed and scrubbed recursively; a long opaque string under a name that hints at a credential is dropped.
 */
const COMPOUND =
  /(token|secret|password|passwd|pwd|apikey|authkey|bearer|credential|privatekey|passphrase)/;
const WHOLE_WORDS = new Set(['jwt', 'oauth', 'authorization']);
const KEY_QUALIFIERS = new Set([
  'api',
  'auth',
  'access',
  'secret',
  'private',
  'signing',
  'encryption',
  'normal',
  'openrouter',
  'openai',
  'license',
  'master',
  'service',
  'session',
  'client',
  'app',
  'webhook',
  'bearer',
  'x',
  'jwt',
  'refresh',
]);
/** Dropped whatever the value is. Compared with every non-alphanumeric removed and lower-cased. */
const ALWAYS_SECRET = new Set([
  'password',
  'passwd',
  'pwd',
  'authkey',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'apikey',
  'authorization',
  'bearer',
  'normalkey',
  'openrouterkey',
  'privatekey',
]);
/** Numeric counters and prices that merely contain the word "token": the NAME alone never drops them. */
const ALLOWED = new Set([
  'tokensused',
  'inputtokens',
  'outputtokens',
  'cachedinputtokens',
  'tokenusage',
  'tokencount',
]);
const compact = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

/** Words that hint at a credential; used with the long-opaque-string heuristic only. */
const HINT_WORDS = new Set([
  'key',
  'keys',
  'token',
  'tokens',
  'secret',
  'secrets',
  'pass',
  'password',
  'passwd',
  'pwd',
  'auth',
  'cred',
  'creds',
  'credential',
  'credentials',
  'private',
  'bearer',
  'apikey',
]);
/**
 * `password_changed_at`, `token_expiry`, `password_hint` ...: the LAST word says the field holds metadata about a credential, not the
 * credential. Such a field is kept when its value is a short, plain, non-secret-shaped string. (A `password_hint` is a hint a person
 * typed, not the password; if a hint can contain the password itself, rename it in the registry decision.)
 */
const METADATA_LAST = new Set([
  'hint',
  'changed',
  'expiry',
  'expires',
  'expiration',
  'expired',
  'at',
  'date',
  'time',
  'status',
  'type',
  'count',
  'length',
  'policy',
  'enabled',
  'required',
  'updated',
  'reset',
]);
function metadataName(name: string, value?: unknown): boolean {
  const w = words(name);
  if (w.length < 2 || !METADATA_LAST.has(w[w.length - 1]!)) return false;
  if (value === undefined) return true;
  return (
    typeof value !== 'string' ||
    (value.length <= 80 && !looksLikeToken(value) && !/^[A-Za-z0-9+/=_-]{32,}$/.test(value))
  );
}

function allowedName(name: string): boolean {
  const c = compact(name);
  return ALLOWED.has(c) || /tokenprice$/.test(c);
}
function secretWords(name: string): boolean {
  const c = compact(name);
  if (ALWAYS_SECRET.has(c)) return true;
  const w = words(name);
  if (w.some((x) => COMPOUND.test(x) || WHOLE_WORDS.has(x))) return true;
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i]!;
    const b = w[i + 1]!;
    if ((a === 'api' || a === 'private' || a === 'auth') && (b === 'key' || b === 'keys'))
      return true;
    if (a === 'auth' && (b === 'header' || b === 'secret')) return true;
    if ((b === 'key' || b === 'keys') && KEY_QUALIFIERS.has(a)) return true;
  }
  return false;
}

/** Name only (a field definition has no value to look at): a property called `api_token` is not copied at all. */
export function isSecretName(name: string): boolean {
  if (allowedName(name) || metadataName(name)) return false;
  return secretWords(name);
}

const TOKEN_SHAPES: RegExp[] = [
  /^bearer\s+\S{8,}/i,
  /^eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*$/,
  /^EAA[A-Za-z0-9]{20,}$/,
  /^sk-[A-Za-z0-9_-]{16,}$/,
  /^[sr]k_(live|test)_[A-Za-z0-9]{8,}$/,
  /^pk_(live|test)_[A-Za-z0-9]{8,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^AIza[0-9A-Za-z_-]{30,}$/,
  /^-----BEGIN [A-Z ]+-----/,
];
const TOKEN_INLINE: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g,
  /\bEAA[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[sr]k_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
];
const PAIR = /\b([A-Za-z_][\w-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/g;

/** Bearer / JWT / vendor-key shaped strings. */
export function looksLikeToken(v: string): boolean {
  const s = v.trim();
  return TOKEN_SHAPES.some((re) => re.test(s));
}

/** Should the key/value pair be dropped? */
export function isSecretEntry(name: string, value: unknown): boolean {
  if (typeof value === 'string' && looksLikeToken(value)) return true;
  if (allowedName(name)) return false;
  const c = compact(name);
  if (ALWAYS_SECRET.has(c)) return true;
  if (metadataName(name, value)) return false;
  if (secretWords(name))
    return !(typeof value === 'number' && Number.isFinite(value)) && typeof value !== 'boolean';
  if (typeof value === 'string') {
    const w = words(name);
    const last = w[w.length - 1];
    // a `<something>_key` holding a long opaque string, or any long opaque string under a name that hints at a credential
    if ((last === 'key' || last === 'keys') && value.length >= 16 && !/\s/.test(value)) return true;
    // by WORD, not substring: author_id, author_photo, passport_photo and monkey_id are not credentials
    if (value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value) && w.some((x) => HINT_WORDS.has(x)))
      return true;
  }
  return false;
}

/** Free text: tokens and `secret=value` pairs are replaced by [redacted]. Returns the text and how many replacements were made. */
export function redactText(s: string): { text: string; n: number } {
  let n = 0;
  let out = s;
  for (const re of TOKEN_INLINE) {
    out = out.replace(re, () => {
      n++;
      return '[redacted]';
    });
  }
  out = out.replace(PAIR, (m, k: string, sep: string) => {
    if (!secretWords(k) || allowedName(k)) return m;
    n++;
    return `${k}${sep}[redacted]`;
  });
  return { text: out, n };
}

/** Copy of `value` without credential-looking entries; `redacted` lists the key paths removed or redacted (never their values). */
export function scrub(value: unknown, path = ''): { value: unknown; redacted: string[] } {
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        const inner = scrub(JSON.parse(t) as unknown, path);
        if (inner.redacted.length > 0)
          return { value: JSON.stringify(inner.value), redacted: inner.redacted };
      } catch {
        /* plain text that happens to start with a brace */
      }
    }
    const r = redactText(value);
    return r.n > 0
      ? { value: r.text, redacted: [`${path || '(value)'} (text)`] }
      : { value, redacted: [] };
  }
  if (Array.isArray(value)) {
    const redacted: string[] = [];
    const out: unknown[] = [];
    value.forEach((v, i) => {
      if (typeof v === 'string' && looksLikeToken(v)) {
        redacted.push(`${path}[${i}]`);
        return;
      }
      const r = scrub(v, `${path}[${i}]`);
      redacted.push(...r.redacted);
      out.push(r.value);
    });
    return { value: out, redacted };
  }
  if (value && typeof value === 'object') {
    const redacted: string[] = [];
    const out = {};
    for (const [k, v] of Object.entries(value as Doc)) {
      const p = path ? `${path}.${k}` : k;
      if (isSecretEntry(k, v)) {
        redacted.push(p);
        continue;
      }
      const r = scrub(v, p);
      redacted.push(...r.redacted);
      setOwn(out, k, r.value);
    }
    return { value: out, redacted };
  }
  return { value, redacted: [] };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');

/** What PostgreSQL text / jsonb cannot hold: a NUL character, or a lone UTF-16 surrogate (JSON would carry it as an invalid escape). */
export function badText(v: unknown): 'NUL_CHAR' | 'LONE_SURROGATE' | null {
  if (typeof v === 'string') {
    if (v.includes(String.fromCharCode(0))) return 'NUL_CHAR';
    return LONE_SURROGATE.test(v) ? 'LONE_SURROGATE' : null;
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const b = badText(x);
      if (b) return b;
    }
    return null;
  }
  if (v && typeof v === 'object' && !(v instanceof Oid) && !(v instanceof Date)) {
    for (const [k, x] of Object.entries(v as Doc)) {
      const b = badText(k) ?? badText(x);
      if (b) return b;
    }
  }
  return null;
}
/** Removes NUL characters and replaces lone surrogates with U+FFFD (for rows that are stored in quarantine, never for loaded data). */
export function stripNul(v: unknown): unknown {
  if (typeof v === 'string')
    return v.split(String.fromCharCode(0)).join('').replace(LONE_SURROGATES, '�');
  if (Array.isArray(v)) return v.map(stripNul);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v as Doc)) setOwn(out, stripNul(k) as string, stripNul(x));
    return out;
  }
  return v;
}

/**
 * A message that is safe to print or log for ANY error. Driver errors carry the SQL text and the bound parameters (other contacts'
 * emails and phones); this keeps the SQLSTATE and the constraint / table / column names only. Never `detail`, never `params`.
 */
export function sanitizeError(e: unknown): string {
  type PgLike = {
    message?: string;
    code?: string;
    cause?: unknown;
    constraint?: string;
    table?: string;
    column?: string;
  };
  const err = e as PgLike;
  const isDb = (x: unknown): x is PgLike & { code: string } =>
    /^[0-9A-Z]{5}$/.test(String((x as PgLike | undefined)?.code ?? ''));
  const inner: (PgLike & { code: string }) | null = isDb(err?.cause)
    ? err.cause
    : isDb(err)
      ? err
      : null;
  if (inner) {
    const bits = [`SQLSTATE ${inner.code}`];
    if (inner.constraint) bits.push(`constraint ${inner.constraint}`);
    if (inner.table) bits.push(`table ${inner.table}`);
    if (inner.column) bits.push(`column ${inner.column}`);
    return `database error (${bits.join(', ')})`;
  }
  const msg = String(err?.message ?? e);
  if (/^Failed query:/i.test(msg) || /\nparams:/i.test(msg))
    return 'database statement failed (details withheld: they contain data)';
  return msg.slice(0, 500);
}

/** For reports: keep the last two characters only. */
export const mask = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '(empty)';
  const s = String(v);
  return s.length <= 2 ? '**' : `***${s.slice(-2)}`;
};

export const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Both identifiers of a document: the ObjectId `_id` (hex) and the Django-style string `id`. */
export function docKeys(doc: Doc): Array<{ key: string; kind: 'objectid' | 'string_id' }> {
  const out: Array<{ key: string; kind: 'objectid' | 'string_id' }> = [];
  if (doc._id !== undefined && doc._id !== null) {
    out.push({ key: String(doc._id), kind: doc._id instanceof Oid ? 'objectid' : 'string_id' });
  }
  const id = str(doc.id);
  if (id && !out.some((k) => k.key === id)) out.push({ key: id, kind: 'string_id' });
  return out;
}
/** `docKeys` plus extra identifying fields (a user has `_id` and `user_id` but no `id`). */
export function docKeysWith(
  doc: Doc,
  aliases?: string[],
): Array<{ key: string; kind: 'objectid' | 'string_id' }> {
  const out = docKeys(doc);
  for (const a of aliases ?? []) {
    const v = str(doc[a]);
    if (v && !out.some((k) => k.key === v)) out.push({ key: v, kind: 'string_id' });
  }
  return out;
}
export const primaryKey = (doc: Doc): string =>
  docKeys(doc)[0]?.key ?? `nokey:${sha256(JSON.stringify(doc)).slice(0, 16)}`;

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** JSON-safe copy of a document (Oid -> hex, Date -> ISO). */
export function plain(v: unknown): unknown {
  if (v instanceof Oid) return v.hex;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v as Doc)) setOwn(out, k, plain(x));
    return out;
  }
  return v;
}
