/**
 * Did this database error come from a VALUE the caller supplied that Postgres cannot take? SQLSTATE class 22 is "data exception": a NUL
 * byte in text (22021, e.g. `POST /v2/viber/inbound/%00` binds "\0" as a path parameter), text that is not a number, uuid or timestamp
 * (22P02, 22007), a number out of range (22003), a bad escape. Whatever route it came from, the cause is the request, so it is answered
 * 422, not 500. Drizzle wraps the driver error, so the cause chain is followed.
 */
export function isDataExceptionDbError(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && /^22[0-9A-Z]{3}$/.test(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
