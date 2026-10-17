import {
  isSecretKey,
  maskEmail,
  maskName,
  maskPhone,
  piiKindOfKey,
  type PiiKind,
} from '../../common/privacy/pii-mask';

/**
 * A stored lead payload with its personal data masked, for the lead inbox (BL-014): the same masks, built on the same helpers
 * (`common/privacy/pii-mask`), as the audit log and the act-as screens use. A lead payload is a stranger's data in the shape the sender
 * chose, so the key alone is not enough: a Meta-style `{ name: 'phone_number', values: ['+9198...'] }` pair is masked by the NAME of the
 * pair, and a value that looks like an e-mail address or a phone number is masked wherever it sits.
 *
 *  - a key that names a secret (token, password, API key, signature...): `[REDACTED]`;
 *  - phone, e-mail, name: the usual masks (`+91 ******210`, `a***@example.test`, `A*** L***`); address and free text are hidden;
 *  - a bare value that reads as an e-mail address or a phone number: masked;
 *  - ids are left alone (a provider's lead id is not a phone number even when it is 12 digits long).
 *
 * Pure; the shape of the payload is kept so a mapping can still be read from it ("the phone is under lead.mobile").
 */

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_ITEMS = 200;
const MAX_STRING = 1_000;

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
const PHONE_LIKE = /^\+?[\d\s().-]{7,25}$/;

const isIdKey = (key: string): boolean => /(^|[_\s.-])ids?$|Ids?$|^externalId$/.test(key.trim());

interface Out {
  value: unknown;
  masked: boolean;
}

const hasContent = (v: unknown): boolean =>
  v !== false && v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

function scrubString(key: string, text: string): Out {
  let out = text;
  let masked = false;
  out = out.replace(JWT, () => ((masked = true), REDACTED));
  out = out.replace(BEARER, () => ((masked = true), `Bearer ${REDACTED}`));
  out = out.replace(EMAIL_IN_TEXT, (m) => ((masked = true), maskEmail(m)));
  out = out.replace(E164_IN_TEXT, (m) => ((masked = true), maskPhone(m)));
  if (!isIdKey(key) && PHONE_LIKE.test(out.trim())) {
    const digits = out.replace(/\D/g, '').length;
    if (digits >= 7 && digits <= 15) {
      out = maskPhone(out.trim());
      masked = true;
    }
  }
  if (out.length > MAX_STRING) out = `${out.slice(0, MAX_STRING)}...`;
  return { value: out, masked };
}

/** Keys under which a word like `text` is the sender's wording of a consent or a label, not a person's message. */
const PLAIN_PARENTS: ReadonlySet<string> = new Set(['consent', 'attribution']);

function walk(
  key: string,
  value: unknown,
  depth: number,
  inherited: PiiKind | null,
  parent: string,
): Out {
  if (value === null || value === undefined) return { value: value ?? null, masked: false };
  if (isSecretKey(key)) {
    return { value: hasContent(value) ? REDACTED : value, masked: hasContent(value) };
  }
  const own = PLAIN_PARENTS.has(parent.toLowerCase()) ? null : piiKindOfKey(key, 'leads');
  const kind = own ?? inherited;

  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (kind && text !== '') return { value: MASKERS[kind](text), masked: true };
    if (typeof value === 'number') return { value, masked: false };
    return scrubString(key, text);
  }
  if (typeof value === 'boolean') return { value, masked: false };
  if (depth >= MAX_DEPTH) return { value: '[too deep]', masked: false };

  if (Array.isArray(value)) {
    let masked = false;
    const items = value.slice(0, MAX_ITEMS).map((v) => {
      const r = walk(key, v, depth + 1, kind, parent);
      masked ||= r.masked;
      return r.value;
    });
    if (value.length > MAX_ITEMS) items.push(`... ${value.length - MAX_ITEMS} more`);
    return { value: items, masked };
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // A name/value pair (`{ name: 'phone_number', values: [...] }`, the shape lead-form providers use): the pair's name types the value.
    const hasValue = 'value' in obj || 'values' in obj;
    const pairLabel =
      typeof obj.name === 'string' ? 'name' : typeof obj.key === 'string' ? 'key' : null;
    const pairName = hasValue && pairLabel ? (obj[pairLabel] as string) : null;
    const pairKind = pairName ? piiKindOfKey(pairName, 'leads') : null;
    let masked = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // The label of a pair says what the value is (`phone_number`); it is not itself a person's name.
      if (pairName !== null && k === pairLabel) {
        out[k] = v;
        continue;
      }
      const isPairValue = pairName !== null && (k === 'value' || k === 'values');
      const r = walk(
        isPairValue && pairName ? pairName : k,
        v,
        depth + 1,
        isPairValue ? pairKind : null,
        key,
      );
      masked ||= r.masked;
      out[k] = r.value;
    }
    return { value: out, masked };
  }
  return { value: String(value), masked: false };
}

/** The payload with personal data masked and secrets redacted, and whether anything was. */
export function maskLeadPayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>;
  masked: boolean;
} {
  const r = walk('payload', payload, 0, null, '');
  return { payload: r.value as Record<string, unknown>, masked: r.masked };
}
