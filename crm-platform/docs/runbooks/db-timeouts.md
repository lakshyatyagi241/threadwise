# Database timeouts (Sheet 3 D-13)

Three limits stop one bad query or one forgotten transaction from holding a pooled connection (and its locks) for ever.

| Setting                               | Request path (API, hooks) | Worker | What it does                                                          | Error you see |
| ------------------------------------- | ------------------------- | ------ | --------------------------------------------------------------------- | ------------- |
| `statement_timeout`                   | 15 s                      | 15 s   | cancels a statement that runs longer                                  | `57014`       |
| `lock_timeout`                        | 5 s                       | 15 s   | cancels a statement that waits for a lock (row, advisory, DDL) longer | `55P03`       |
| `idle_in_transaction_session_timeout` | 30 s                      | 300 s  | ends a session that sits idle inside an open transaction longer       | `25P03`       |

## Where they are set

1. **On every pool connection of the app** (`packages/db/src/client.ts`, from `DB_STATEMENT_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`,
   `DB_IDLE_IN_TX_TIMEOUT_MS`; defaults 15000 / 5000 / 30000; `0` turns the last two off). The worker container overrides the last two in
   `deploy/hostinger/docker-compose.yml` (`DB_LOCK_TIMEOUT_MS_WORKER`, `DB_IDLE_IN_TX_TIMEOUT_MS_WORKER`). These win over the role defaults.
2. **On the database roles** (migration `2034_db_role_timeouts.sql`): `crm_app_user` 15 s / 5 s / 30 s and `crm_worker_user` 15 s / 15 s / 300 s.
   This covers a connection that does not come from the app pools (a script, a `psql` session). A role the migration's user may not alter is
   skipped with a notice, and the app-side settings still apply. Role settings live in the cluster, not in one database.

## Why the worker is looser

- The outbox drain claims rows in one transaction, runs every handler, then records the results on the same connection, so that connection is
  idle inside the transaction for as long as the handlers take. A 30 s limit would end it, roll the claim back and run the events again.
  Making the drain claim, dispatch and record in separate short transactions would let the worker use the request-path limits; that is a
  change to the drain and is not part of this setting.
- Inbound message ingest queues behind a per-conversation advisory lock, which `lock_timeout` also covers.

## What a firing limit means

- `55P03` on a request: another transaction held a lock for over 5 s. Look for it with
  `select pid, state, now() - xact_start as open_for, wait_event_type, left(query, 100) from pg_stat_activity where state <> 'idle' order by xact_start;`
  and `select * from pg_locks where not granted;`. The retry helper does not retry `55P03`; the caller (or the queue) tries again.
- `25P03` / "terminating connection due to idle-in-transaction timeout": code opened a transaction and then did something slow that is
  not a query (a network call, a long loop). Find it with the log line around the error. `qa 46` flags network calls inside a transaction.
- Sessions idle in a transaction right now:
  `select pid, application_name, now() - state_change as idle_for, left(query, 100) from pg_stat_activity where state = 'idle in transaction' order by state_change;`
  Anything older than 30 s on the API roles means a limit is not applied to that connection.

## Changing a limit

Set the env value (`DB_LOCK_TIMEOUT_MS`, `DB_IDLE_IN_TX_TIMEOUT_MS`, or the `_WORKER` variants in `.env`) and recreate the service. To change
the role default: `ALTER ROLE crm_app_user SET lock_timeout = '10s';` (new connections only). Roll back the role defaults with one statement per
setting: `ALTER ROLE <role> RESET statement_timeout;`, `... RESET lock_timeout;`, `... RESET idle_in_transaction_session_timeout;`.
