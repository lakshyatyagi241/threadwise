/**
 * The language of the chat window's own texts. A widget with no primary language follows the visitor (as every window did before the
 * setting existed). One with a primary language speaks it, and gives way to the visitor's language only when that is listed as an
 * additional one; the visitor's language is matched by its base code (`pt-BR` finds `pt`).
 */
export function chatWindowLocale(
  languages: { primary: string; additional: readonly string[] },
  visitor: string | undefined,
): string | undefined {
  if (!languages.primary) return visitor;
  const listed = [languages.primary, ...languages.additional];
  const want = (visitor ?? '').toLowerCase();
  const hit = listed.find(
    (c) => c.toLowerCase() === want || c.toLowerCase() === want.split('-')[0],
  );
  return hit ?? languages.primary;
}
