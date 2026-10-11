# Workspace inactivity lifecycle (not in Reference; ADR-0028)

Added at the owner's request. Reference has only the lapsed-plan data wipe (TW-PLAN-023, kept as is and separate).

| Part            | Where                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tables          | `organizations` (new columns), `org_lifecycle_log`, `storage_purge_queue` (`20261116090000_org_lifecycle.sql`)   |
| Permissions     | `platform.workspace.retention`, `platform.workspace.legal_hold` (`20261116090100_org_lifecycle_permissions.sql`) |
| Activity clock  | `kernel/activity/activity.service.ts`, called from `JwtAuthGuard`; messages folded in by the sweep               |
| Policy, service | `workspaces-teams-tenancy/lifecycle/` (`lifecycle.policy.ts` pure decisions)                                     |
| Operator API    | `platform-workspace-lifecycle.controller.ts`, `/v2/platform/workspace-lifecycle`                                 |
| Worker          | `lifecycle-sweep.service.ts` (cron 03:15), `lifecycle-notification.consumer.ts` (mails owner and admins)         |
| Settings        | `ORG_LIFECYCLE_ENABLED`, `ORG_LIFECYCLE_DRY_RUN`, `ORG_LIFECYCLE_DELETE_ENABLED`                                 |
| Web             | Workspaces hub (operator): retention panel                                                                       |

Upstream: plan state (`org_plan_state`, `plans`) decides the paid exemption; sessions (`auth_sessions`) are ended on archive; the owner's
delete (`workspace-settings.service.ts`, now stamps `deleted_at`) feeds the owner-deleted erasure; `orders` feeds the sales-record archive.
Open: see ADR-0028 open items.
