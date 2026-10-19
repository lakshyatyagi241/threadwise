/** A name that is only a phone number, e.g. "+91 92184 67176". */
export function isPhoneLike(name: string): boolean {
  const t = name.trim();
  return /^\+?[\d\s().-]{5,}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= 5;
}

/**
 * The letters inside an avatar circle, the one rule every screen uses so a person reads the same in Contacts, the Inbox, Tasks and
 * the team chat: the first letter of the first word and of the last word, upper-cased. Punctuation is cleaned off each word first,
 * so "Dr. Asha" gives "DA". A name that is only a phone number (a contact without a name is listed by its number) gives "#", never
 * a slice of the digits. A single word gives one letter; nothing usable gives "?".
 */
export function initials(name: string | null | undefined): string {
  if (isPhoneLike(name ?? '')) return '#';
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '?';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toLocaleUpperCase();
}
