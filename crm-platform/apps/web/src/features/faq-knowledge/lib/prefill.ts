/**
 * "Create FAQ from this" on the Unanswered screen: the customer's message (and the log row it resolves) travel to the editor through
 * session storage, not the address bar, because a customer's words do not belong in a URL or the browser history.
 */
const KEY = 'faq.prefill';

export interface Prefill {
  question: string;
  resolveLogId: string;
}

export function writePrefill(p: Prefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the editor opens empty, which is still usable.
  }
}

export function readPrefill(): Prefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Prefill>;
    return typeof v.question === 'string' && typeof v.resolveLogId === 'string'
      ? { question: v.question, resolveLogId: v.resolveLogId }
      : null;
  } catch {
    return null;
  }
}

export function clearPrefill(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
