import { SECRET_HEADERS } from '../../modules/platform-infrastructure';

/**
 * The pure personal-data and secret-key helpers shared by the audit-log renderer (`modules/audit-log/audit-pii.ts`) and the act-as
 * response mask (`modules/auth/guards/impersonation-mask.interceptor.ts`). They live here, in neutral ground, so neither module has to
 * import the other's internals. No I/O; unit-tested through test/unit/audit-log/audit-pii.spec.ts.
 */

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

export type PiiKind = 'phone' | 'email' | 'address' | 'text' | 'name' | 'birth';

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
  // A date of birth is personal data of its own (BL-217): `date_of_birth`, `dob`, `birthdate`, `birthday`.
  if (has(parts, 'dob', 'birthdate', 'birthday') || (has(parts, 'birth') && has(parts, 'date'))) {
    return 'birth';
  }
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
