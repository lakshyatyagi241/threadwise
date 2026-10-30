/**
 * Mask a phone number for display when the caller lacks `contacts.phone.reveal`
 * (see 20261225090000_contacts_phone_unmask_permission.sql).
 *
 * This revives — deliberately, not by accident — the masking algorithm Reference
 * wrote and then disabled (TW-AUTH-042: `mask_phone()` in `app/Support/security_helpers.php`
 * early-returns the input unchanged; the clamp and separator-preserving loop below it were
 * never reachable). The inventory's port note says not to bring the feature back as
 * Reference had it (a global admin on/off toggle); this is the same shape of algorithm behind
 * an RBAC field-level gate instead, applied server-side in the Contacts API response so the
 * raw number never reaches a caller without the permission.
 *
 *   maskPhone('+919145808988')        -> '+xxxxxxxx8988'
 *   maskPhone('+91 91458 08988')      -> '+xx xxxxx x8988'
 *   maskPhone('+919145808988', 2)     -> '+xxxxxxxxxx88'
 *
 * `visible` is clamped to 2-4 (Reference's own range): fewer than 2 leaves nothing
 * recognisable, more than 4 isn't much of a mask. A number with `visible` or fewer
 * digits has nothing worth hiding and is returned unchanged. Separators (+, space,
 * -, parentheses, dots) are preserved in place so the shape stays readable; only the
 * digits themselves move between 'x' and their original value.
 */
/**
 * Mask a custom property value flagged "masked": every letter and digit but the last `visible` is replaced by `x`, separators kept
 * (`1234 5678 9012` -> `xxxx xxxx 9012`). A value no longer than `visible` is masked whole, so a short value shows nothing. A list is
 * masked item by item and a number becomes masked text. `null`, blanks and booleans carry no secret and are returned as they are.
 */
export function maskValue(value: unknown, visible = 4): unknown {
  if (Array.isArray(value)) return value.map((v) => maskValue(v, visible));
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || text.trim() === '') return value;
  const total = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const hide = total <= visible ? total : total - visible;
  let seen = 0;
  return text.replace(/[A-Za-z0-9]/g, (ch) => (++seen <= hide ? 'x' : ch));
}

export function maskPhone(e164: string, visible = 4): string {
  const trimmed = (e164 ?? '').trim();
  if (trimmed === '') return '';

  const clampedVisible = Math.max(2, Math.min(4, visible));

  const digitCount = (trimmed.match(/\d/g) ?? []).length;
  if (digitCount <= clampedVisible) return trimmed;

  const maskUpTo = digitCount - clampedVisible;
  let seen = 0;
  let out = '';
  for (const ch of trimmed) {
    if (ch >= '0' && ch <= '9') {
      seen += 1;
      out += seen <= maskUpTo ? 'x' : ch;
    } else {
      out += ch;
    }
  }
  return out;
}
