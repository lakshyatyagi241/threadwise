/**
 * Is this error "a service we depend on (Postgres, Redis, a queue) could not be reached or stopped answering"?
 *
 * Such an error is not a bug in the request: the right answer is 503 and a retry shortly, never a 500 the caller reads as "my request
 * is broken". The clients raise it in many shapes (drizzle wraps the driver error in `cause`), so this walks the chain and matches on
 * the stable parts: the Node socket error codes, the Postgres SQLSTATEs that mean "server going away / not accepting", and the fixed
 * texts node-postgres, pg-pool, ioredis and BullMQ use for a dead or timed-out connection.
 */
const SOCKET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

/** 08 connection exception, 53300 too many connections, 57P01-03 admin shutdown / crash shutdown / cannot connect now. */
const SQLSTATE = /^(08\w{3}|53300|57P0[123])$/;

const TEXTS = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'Query read timeout',
  'not queryable',
  'Connection is closed',
  "Stream isn't writeable",
  'Command timed out',
  'Reached the max retries per request limit',
];

export function isDependencyOutage(error: unknown): boolean {
  let cur: unknown = error;
  for (let depth = 0; depth < 6 && cur !== null && typeof cur === 'object'; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && (SOCKET_CODES.has(e.code) || SQLSTATE.test(e.code))) {
      return true;
    }
    if (typeof e.message === 'string' && TEXTS.some((t) => (e.message as string).includes(t))) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}
