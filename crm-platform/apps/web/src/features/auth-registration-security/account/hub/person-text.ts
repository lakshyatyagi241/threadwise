/**
 * Small text helpers for how a person is shown in the account rail and the
 * profile form (WD-AUTH-024, 025). All of them count code points, not UTF-16
 * units, so a name written with accents or emoji is never cut in half.
 */

const words = (name: string) => name.trim().split(/\s+/u).filter(Boolean);

/** Upper-cased first letters of the first two words ("Asha Rao" gives "AR"), or "?" when there is no name. */
export function initialsOf(name: string | null | undefined): string {
  const letters = words(name ?? '')
    .slice(0, 2)
    .map((w) => [...w][0] ?? '');
  const joined = letters.join('').toLocaleUpperCase();
  return joined || '?';
}

/** The first word of a full name; the display name box is pre-filled with it. */
export function firstNameOf(fullName: string | null | undefined): string {
  return words(fullName ?? '')[0] ?? '';
}
