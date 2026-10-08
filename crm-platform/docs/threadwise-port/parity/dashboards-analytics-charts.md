# Parity evidence: dashboards-analytics-charts (DASH)

Reference 1.7.0 vs this port. API reference: [docs/api/dashboards-analytics-charts.md](../../api/dashboards-analytics-charts.md); plan:
[port-map](../port-map/dashboards-analytics-charts.md).

Evidence is automated: `apps/api/test/e2e/dashboards-analytics-charts/{dash,health,admin-dash,widgets,panels}.e2e.spec.ts` (HTTP, real
Postgres, Redis and BullMQ), `apps/api/test/unit/dashboards-analytics-charts/*`, and the web unit tests under
`apps/web/src/features/dashboards-analytics-charts/`. Round 2 opened the running Reference once per screen (admin overview, admin
analytics, workspace dashboard, workspace analytics) and compared them with this port's screens side by side.

tier P0 done: TW-DASH-002, 003, 004, 005, 012, 022, 023, 024, 034, 035, 045, 048, 052 (045 is delivered by the PLAN domain, see below).
tier P1 done: TW-DASH-006, 013, 014, 015, 016, 018, 025, 026 (device counters), 030, 036, 039, 040, 041, 042, 043, 046, 047, 049 (bars), 053.
tier P1 round 3 done: TW-DASH-050 (engine cards), 029 is P2 below.
tier P2 round 3 done: TW-DASH-008 (Instagram band, dashboard and analytics), 017 (Copilot card, flows list), 020 (quick actions, integrations, per workspace), 029 (geography by contact country, event stream), 032 (Reference's five rows and file name), 037 (admin geography from signup country), 010 (delivered by the shell, TW-ASHELL-022), 001 (home router is the AUTH landing; the dashboard sends a member below manager to the inbox).
tier P2 done: TW-DASH-007, 009, 011, 019, 021, 024, 027, 028, 031, 032, 038, 044, 051 (009 added in the completion pass).

## Built

- Workspace dashboard `/dashboard` in Reference's card order: greeting with the "Workspace is calm" or running-broadcasts accent, Export
  (client CSV, 021), range dropdown, New campaign; Messages sent (with the last-20-hours bars), Read rate (sent/deliv/read mini tiles),
  Active contacts (006), wallet balance or the "Put replies on autopilot" prompt (007), sales-pipeline strip (011, plan-gated), throughput
  chart, live inbox (016), active campaigns (013), connected devices (014), top templates (015), engagement funnel, activity log (019).
- Workspace analytics `/analytics`: adds By device (026), Templates and Top contacts (028) and Team performance (030).
- Operator `/admin` is now the overview (034..040) and `/admin/analytics` the tabbed analytics (041..044). `/admin/financial`
  (045..047) is the PLAN domain's TW-PLAN-026 and covers the same KPIs, charts and tables; it is not rebuilt here.
- Operator system health `/admin/health` (048, 049 bars, 050 vitals, 051).

## Conformance pass (round 2)

Compared against the running Reference. Fixed: serif page titles with an italic accent word, mono kicker lines, the dashboard card order
and contents (Reference has no Deliverability or Replies tiles: they moved into the Read-rate mini tiles and the throughput footer), range
as a dropdown, KPI pills, the pipeline strip, empty states with their call-to-action buttons, the admin overview's section order and the
admin analytics tab map (panel visibility per tab, as Reference's `data-wa-tab-panel`).

## Deliberate deviations (intended)

| Id          | Reference                                                                 | Port                                                                                                                                                                                                                        | Reason                                                                                  |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TW-DASH-001 | "Live synced 4s ago" label that never updates                          | dropped                                                                                                                                                                                                                     | static text that lies                                                                   |
| TW-DASH-003 | four fixed ranges (24h, 7d, 30d, quarter to date)                      | adds a fifth, custom From/To (inclusive days in the workspace zone; reversed pair swapped; a future date cut to today; none given = last 30 days; over 366 days answers 422); kept in the address as `range=custom&from&to` | requested addition, same window rules and cap as the analytics page                     |
| TW-DASH-006 | Subscribed and Opted-in are one column                                 | same, two bars with equal values                                                                                                                                                                                            | parity; the schema has one flag                                                         |
| TW-DASH-014 | `sent_24h` never written, slots fixed at 6                             | slots follow the plan device limit (6 when unlimited, never below the count); counters read as stored                                                                                                                       | port note; per-device live counts need a sender id on messages                          |
| TW-DASH-009 | tile hover text from two copy sets; catalog keys point at Reference paths | one copy set (the catalog description); catalog urls map to this app's routes (`devices` is `/channels`); tile copy is English from the API                                                                                 | the inventory port notes ask for routes of the new app; tile copy is not yet translated |
| TW-DASH-015 | Column "CTR" is really the read rate                                   | column named "Read rate"                                                                                                                                                                                                    | inventory port note                                                                     |
| TW-DASH-026 | counts messages by an encrypted number, always 0                       | the bridge's 24-hour counter, busiest first                                                                                                                                                                                 | messages carry no sender device here                                                    |
| TW-DASH-028 | top contacts scanned the 20 newest conversations                       | a true top 5 over the window                                                                                                                                                                                                | inventory port note                                                                     |
| TW-DASH-030 | credit to the current assignee, wall-clock minutes                     | same                                                                                                                                                                                                                        | parity                                                                                  |
| TW-DASH-034 | "24h" is two days, "7d" is eight (calendar snapping)                   | exact N-day spans ending today (UTC)                                                                                                                                                                                        | inventory port note                                                                     |
| TW-DASH-035 | raw sum across currencies, profit is 32% of income                     | converted to the platform currency; profit kept as a labelled 32% estimate                                                                                                                                                  | port note; Reference's own docs say it is not an accounting figure                         |
| TW-DASH-036 | 12 buckets stop short of the window end                                | buckets cover the whole window, the header total equals the income card; target kept (+10%, floor 100)                                                                                                                      | inventory acceptance criterion marks it a deliberate fix                                |
| TW-DASH-038 | only the top 3 gateways                                                | top 3 plus an "Other" slice; premium counted by plan slug, not by a numeric id                                                                                                                                              | port note                                                                               |
| TW-DASH-039 | MRR is the list price, not normalised                                  | monthly-normalised, offer-aware                                                                                                                                                                                             | port note                                                                               |
| TW-DASH-042 | Messages shows "-" always (missing table)                              | real outbound count; devices online over every device                                                                                                                                                                       | inventory acceptance criterion                                                          |
| TW-DASH-043 | days without signups absent from the chart                             | zero-filled                                                                                                                                                                                                                 | port note                                                                               |
| TW-DASH-044 | export not audited                                                     | one audit row per export                                                                                                                                                                                                    | port note                                                                               |
| TW-DASH-034 | all platform admins                                                    | super admin and the read-only auditor; support operators are refused                                                                                                                                                        | the numbers are every workspace's money (same rule as the PLAN reports)                 |
| TW-DASH-048 | the polled repaint leaves the overall banner stale                     | the banner is repainted with the cards                                                                                                                                                                                      | the inventory port note calls the stale banner a defect                                 |
| TW-DASH-048 | probes `jobs`/`failed_jobs` tables, cache driver, media disk           | Postgres, Redis, BullMQ, `NODE_BRIDGE_URL`, `S3_ENDPOINT`                                                                                                                                                                   | different engine; same five cards in the same order                                     |
| TW-DASH-051 | deletes every row of `jobs` and `failed_jobs`, no audit                | drains waiting and delayed jobs, removes failed ones, never touches running jobs, audited, super admin                                                                                                                      | the inventory marks the blanket delete as dangerous and asks for these guards           |

- Quick access (009): stored on `user_settings.quick_access` (no new table), per user per workspace, audited; the empty-list-reads-as-default quirk and the no-reordering quirk are kept on purpose.

## Round 3 notes and deviations

| Id          | Reference                                                                                  | Port                                                                                                                                                                           | Reason                                                         |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| TW-DASH-001 | agent or viewer redirected with a warning flash                                         | redirected to the inbox, no flash                                                                                                                                              | no global flash mechanism; the router itself is AUTH's landing |
| TW-DASH-008 | band keyed to the Instaflow mirror                                                      | same data from workspace_ig_accounts and conversations on instagram channels; archived chats are not open                                                                      | port note                                                      |
| TW-DASH-017 | links /flows/builder with ai_prompt                                                     | same links; the flow builder (FLB) screens are not built, the links 404 until it is                                                                                            | contract kept                                                  |
| TW-DASH-020 | "/ 12", WooCommerce marked by any tenant's webhook traffic, Shopify never, Sheets never | "/ 10" real catalog (WooCommerce, Shopify, Sheets, Meta catalog, HubSpot, Slack, Trello, webhooks, incoming webhooks, Instagram), per workspace, from the connection tables    | inventory rebuild requirements                                 |
| TW-DASH-029 | geography by device region (always 0), stream shows the workspace's own number          | by country of the contact's number (own dial table, top 7, "Unspecified"), stream of the 6 newest messages with the contact's number; "Live" tag and dead Pause button dropped | port note                                                      |
| TW-DASH-032 | five rows                                                                               | the five rows plus the KPI grid and daily series; file named app-analytics-from-to.csv                                                                                         | rule 4                                                         |
| TW-DASH-037 | users.country_code dial prefix, radar always zero                                       | ISO country from the profile, else the dial prefix mapped; top four, share of the four                                                                                         | rule 1                                                         |
| TW-DASH-050 | PHP and Laravel vitals                                                                  | engine cards for devices, WABA and Twilio configs across workspaces; vitals were already Node ones                                                                             | port note                                                      |
| TW-DASH-009 | tiles on the dashboard                                                                  | the dashboard now renders the shell's QuickAccessTiles (the main one); the DASH copy and its endpoints stay                                                                    | team rule                                                      |

## Blocked or not built (recorded, not dropped)

| Id                  | Why                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TW-DASH-001         | the home router (admin to `/admin`, agents to the inbox) lives in the web shell's landing logic, not this zone                                                     |
| TW-DASH-008         | Instagram band: no Instagram channel domain                                                                                                                        |
| TW-DASH-010         | the global edge drawer lives in the customer shell layout (ASHELL zone, not editable here); the tiles it would show come from `GET /v2/quick-access`, ready for it |
| TW-DASH-017         | Flow Copilot card and Automation flows list: the flow builder and runtime domains are not built                                                                    |
| TW-DASH-020         | quick-action tiles and integrations health: the integrations domains are not built (partial in Reference too)                                                         |
| TW-DASH-029         | geography by device region and the event stream: no live message feed endpoint; Reference's own panels are static and always 0                                        |
| TW-DASH-037         | countries and region radar render their Reference empty state: the users table keeps no country (Reference stored a dial prefix, so its panel was empty too)             |
| TW-DASH-050         | WhatsApp engine cards (devices and provider configs are tenant tables; needs the WADEV/WABA sender registry)                                                       |
| TW-DASH-033         | docs-only in Reference (scheduled analytics report), not ported on purpose                                                                                            |
| TW-DASH-054         | dead code, not ported on purpose                                                                                                                                   |
| Add workspace, rows | the admin overview's "Add workspace" button and row links need the operator workspace screens (WSP admin), not built; "View all" opens workspace plans             |

## Verification (round 2 close)

API unit 43, API e2e 67 (6 files), web 28 passed against a freshly migrated crm_dash; arch:check 0 errors; db:verify-schema 0 errors. Typecheck errors that remain belong to other domains' specs (campaigns, telegram, bridge, chat, plan-draft), none in DASH files.

## Verification (round 3)

API unit 46, API e2e for extras 7, widgets 10, panels 8, health 11, admin-dash 14, dash 26 of 27 (see below), web 32, db:verify-schema 0 errors. arch:check reports 7 errors in chat-conversations and flow-runtime-engine, none in DASH.

## Not verified

- dash.e2e "24h window is the rolling day" failed once in this run (5 outbound rows inside the window); it is time-of-day sensitive in its seed and was not touched by round 3. Not re-run in isolation.
- Compared by eye against our own screenshot only; the live Reference pages were not re-opened in round 3 (conformance of round 2 stands). Admin screens (overview, analytics, health) were not re-screenshotted (no operator account could be created: the operator:create CLI failed).
- Charts with real traffic; a browser smoke spec; the bridge probe against a real bridge.

## Playwright twin run: TW-DASH-003 (custom date range)

Spec `apps/web/e2e/dashboards-analytics-charts/parity/TW-DASH-003.twin.mjs`, depth full, against the running Reference and this checkout on a freshly migrated scratch database (the shared dev database lacked recent migrations, so its widget calls failed regardless of range).

| Area                                                                                    | Result                                                                                                                           |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard page probes (load, responsive, accessibility, keyboard, degraded, auth, perf) | same as Reference                                                                                                                   |
| Keyboard focus ring                                                                     | 56 of 57 stops show one; the one without is the Next.js dev-tools overlay, dev server only (intended, not in a production build) |
| Structure (landmarks, nav collapse on small screens, markup counts)                     | differs by design (our shell and tokens); reviewed, no defect                                                                    |
| Custom range, ours only (Reference has no counterpart)                                     | valid, reversed, no dates, garbage text and script in the address all answer 200 with no script run; over 366 days answers 422   |
| Defect found and fixed                                                                  | a To date far in the future (2099) answered 422 because the cap ran before the cut to today; now cut first, unit test added      |

Open: none. Not covered: the Apply button flow by click (scenarios drive the address), other locales.

## Round 4 (completion pass)

- TW-DASH-017 verified: `/flows/builder` exists on main and reads `?ai=1` and `?ai_prompt=` (opens the AI generate dialog pre-filled), so the Generate flow and Examples links work; the earlier "links 404" note no longer applies. Flow rows show the trigger with underscores as spaces ("Order placed").
- `/dashboard` cosmetic parity: "Live · synced Ns ago" chip in the kicker (a real counter from the last successful summary fetch, not Reference's frozen "4s"; supersedes the TW-DASH-001 "dropped" deviation), 24h/7d/30d/QTD tabs and the UTC offset chip on the throughput card (the tabs drive the page range, as the dropdown does), 0..2 axes drawn when the window has no data, table header kept in the empty templates state, "n device slots available / Add WABA / Connect device" strip shown whenever slots are free (also with no devices), integrations counter "n / 12" (Reference's conceptual total; we count the ten tables we have), device slots never below 6 (Reference's fixed cap; the plan device limit still applies when higher), and a ring beside the read rate.
- extras.e2e seed updated to the flows constraints the FLB domain added (trigger kinds, non-empty names).
- Not re-compared this round: admin overview, analytics, health and chart widgets were compared in round 2/3 screenshots only. The admin overview differs from Reference by the "Add workspace" button (blocked, WSP) and an extra MRR column (kept).
- Verification: API e2e dashboards-analytics-charts 82 tests (dash, health, admin-dash, widgets, panels, quick-access, extras), API unit 46, web feature tests 32, all green on a freshly migrated crm_dash.
