# Data retention API (`/v2/platform/data-retention`)

Operator console only (`platform_operator`, IP allowlist and MFA from `OperatorGuard`). Every operator may read; only a super admin writes. Runbook and rules:
[data-retention.md](../runbooks/data-retention.md#the-dashboard-what-a-super-admin-sets). Shapes: `packages/contracts/src/data-retention`.

| Method and path                                      | Role        | What                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/platform/data-retention`                    | operator    | `{ engine: { enabled, dryRun, archiveDriver, archiveDurable }, items: [...] }`. Per item: live and archive days (saved or built-in), `source`, `deleteAfterDays`, limits, `rowVersion`, `applied`, live size, archive size, last run. |
| `PATCH /v2/platform/data-retention/items/:id`        | super_admin | Body `{ liveDays, archiveDays \| null, rowVersion \| null }`. 422 `VALIDATION_FAILED` outside the limits; 409 `ROW_VERSION_CONFLICT` when the version is stale. Audited. Deletes nothing itself.                                      |
| `DELETE /v2/platform/data-retention/items/:id`       | super_admin | Back to the built-in behaviour. Safe to repeat. Audited when there was a saved policy.                                                                                                                                                |
| `POST /v2/platform/data-retention/items/:id/preview` | operator    | Body `{ liveDays, archiveDays \| null }`. What the next run would archive or delete with those values. Changes nothing.                                                                                                               |

Item ids: `an_events`, `audit_log`, `security_events`, `audit_log_exports`.
