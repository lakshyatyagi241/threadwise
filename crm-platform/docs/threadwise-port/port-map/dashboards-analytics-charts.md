# Port map: dashboards-analytics-charts (DASH)

Spec: `docs/threadwise-port/inventory/dashboards-analytics-charts.md`. Zone: `ownership.json` key `dashboards-analytics-charts`.

## Shape of the domain

Reference's DASH is a read-only numbers layer. It owns no table, so this port adds **no table, no RLS and no outbox event**; the one
migration registers two capability keys. Every figure is a live SQL aggregate over the message stream other domains own (`messages`; Reference's
`messages` and `inbox_messages` are folded into it), computed on the caller's tenant connection (forced RLS plus an explicit `org_id`).

## Target modules, tables, contracts

| Piece      | Where                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API module | `apps/api/src/modules/dashboards-analytics-charts/` (`dash-window.ts` and `dash-metrics.ts` are pure; repository, service, controllers, plan guard)                                             |
| Contracts  | `packages/contracts/src/dashboards-analytics-charts/index.ts`                                                                                                                                   |
| Migration  | `packages/db/migrations/20261005100000_dash_permissions.sql` (permission keys and Admin grants)                                                                                                 |
| Reads      | `messages` (the folded stream, TW-DASH-002), `organizations.settings.timezone`                                                                                                                  |
| Web        | `apps/web/src/features/dashboards-analytics-charts/` (api, lib, components), routes `(app)/(dashboards-analytics-charts)/{dashboard,analytics}`, `messages/en/dashboards-analytics-charts.json` |
| Tests      | `apps/api/test/unit/dashboards-analytics-charts/`, `apps/api/test/e2e/dashboards-analytics-charts/`, web unit tests beside the code                                                             |

## Endpoints and permission keys

| Endpoint                          | Permission            | Plan gate                               | Features                   |
| --------------------------------- | --------------------- | --------------------------------------- | -------------------------- |
| `GET /v2/dashboard/summary?range` | `dash.dashboard.read` | none                                    | TW-DASH-002..005, 018      |
| `GET /v2/dashboard/throughput`    | `dash.dashboard.read` | none                                    | TW-DASH-012                |
| `GET /v2/analytics/overview`      | `dash.analytics.read` | `analytics` (422 `PLAN_FEATURE_LOCKED`) | TW-DASH-022..025, 027, 031 |
| `GET /v2/analytics/export`        | `dash.analytics.read` | `analytics`                             | TW-DASH-032 (CSV)          |

Reference's "workspace role manager or above" becomes two capabilities a workspace can hand to any role; the Admin preset holds both.

## Web screens

`/dashboard` (KPI tiles, throughput chart with peak and averages, last-20-hours sparkline, funnel) and `/analytics` (window picker
with custom dates, trend tiles, volume chart, delivery-rate donut, stacked daily totals, funnel with previous-period delta, type
mix, hour heatmap, CSV). Nav entries are gated on the permission and, for analytics, the plan feature. Charts are hand-drawn
SVG/CSS from the page's colour tokens (no chart dependency may be added), each with a screen-reader table.

## Prerequisites from other domains

| Needed                                       | State                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| message streams (CHAT, TIB1)                 | tables exist (schema port); nothing writes them yet, so numbers are zero until those ship |
| engine scope (WADEV/WABA enabled-engine set) | not available: no engine filter is applied (see deviations in the run report)             |
| plan flag `analytics` (PLAN)                 | built; resolved with `resolveFeature`                                                     |
| platform-wide reads for the admin surfaces   | missing: no sanctioned cross-tenant door for orders, revenue or health probes             |

## Build order and status

1. Permissions migration, contracts, pure window and metric rules, repository, service, controllers: done and tested.
2. Dashboard and analytics screens: done, typechecked, linted; client logic and message keys unit-tested.
3. Operator system health (TW-DASH-048, 049 bars, 050 vitals, 051): done and tested. `GET /v2/platform/health`,
   `POST /v2/platform/health/clear-queue`, console page `/admin/health`, entry merged into the console menu. No cross-tenant read.
4. Not built: the admin overview, analytics and financial surfaces TW-DASH-034..047 and the platform-wide parts of 049 and 050 (need
   a cross-tenant read door, see parity/dashboards-analytics-charts.md), the home-router
   redirect rules (TW-DASH-001, in the web shell's landing logic), Active contacts (006), wallet card (007), Instagram band (008),
   Quick access (009, 010; needs a per-user preference store), pipeline strip (011), campaign, device, template, inbox, flow and
   activity cards (013..020; need BCAST, WADEV, TPL, TIB1, FLR, NOTIF), per-device, geography and team performance (026, 029, 030),
   scheduled report (033).

## Risks

- Counts scan `messages` per request. The `(org_id, created_at)` shape and the `org_id` prefixed indexes bound
  this to the window; a rollup table is the upgrade if a workspace's windows get large.
- Until the chat domains write messages, the screens render their empty states only.
