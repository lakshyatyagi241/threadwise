/** Pure rules of the reply-only send (WD-IG-013, 014): no database, no engine, so each can be tested alone. */

export const WINDOW_MS = 24 * 3_600_000;
export const ERRORS_SHOWN = 5;
export const ERROR_CLIP = 120;
/** Sends in flight at once: a request waits for all of them, and the engine is one deployment. */
export const CONCURRENCY = 5;
/** Most threads listed per account in the picker. */
export const THREADS_PER_ACCOUNT = 2000;

/** `{name}` becomes the person's thread title, or "there" when the thread has none (every occurrence). */
export const personalize = (body: string, title: string | null): string =>
  body.split('{name}').join(title || 'there');

/** The composer's template wins over the typed text when it has a body. */
export const composerBody = (typed: string, template: { body: string } | undefined): string =>
  template && template.body.trim() !== '' ? template.body : typed;

/** Instagram lets a plain message through within 24 hours of the person's last message. */
export const windowOpen = (lastInboundAt: Date | null, now: Date): boolean =>
  lastInboundAt !== null && lastInboundAt.getTime() + WINDOW_MS > now.getTime();

/** A value for a LIKE pattern, so its `%`, `_` and `\` match themselves. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * Which threads belong to an account. A thread key is `ig:<account id><separator><sender>` with `_` or `:` as the separator, and the
 * account id may itself contain `_`, so both separators are spelled out. (WaDesk let one wildcard stand for the separator, so the
 * account `1` also matched the threads of account `12`.)
 */
export const accountThreadPatterns = (accountId: string): [string, string] => {
  const esc = likeEscape(accountId);
  return [`ig:${esc}\\_%`, `ig:${esc}:%`];
};

export const clipError = (s: string): string => s.slice(0, ERROR_CLIP);

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
