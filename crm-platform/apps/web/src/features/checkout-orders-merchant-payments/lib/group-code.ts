/**
 * The ordering code of a WhatsApp group (Reference: `nullable|string|max:48|regex:/^[A-Za-z0-9._-]*$/`). Pure, no React. Blank clears the
 * code; the server holds the same rule (`setStoreGroupCodeSchema`) and answers STORE_GROUP_CODE_TAKEN when another group has it.
 */
export const GROUP_CODE_MAX = 48;
export const GROUP_CODE_PATTERN = /^[A-Za-z0-9._-]*$/;

export type GroupCodeProblem = 'tooLong' | 'badChars';

export type GroupCodeCheck =
  | { ok: true; /** The code to send: null clears it. */ value: string | null }
  | { ok: false; problem: GroupCodeProblem };

/** Surrounding spaces are never part of a code. */
export const normaliseGroupCode = (raw: string): string => raw.trim();

export function validateGroupCode(raw: string): GroupCodeCheck {
  const code = normaliseGroupCode(raw);
  if (code.length > GROUP_CODE_MAX) return { ok: false, problem: 'tooLong' };
  if (!GROUP_CODE_PATTERN.test(code)) return { ok: false, problem: 'badChars' };
  return { ok: true, value: code === '' ? null : code };
}

/** Whether the typed text differs from what is saved (blank and null are the same: no code). */
export function isGroupCodeDirty(draft: string, saved: string | null): boolean {
  return normaliseGroupCode(draft) !== (saved ?? '');
}

/** Reference's "Copy ordering link": a wa.me link to the bot number that pre-types `ORDER G:<code>`. Null without a number or code. */
export function orderingLink(botNumber: string | null, code: string | null): string | null {
  const digits = (botNumber ?? '').replace(/\D+/g, '');
  if (!digits || !code) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`ORDER G:${code}`)}`;
}
