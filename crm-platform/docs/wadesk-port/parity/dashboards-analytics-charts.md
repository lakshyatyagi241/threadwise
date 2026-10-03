# Parity evidence: dashboards-analytics-charts (DASH)

WaDesk 1.7.0 vs this port. API reference: [docs/api/dashboards-analytics-charts.md](../../api/dashboards-analytics-charts.md); plan:
[port-map](../port-map/dashboards-analytics-charts.md).

Evidence is automated: `apps/api/test/e2e/dashboards-analytics-charts/{dash,health,admin-dash,widgets,panels}.e2e.spec.ts` (HTTP, real
Postgres, Redis and BullMQ), `apps/api/test/unit/dashboards-analytics-charts/*`, and the web unit tests under
`apps/web/src/features/dashboards-analytics-charts/`. Round 2 opened the running WaDesk once per screen (admin overview, admin
analytics, workspace dashboard, workspace analytics) and compared them with this port's screens side by side.

tier P0 done: WD-DASH-002, 003, 004, 005, 012, 022, 023, 024, 034, 035, 045, 048, 052 (045 is delivered by the PLAN domain, see below).
tier P1 done: WD-DASH-006, 013, 014, 015, 016, 018, 025, 026 (device counters), 030, 036, 039, 040, 041, 042, 043, 046, 047, 049 (bars), 053.
tier P2 done: WD-DASH-007, 011, 019, 021, 024, 027, 028, 031, 032, 038, 044, 051.

## Built

- Workspace dashboard `/dashboard` in WaDesk's card order: greeting with the "Workspace is calm" or running-broadcasts accent, Export
  (client CSV, 021), range dropdown, New campaign; Messages sent (with the last-20-hours bars), Read rate (sent/deliv/read mini tiles),
  Active contacts (006), wallet balance or the "Put replies on autopilot" prompt (007), sales-pipeline strip (011, plan-gated), throughput
  chart, live inbox (016), active campaigns (013), connected devices (014), top templates (015), engagement funnel, activity log (019).
- Workspace analytics `/analytics`: adds By device (026), Templates and Top contacts (028) and Team performance (030).
- Operator `/admin` is now the overview (034..040) and `/admin/analytics` the tabbed analytics (041..044). `/admin/financial`
  (045..047) is the PLAN domain's WD-PLAN-026 and covers the same KPIs, charts and tables; it is not rebuilt here.
- Operator system health `/admin/health` (048, 049 bars, 050 vitals, 051).

## Conformance pass (round 2)

Compared against the running WaDesk. Fixed: serif page titles with an italic accent word, mono kicker lines, the dashboard card order
and contents (WaDesk has no Deliverability or Replies tiles: they moved into the Read-rate mini tiles and the throughput footer), range
as a dropdown, KPI pills, the pipeline strip, empty states with their call-to-action buttons, the admin overview's section order and the
admin analytics tab map (panel visibility per tab, as WaDesk's `data-wa-tab-panel`).

## Deliberate deviations (intended)

| Id          | WaDesk                                                       | Port                                                                                                   | Reason                                                                        |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| WD-DASH-001 | "Live synced 4s ago" label that never updates                | dropped                                                                                                | static text that lies                                                         |
| WD-DASH-006 | Subscribed and Opted-in are one column                       | same, two bars with equal values                                                                       | parity; the schema has one flag                                               |
| WD-DASH-014 | `sent_24h` never written, slots fixed at 6                   | slots follow the plan device limit (6 when unlimited, never below the count); counters read as stored  | port note; per-device live counts need a sender id on messages                |
| WD-DASH-015 | Column "CTR" is really the read rate                         | column named "Read rate"                                                                               | inventory port note                                                           |
| WD-DASH-026 | counts messages by an encrypted number, always 0             | the bridge's 24-hour counter, busiest first                                                            | messages carry no sender device here                                          |
| WD-DASH-028 | top contacts scanned the 20 newest conversations             | a true top 5 over the window                                                                           | inventory port note                                                           |
| WD-DASH-030 | credit to the current assignee, wall-clock minutes           | same                                                                                                   | parity                                                                        |
| WD-DASH-034 | "24h" is two days, "7d" is eight (calendar snapping)         | exact N-day spans ending today (UTC)                                                                   | inventory port note                                                           |
| WD-DASH-035 | raw sum across currencies, profit is 32% of income           | converted to the platform currency; profit kept as a labelled 32% estimate                             | port note; WaDesk's own docs say it is not an accounting figure               |
| WD-DASH-036 | 12 buckets stop short of the window end                      | buckets cover the whole window, the header total equals the income card; target kept (+10%, floor 100) | inventory acceptance criterion marks it a deliberate fix                      |
| WD-DASH-038 | only the top 3 gateways                                      | top 3 plus an "Other" slice; premium counted by plan slug, not by a numeric id                         | port note                                                                     |
| WD-DASH-039 | MRR is the list price, not normalised                        | monthly-normalised, offer-aware                                                                        | port note                                                                     |
| WD-DASH-042 | Messages shows "-" always (missing table)                    | real outbound count; devices online over every device                                                  | inventory acceptance criterion                                                |
| WD-DASH-043 | days without signups absent from the chart                   | zero-filled                                                                                            | port note                                                                     |
| WD-DASH-044 | export not audited                                           | one audit row per export                                                                               | port note                                                                     |
| WD-DASH-034 | all platform admins                                          | super admin and the read-only auditor; support operators are refused                                   | the numbers are every workspace's money (same rule as the PLAN reports)       |
| WD-DASH-048 | the polled repaint leaves the overall banner stale           | the banner is repainted with the cards                                                                 | the inventory port note calls the stale banner a defect                       |
| WD-DASH-048 | probes `jobs`/`failed_jobs` tables, cache driver, media disk | Postgres, Redis, BullMQ, `NODE_BRIDGE_URL`, `S3_ENDPOINT`                                              | different engine; same five cards in the same order                           |
| WD-DASH-051 | deletes every row of `jobs` and `failed_jobs`, no audit      | drains waiting and delayed jobs, removes failed ones, never touches running jobs, audited, super admin | the inventory marks the blanket delete as dangerous and asks for these guards |

## Blocked or not built (recorded, not dropped)

| Id                  | Why                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WD-DASH-001         | the home router (admin to `/admin`, agents to the inbox) lives in the web shell's landing logic, not this zone                                         |
| WD-DASH-008         | Instagram band: no Instagram channel domain                                                                                                            |
| WD-DASH-009, 010    | Quick access tiles and drawer: need a per-user preference store and the customer shell's drawer slot (ASHELL)                                          |
| WD-DASH-017         | Flow Copilot card and Automation flows list: the flow builder and runtime domains are not built                                                        |
| WD-DASH-020         | quick-action tiles and integrations health: the integrations domains are not built (partial in WaDesk too)                                             |
| WD-DASH-029         | geography by device region and the event stream: no live message feed endpoint; WaDesk's own panels are static and always 0                            |
| WD-DASH-037         | countries and region radar render their WaDesk empty state: the users table keeps no country (WaDesk stored a dial prefix, so its panel was empty too) |
| WD-DASH-050         | WhatsApp engine cards (devices and provider configs are tenant tables; needs the WADEV/WABA sender registry)                                           |
| WD-DASH-033         | docs-only in WaDesk (scheduled analytics report), not ported on purpose                                                                                |
| WD-DASH-054         | dead code, not ported on purpose                                                                                                                       |
| Add workspace, rows | the admin overview's "Add workspace" button and row links need the operator workspace screens (WSP admin), not built; "View all" opens workspace plans |

## Not verified

- Charts with real traffic: all screenshots ran on a database with almost no messages, orders or devices.
- A browser smoke spec for the console pages (none written; the screens were compared by hand once).
- The bridge probe against a real Node bridge (tested against a local HTTP server and the harness stub).
