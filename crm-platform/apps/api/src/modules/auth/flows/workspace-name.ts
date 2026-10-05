const CASED = /\p{Cased}/u;
const CASE_IGNORABLE = /\p{Case_Ignorable}/u;

/**
 * Title case by the Unicode word rules WaDesk gets from PHP's multibyte title-casing: the first
 * cased letter of a word is upper-cased and the rest lower-cased; apostrophes, dots and combining
 * marks (case-ignorable) stay inside the word; anything else, digits and underscores included,
 * starts a new one. "priya.sharma" -> "Priya.sharma", "john_doe" -> "John_Doe", "user1abc" -> "User1Abc".
 */
export function titleCase(input: string): string {
  let inWord = false;
  let out = '';
  for (const ch of input) {
    if (inWord) {
      if (CASE_IGNORABLE.test(ch)) out += ch;
      else if (CASED.test(ch)) out += ch.toLowerCase();
      else {
        inWord = false;
        out += ch;
      }
    } else if (CASED.test(ch)) {
      inWord = true;
      // "ß" upper-cases to "SS"; the title-case form is "Ss".
      const up = ch.toUpperCase();
      out += up.length > 1 ? up.charAt(0) + up.slice(1).toLowerCase() : up;
    } else {
      out += ch;
    }
  }
  return out;
}

/** The workspace-name prefill: the title-cased part of the email before "@", then "'s workspace". */
export function suggestWorkspaceName(email: string): string {
  const at = email.indexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  return `${titleCase(local)}'s workspace`;
}
