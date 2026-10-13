# Audit log API (`/v2/audit-log`)

Staff only. Spec: [audit-log-tenant.md](../specs/audit-log-tenant.md). Read keys: `audit.log.read`; export keys: `audit.log.export` (Owner and Admin by default, not Manager). Cursor pagination `{ data, page: { nextCursor, hasMore, limit }, range }`.

| Method and path                          | Key    | What                                                                                                                                                                                             |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v2/audit-log`                      | read   | Entries, newest first. Query: `from`, `to` (default last 30 days, at most 400 days, else 422 `AUDIT_RANGE_INVALID`), `actorId` (user uuid), `actorType` (`user                                   | system | api_key | bot | partner_agent | candidate | other`), `module`, `action`, `recordId`, `requestId`, `q`(module and action only),`actAs`, `limit`(1 to 100, default 50),`cursor`. Carries field NAMES, never values. |
| `GET /v2/audit-log/:id`                  | read   | One entry with `delta` per field `{old,new,masked}` through the PII-safe renderer and `canReveal`. Writes an `audit-log` / `read` audit row. Unknown or foreign id: 404 `AUDIT_ENTRY_NOT_FOUND`. |
| `GET /v2/audit-log/facets`               | read   | `{modules, actions, actors}` present in the window (`from`, `to`).                                                                                                                               |
| `GET /v2/audit-log/settings`             | read   | `{retentionDays (0 = forever, null = unknown), canExport, canReveal}`.                                                                                                                           |
| `POST /v2/audit-log/exports`             | export | 202. Body: the filters. Builds a masked CSV in the worker, kept 7 days, emailed. 409 `AUDIT_EXPORT_IN_PROGRESS`. Audited (`audit-log-exports` / `export`). `Idempotency-Key` required.           |
| `GET /v2/audit-log/exports`              | export | Latest 20 exports.                                                                                                                                                                               |
| `GET /v2/audit-log/exports/:id/download` | export | The CSV. 409 `AUDIT_EXPORT_NOT_READY` while building or after expiry; 404 `AUDIT_EXPORT_NOT_FOUND`.                                                                                              |

An entry's `actAs` is non-null when platform support acted as a user: `{reason, readOnly, startedAt}`; `actor` is then the user acted as.

Notifications additions (see [notifications.md](notifications.md)): `GET /v2/notifications?type=&q=`, `GET /v2/notifications/summary` (`unread`, `last24Hours`, `last7Days`, `total`, `byType`), `DELETE /v2/notifications/:id` (`{deleted:1}`, 404 if not yours).
