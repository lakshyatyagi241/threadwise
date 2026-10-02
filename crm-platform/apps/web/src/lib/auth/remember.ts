/**
 * Whether a session issued by the sign-in route is a "keep me signed in" one, which decides the lifetime of its
 * cookies. Pure, so the rule is tested without a server.
 *
 * - The API says so itself: `Authenticated.remember` is what it stored on the session (the checkbox, the platform's
 *   switch, social sign-ins, the choice kept across a workspace switch). When the answer carries it, it wins; the
 *   rules below are only the fallback for an answer that does not (an API that predates the field).
 * - Password and code sign-ins carry the checkbox in the request.
 * - A workspace switch keeps what this browser already chose: dropping the long session on a switch would sign the
 *   person out when the browser closes, although they asked to stay signed in. The same holds for the code step of
 *   a switch, which does not carry the checkbox either (the sign-in form's code step always does).
 * - A social sign-in has no checkbox. WaDesk always remembers it, so it is remembered unless the platform turned
 *   remembering off.
 */
export function rememberForAction(input: {
  /** `remember` as the API answered (`Authenticated.remember`); anything but a boolean counts as missing. */
  fromApi?: unknown;
  action: string;
  /** `remember` as sent by the page, if any. */
  requested: unknown;
  /** The value of the remember cookie this browser holds ('1' / '0' / undefined). */
  cookie: string | undefined;
  /** Whether administrators allow long sessions (only read for social sign-ins). */
  platformAllows: boolean;
}): boolean {
  if (typeof input.fromApi === 'boolean') return input.fromApi;
  if (input.action === 'switch') return input.cookie === '1';
  if (input.action === 'mfa' && input.requested === undefined) return input.cookie === '1';
  if (input.action === 'social-callback') return input.platformAllows;
  return input.requested === true;
}
