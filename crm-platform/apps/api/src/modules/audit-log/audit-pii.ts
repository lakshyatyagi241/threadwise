import {
  isSecretKey,
  maskEmail,
  maskName,
  maskPhone,
  piiKindOfKey,
  type PiiKind,
} from '../../common/privacy/pii-mask';

// Re-exported so existing importers of this file keep working.
export { isSecretKey, maskEmail, maskName, maskPhone, piiKindOfKey };

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

const MASKERS: Record<PiiKind, (v: string) => string> = {
  phone: maskPhone,
  email: maskEmail,
  name: maskName,
  address: () => '[hidden address]',
  text: () => '[hidden text]',
  birth: () => '[hidden date of birth]',
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
