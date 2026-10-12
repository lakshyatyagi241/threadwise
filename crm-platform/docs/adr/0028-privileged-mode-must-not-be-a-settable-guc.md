# ADR-0028: privileged mode must not be something the application role can switch on

Status: **Proposed**. Needs an owner decision (tenancy audit finding TI-001). Nothing in this ADR is implemented.

## Context

Tenant isolation is Row-Level Security. Every tenant table's policy is

```sql
USING (org_id = current_org_id() OR app_is_privileged())
```

and `app_is_privileged()` is `current_setting('app.privileged', true) = 'on'`. `withPrivileged()` sets it with
`set_config('app.privileged', 'on', true)`. The application connects as `crm_app_user` (NOSUPERUSER, NOBYPASSRLS), and that role
may call `set_config` like any role.

`docs/architecture/multi-tenancy.md` already says the mechanism is "application-enforced rather than database-enforced". The
audit measured what that means (2026-10-11, scratch database, restricted role):

```sql
begin;
select set_config('app.org_id', '<tenant A>', true);
select set_config('app.privileged', 'on', true);
select count(*) from organizations;   -- every organization, not just A
```

So **any SQL that runs on an application connection can read and write every tenant**: one SQL injection, one unsafe raw
query, one compromised dependency that gets a handle on the pool. RLS, forced on 287 tenant tables and now checked by 1,705
generated scenarios, is a strong guard against a missing `WHERE org_id`, and no guard at all against attacker-chosen SQL.

No such injection path was found: the queries reviewed are parameterised, and `withTenant` deliberately uses `set_config` with a
bind parameter. This is about blast radius if one ever appears, and about being able to say that isolation does not depend on
every query in the codebase being perfect.

## Options

**A. Privileged work uses a different database role (recommended).**
`app_is_privileged()` becomes a check on the connection's role, for example
`pg_has_role(current_user, 'crm_privileged', 'USAGE')`, instead of a GUC. `db.privileged()` runs on a second pool that logs in as a
role that is a member of `crm_privileged`; the normal pool's role is not and cannot `SET ROLE` into it (grant membership with
`INHERIT FALSE, SET FALSE`). Injected SQL on the normal pool then cannot escalate, because the switch is a connection property the
SQL cannot change.
Cost: a second pool and credential in every process that calls `privileged()` (the API as well as the worker: login and API-key
lookups are pre-tenant), policy and function changes in one migration, and a performance/connection-count review. SECURITY
DEFINER lookups such as `waba_route_lookup` keep working but should stop toggling the GUC and instead be owned by a privileged
role.

**B. Keep the GUC, require a secret.**
`app_is_privileged()` compares the GUC to a value the server holds, checked through a SECURITY DEFINER function. Cheaper, but the
secret has to live in the application process that an injection already controls, so it is obscurity, not a boundary.

**C. Accept the limitation and compensate.**
Keep today's design; add the static scan that already exists (a new `privileged()` call site fails the audit), a CI rule against
raw SQL string building, and monitoring for `app.privileged` appearing in the query log of the normal pool. Cheapest, and leaves
the blast radius as it is.

## Recommendation

Option A, in a dedicated change, with C's controls in place meanwhile (they already are: the call-site ratchet is in
`tools/tenancy-audit`, and the 70 files that use `privileged()` have all been reviewed). It is the only option where a single
injected statement cannot reach another tenant.

## Open questions for the owner

1. Is a second connection pool acceptable on the API process, or should privileged lookups move behind a small internal service?
2. Are there deployments where the database role model cannot be changed (managed Postgres with a single user)?
3. Should the migration also move the `SECURITY DEFINER` lookups (`*_lookup`, `marketplace_start_trial`, ...) to a dedicated owner
   role so that they no longer need `set_config('app.privileged', ...)` at all?

## Consequences if accepted

One migration (policies, `app_is_privileged()`, function ownership), changes to `DatabaseService`, `.env`/provisioning for the
second credential, and a new generated check in `tenancy-isolation.generated.spec.ts` that the normal role **cannot** reach another
tenant even after setting the GUC. That check is the regression test for this finding and fails today by design.
