import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types, type PoolConfig } from 'pg';
import * as schema from './schema';

/**
 * node-postgres returns int8 (bigint) as a STRING by default, because a
 * 64-bit integer does not fit in a JS number. Every id in this schema is
 * bigint, so without this parser `row.id` is '42' from a raw query but 42 from
 * a Drizzle select — and comparisons, Number.isInteger checks and JSON
 * payloads quietly disagree depending on which path produced the row.
 *
 * Converting to number makes both paths agree. The trade-off is explicit:
 * values above 2^53 lose precision. No single tenant will reach 9 quadrillion
 * rows in one table. If a stream table ever gets close, that table switches to
 * mode:'bigint' and its own parser — a local change, not this line.
 *
 * numeric/decimal is deliberately NOT converted: money must stay a string all
 * the way to a decimal library. Float rounding on a wallet balance is the one
 * bug nobody forgives.
 */
types.setTypeParser(types.builtins.INT8, (value: string) => Number(value));

export type Database = NodePgDatabase<typeof schema>;
/** The transaction handle drizzle hands to a `db.transaction()` callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything you can run a query on — a pooled connection or a transaction. */
export type Queryable = Database | Tx;

export interface DbClientOptions {
  url: string;
  poolMax?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
  /** Emit every statement. Development only — it logs parameter values. */
  logQueries?: boolean;
}

export interface DbClient {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

/** How long past the server's statement timeout the client waits before it gives up on a silent connection. */
export const QUERY_TIMEOUT_GRACE_MS = 2_500;

export function createDbClient(options: DbClientOptions): DbClient {
  const statementTimeoutMs = options.statementTimeoutMs ?? 15_000;
  const config: PoolConfig = {
    connectionString: options.url,
    max: options.poolMax ?? 20,
    // A connection that has been idle this long is more likely to have been
    // silently killed by a load balancer than to be useful.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: options.applicationName ?? 'crm-api',
    // Server-side statement timeout: a runaway query dies at the database
    // rather than holding a pooled connection until the client gives up.
    options: `-c statement_timeout=${statementTimeoutMs}`,
    // Client-side backstop for the case the server cannot help with: the connection is up but the other end stopped answering (a
    // dropped route, a frozen host), so the server-side timeout above never fires and the query would wait for ever, holding a request
    // or a worker tick. A little longer than the server's own timeout, so a slow-but-alive database still reports its own error.
    query_timeout: statementTimeoutMs + QUERY_TIMEOUT_GRACE_MS,
  };

  const pool = new Pool(config);

  // An error on an *idle* pooled client is emitted here, not at a call site.
  // Without this listener Node treats it as an unhandled 'error' event and
  // takes the whole process down.
  pool.on('error', (err) => {
    console.error('[db] idle client error', { message: err.message });
  });

  const db = drizzle(pool, { schema, logger: options.logQueries ?? false });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Read-replica pair.
 *
 * `primary` takes every write and every read inside a write transaction.
 * `replica` serves partner-portal and /public/v1 reads. Replication
 * lag is real: never read your own write from the replica.
 */
export interface DbClientPair {
  primary: DbClient;
  replica: DbClient;
  close(): Promise<void>;
}

export function createDbClientPair(
  primaryOptions: DbClientOptions,
  replicaUrl?: string,
): DbClientPair {
  const primary = createDbClient({ ...primaryOptions, applicationName: 'crm-api-primary' });

  // No replica configured (local dev, CI): fall back to the primary so the
  // read path still works. Production must set DATABASE_REPLICA_URL.
  const replica =
    replicaUrl && replicaUrl !== primaryOptions.url
      ? createDbClient({ ...primaryOptions, url: replicaUrl, applicationName: 'crm-api-replica' })
      : primary;

  return {
    primary,
    replica,
    close: async () => {
      await primary.close();
      if (replica !== primary) await replica.close();
    },
  };
}

/**
 * Opens a top-level transaction on `db` and hands the connection back whatever happens.
 *
 * drizzle's own `db.transaction` runs `begin` BEFORE its try/finally, so when `begin` fails (the connection died or went silent between
 * checkout and the first statement) the connection is never released: each such failure leaks one pool slot for good, and an outage
 * that lasts long enough empties the pool, so the API cannot recover even after the database is back. Here the release is
 * unconditional. A connection whose last query never got an answer (a client-side timeout) can never answer again, so it is closed
 * instead of being pooled. The checked-out connection also gets an error listener: node-postgres reports a dead connection as an
 * `error` event, and an unhandled one takes the whole process down.
 */
export async function runTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = (db as unknown as { $client?: Pool }).$client;
  // A stand-in database without a pool (a unit-test double) keeps the plain behaviour.
  if (!pool || typeof pool.connect !== 'function') return db.transaction(fn);
  const client = await pool.connect();
  const ignore = (): void => undefined;
  client.on('error', ignore);
  try {
    return await drizzle(client, { schema }).transaction(fn);
  } finally {
    client.off('error', ignore);
    const raw = client as unknown as {
      readyForQuery?: boolean;
      connection?: { stream?: { destroy(): void } };
    };
    const unanswered = raw.readyForQuery === false;
    if (unanswered) raw.connection?.stream?.destroy();
    client.release(
      unanswered ? new Error('connection discarded: a query got no answer') : undefined,
    );
  }
}
