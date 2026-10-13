import { SECRET_HEADERS } from '../platform-infrastructure';

/**
 * The PII-safe renderer for the `delta` of an audit row (spec docs/specs/audit-log-tenant.md, section 5). `audit_log.delta` holds the
 * old and new value of every field a service changed, so it holds personal data (a contact's phone, an e-mail, a note) and, because
 * ~250 call sites write it, occasionally something that looks like a secret. Nothing leaves the API without passing through here.
 *
 *  - A secret (a key that names a password, token, API key, credential... or a value that looks like a token) is ALWAYS replaced by
 *    `[REDACTED]`, for every viewer, in the screen and in the export.
 *  - Personal data is masked unless the viewer may reveal it (`reveal`): phone, e-mail, address, free text (notes, body, text...) and,
 *    for a record that is a person, the name. Masks keep enough to recognise a value without disclosing it (`+91 ******210`).
 *
 * Pure functions, no I/O: unit-tested in test/unit/audit-log.
 */

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 1_000;
const MAX_ITEMS = 50;

/** The write-time redaction list of Reference (TW-NOTIF-026 rule 4), plus the credential headers the API's own log redaction knows. */
const SECRET_KEY =
  /(pass(word|wd|phrase)?|secret|token|api[\s_-]?key|apikey|credential|private|access[\s_-]?key|signing|bearer|authorization|cookie|webhook|otp|cvv)/i;
/** Keys that hold the NAMES of keys, not values (Reference exempts the same three). */
const SECRET_EXEMPT = new Set(['credential_keys_set', 'missing_keys', 'changed_keys']);
const SECRET_HEADER_NAMES: ReadonlySet<string> = new Set(SECRET_HEADERS as readonly string[]);

export function isSecretKey(key: string): boolean {
  const k = key.trim();
  if (SECRET_EXEMPT.has(k.toLowerCase())) return false;
  return SECRET_KEY.test(k) || SECRET_HEADER_NAMES.has(k.toLowerCase());
}

type PiiKind = 'phone' | 'email' | 'address' | 'text' | 'name';

/** Modules whose bare `name` field is a person's name (a tag's or a role's name is not personal data). */
const PERSON_MODULES = new Set([
  'contacts',
  'contact',
  'users',
  'members',
  'candidates',
  'partner_agents',
  'partner-agents',
  'leads',
  'customers',
  'wa_customers',
]);

const snake = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();

const has = (parts: string[], ...words: string[]): boolean => words.some((w) => parts.includes(w));

/** What kind of personal data a key names, or null. `module` decides whether a bare `name` is a person's. */
export function piiKindOfKey(key: string, module: string): PiiKind | null {
  const parts = snake(key).split('_').filter(Boolean);
  if (parts.length === 0) return null;
  if (has(parts, 'email', 'emails', 'mail') && !has(parts, 'verified', 'at', 'count'))
    return 'email';
  if (has(parts, 'phone', 'phones', 'mobile', 'msisdn', 'whatsapp', 'tel', 'fax', 'wa')) {
    return has(parts, 'verified', 'at', 'count', 'enabled') ? null : 'phone';
  }
  if (has(parts, 'address', 'street', 'postcode', 'zip', 'postal')) return 'address';
  // Free text is named by the LAST word (`message_body`, `notes`, `reply_text`); `message_status` is not text.
  if (
    [
      'note',
      'notes',
      'body',
      'text',
      'message',
      'comment',
      'comments',
      'content',
      'caption',
    ].includes(parts[parts.length - 1]!)
  ) {
    return 'text';
  }
  if (
    has(parts, 'full', 'first', 'last', 'display', 'contact', 'customer', 'person', 'owner') &&
    has(parts, 'name')
  ) {
    return 'name';
  }
  if (parts.length === 1 && parts[0] === 'name' && PERSON_MODULES.has(module.toLowerCase())) {
    return 'name';
  }
  return null;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return '******';
  const prefix = value.trim().startsWith('+') ? `+${digits.slice(0, 2)} ` : '';
  return `${prefix}******${digits.slice(-3)}`;
}

export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export function maskName(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${Array.from(w)[0] ?? ''}***`)
    .join(' ');
}

const MASKERS: Record<PiiKind, (v: string) => string> = {
  phone: maskPhone,
  email: maskEmail,
  name: maskName,
  address: () => '[hidden address]',
  text: () => '[hidden text]',
};

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const E164_IN_TEXT = /\+\d{8,15}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE = /^[A-Za-z0-9_\-+/=]{32,}$/;

/** What a plain string value carries even under an innocent key: a token is redacted, an e-mail or an E.164 number is masked. */
function scrubString(value: string, reveal: boolean): { value: string; masked: boolean } {
  let out = value;
  let masked = false;
  if (OPAQUE.test(out) && !UUID.test(out) && /[A-Za-z]/.test(out) && /\d/.test(out)) {
    return { value: REDACTED, masked: true };
  }
  out = out.replace(JWT, () => ((masked = true), REDACTED));
  out = out.replace(BEARER, () => ((masked = true), `Bearer ${REDACTED}`));
  if (!reveal) {
    out = out.replace(EMAIL_IN_TEXT, (m) => ((masked = true), maskEmail(m)));
    out = out.replace(E164_IN_TEXT, (m) => ((masked = true), maskPhone(m)));
  }
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}...`;
  return { value: out, masked };
}

export interface RenderOptions {
  /** The audited record's module (decides whether `name` is a person's). */
  module: string;
  /** The viewer may see personal values (secrets stay redacted). */
  reveal: boolean;
}

interface Rendered {
  value: unknown;
  masked: boolean;
}

/** Renders one value under a key: secret key -> redacted; personal key -> masked; otherwise walked and scrubbed. */
export function renderValue(
  key: string,
  value: unknown,
  opts: RenderOptions,
  depth = 0,
  inherited: PiiKind | null = null,
): Rendered {
  if (value === null || value === undefined) return { value: value ?? null, masked: false };
  if (isSecretKey(key)) {
    return { value: hasContent(value) ? REDACTED : value, masked: hasContent(value) };
  }
  const kind = piiKindOfKey(key, opts.module) ?? inherited;

  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (kind && !opts.reveal && text !== '') return { value: MASKERS[kind](text), masked: true };
    if (typeof value === 'number') return { value, masked: false };
    return scrubString(text, opts.reveal);
  }
  if (typeof value === 'boolean') return { value, masked: false };

  if (depth >= MAX_DEPTH) return { value: '[too deep]', masked: false };
  if (Array.isArray(value)) {
    let masked = false;
    const items = value.slice(0, MAX_ITEMS).map((v) => {
      const r = renderValue(key, v, opts, depth + 1, kind);
      masked ||= r.masked;
      return r.value;
    });
    if (value.length > MAX_ITEMS) items.push(`... ${value.length - MAX_ITEMS} more`);
    return { value: items, masked };
  }
  if (typeof value === 'object') {
    let masked = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = renderValue(k, v, opts, depth + 1, null);
      masked ||= r.masked;
      out[k] = r.value;
    }
    return { value: out, masked };
  }
  return { value: String(value), masked: false };
}

const hasContent = (v: unknown): boolean =>
  v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Keys the platform adds to a delta that are not field changes (the act-as stamp). */
export const DELTA_META_KEYS: ReadonlySet<string> = new Set(['_impersonatedBy']);

export interface RenderedField {
  old?: unknown;
  new?: unknown;
  masked: boolean;
}

const isChange = (v: unknown): v is { old?: unknown; new?: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && ('old' in v || 'new' in v);

/** The names of the changed fields of a delta (never values), without the platform's own stamp. */
export function changedFields(delta: unknown): string[] {
  if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) return [];
  return Object.keys(delta).filter((k) => !DELTA_META_KEYS.has(k));
}

/** The whole delta, field by field, old to new, through the renderer. A field that is not in the `{old,new}` shape is shown as `new`. */
export function renderDelta(delta: unknown, opts: RenderOptions): Record<string, RenderedField> {
  const out: Record<string, RenderedField> = {};
  if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) return out;
  for (const [field, change] of Object.entries(delta as Record<string, unknown>)) {
    if (DELTA_META_KEYS.has(field)) continue;
    if (isChange(change)) {
      const before = renderValue(field, change.old ?? null, opts);
      const after = renderValue(field, change.new ?? null, opts);
      out[field] = { old: before.value, new: after.value, masked: before.masked || after.masked };
    } else {
      const only = renderValue(field, change, opts);
      out[field] = { new: only.value, masked: only.masked };
    }
  }
  return out;
}
