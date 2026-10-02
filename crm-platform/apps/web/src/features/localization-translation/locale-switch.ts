import type { ActiveLanguage } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The switcher only exists when there is a choice to make (WD-I18N-010 rule 1). */
export const hasChoice = (active: readonly ActiveLanguage[]): boolean => active.length > 1;

/**
 * The code on the button: the current locale's, or the first active language's when the current locale is not in the
 * active list (WaDesk falls back the same way).
 */
export function triggerCode(active: readonly ActiveLanguage[], locale: string): string {
  const code = active.some((l) => l.code === locale) ? locale : (active[0]?.code ?? locale);
  return code.toUpperCase();
}

export interface SwitchDeps {
  /** Saves a signed-in user's choice (PATCH /me/locale). Throws ApiError. */
  saveMine: (code: string) => Promise<unknown>;
  /** Stores the session pick (the locale cookie). */
  setCookie: (code: string) => Promise<unknown>;
}

/**
 * Picks a language. A signed-in user's choice is saved on the server first; a guest (401) only gets the cookie. Any other
 * failure leaves everything as it was, so the page does not reload into a half-changed state (WD-I18N-010 criterion 5).
 */
export async function switchLocale(code: string, deps: SwitchDeps): Promise<'ok' | 'failed'> {
  try {
    await deps.saveMine(code);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) return 'failed';
  }
  try {
    await deps.setCookie(code);
  } catch {
    return 'failed';
  }
  return 'ok';
}
