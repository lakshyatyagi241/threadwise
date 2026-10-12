# Dashboard (the screen after sign-in)

The phone version of the web dashboard: `apps/web/src/features/dashboards-analytics-charts/components/dashboard-screen.tsx`
(route `/dashboard`, feature ids TW-DASH-001 to 021). Same numbers, same cards, same wording where it fits, in one column.
Behaviour is the contract (ADR-0027); the layout is a phone adaptation.

## Where the data comes from

All through `apiFetch`, parsed with the shared contracts in `packages/contracts/src/dashboards-analytics-charts/` (no mocks).

| Call                           | Used for                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /v2/dashboard/summary`    | greeting line, sent and read-rate cards, sparkline, funnel (`dash.dashboard.read`)                 |
| `GET /v2/dashboard/throughput` | the chart, the peak badge, the four figures under it                                               |
| `GET /v2/dashboard/widgets`    | contacts, campaigns, devices, templates, inbox, pipeline, Instagram, flows, activity, integrations |
| `GET /v2/analytics/panels`     | the Agent view's team list; only asked for while that view is open, with `dash.analytics.read`     |
| `GET /v2/wallet/summary`       | the wallet card; only asked for with `wallet.balance.read`                                         |
| `GET /v2/billing/entitlements` | whether the personal-number engine is on (decides if the Devices card exists)                      |
| `GET /v2/auth/session`         | name, workspace time zone, role, permissions, `landing` (`@/lib/session`)                          |

The window (24 hours, 7 days, 30 days, quarter to date) is one piece of state; it is sent to the first three calls. Pulling the page
down refreshes all of them. The previous window stays on screen while a new one loads.

## The three views (the dropdown at the top)

The title is a dropdown, like the inbox's: **Summary** (the cards above), **Agent** and **Bot**. They come from the phone design; the
web has no pages with those names, so each shows what the API already has:

- **Agent**: the team panel of the analytics API (`team` of `GET /v2/analytics/panels`), the same rows as the web analytics page: per
  person the conversations given, how many were resolved, average first reply and resolution time, and the customers' rating, with the
  team totals above. It uses the date pill. Without `dash.analytics.read` it says so and asks for nothing; a plan without analytics
  answers 403 `PLAN_FEATURE_LOCKED` and the view says that.
- **Bot**: the automation flows (`flows` of `GET /v2/dashboard/widgets`, which ignores the date window, so this view has no date
  pill): flows running, people in them, and the latest flows.
- The API has no counts of "conversations handled by a bot" against "by an agent", so those two figures of the phone design are not
  shown; adding them needs an API route first (owner decision).

## What the phone does differently (on purpose)

- A 403 on the summary shows "your role (X) does not have access" instead of redirecting to the inbox: the app has no inbox yet.
- A workspace whose `landing` is `onboarding` (setup not finished) still sees the dashboard, with a banner. The web locks such an
  account to the setup wizard; the wizard is a first-priority backlog item and is not built in the app yet.
- Subscribed and Opted-in show the same count and the Integrations total is the catalog size, exactly as the web does.
- Instagram accounts are shown by initial and status only; remote avatar images are not loaded.
- The throughput chart draws sent, delivered and failed side by side, and over each other when there are too many buckets for that
  (30 days, quarter). It never scrolls sideways.
- Numbers, money and dates use ordinary digits in every language (Marathi would otherwise mix ‘१,२५०’ with plain numbers).

## Not built yet (recorded, not dropped)

| Web feature                                                                        | Why it waits                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Quick-access tiles and their editor (TW-DASH-009)                                  | every tile opens a screen the app does not have yet                                                    |
| Quick-actions card (new campaign, flow, template)                                  | same: no destination screens                                                                           |
| "Copilot" promo card with its two buttons                                          | the flow builder; the flow counters it carries are in the Flows card                                   |
| Links: Open inbox, View all, Top up, Connect                                       | same: no destination screens                                                                           |
| CSV export of the chart (TW-DASH-021)                                              | needs a share sheet / file library: a `mobile-native-capability` review first                          |
| Custom date range                                                                  | needs a date picker (native library); the four ready-made windows cover the common cases               |
| Live wallet balance by push                                                        | needs the realtime client; the balance refreshes on pull-down and when the app comes back to the front |
| Account gates (suspended, forced password change, MFA enrolment, unverified email) | backlog "P0 before any other feature"                                                                  |

When a destination screen exists, add its link to the card that carries it, and take its row off this table.
