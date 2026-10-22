-- perf: the three functions every row-level-security policy calls are PARALLEL SAFE (QA: API and query timing report).
-- Why this migration exists: a function is PARALLEL UNSAFE unless declared otherwise, and one such function anywhere in a query's
-- policy qualification stops Postgres from planning that query in parallel. Every tenant table's `tenant_isolation` policy calls
-- current_org_id() and app_is_privileged(), so for the application role no scan over a large table could use parallel workers: the
-- message-history counts over 750,000 messages took 499 ms serial, and 175 ms with workers once these were marked (same rows, same result).
-- They are safe: each only reads a custom setting (current_setting('app.org_id' | 'app.user_id' | 'app.privileged', true)), changes nothing,
-- and a parallel worker is started with the leader's settings, `SET LOCAL` ones included. Re-checked by tools/perf/parallel-rls-check.mjs.
-- The planner still decides per query: only a scan big enough to pay for the workers is made parallel, small lookups are unchanged.
ALTER FUNCTION current_org_id() PARALLEL SAFE;
ALTER FUNCTION current_actor_id() PARALLEL SAFE;
ALTER FUNCTION app_is_privileged() PARALLEL SAFE;
