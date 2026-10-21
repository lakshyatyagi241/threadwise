# CRM dashboard (`/crm`)

Reference: `CrmController@dashboard` (plan feature `access_sales_pipeline`). Code: `apps/api/src/modules/crm/crm-dashboard`, contract `packages/contracts/src/crm/crm-dashboard.ts`, screen `apps/web/src/features/crm-dashboard`.

## `GET /v2/crm/dashboard`

Auth: user. Capability `record.deals.read` (its record scope applies to deals). Plan: `sales_pipeline` (422 `PLAN_FEATURE_LOCKED` otherwise, reads included, as the other deals routes).

Query: `range` (`month` default, `7d`, `30d`, `90d`, `custom`), `from`/`to` (custom, `YYYY-MM-DD`, inclusive, max 366 days), `pipelineId`, `ownerId`, `teamId` (records whose owning team is that team: `owning_team_id` on contacts, deals and tasks, the owner's primary team for invoices and payments, so a person on two teams counts once; BL-382), `convertTo` (ISO currency).

The period is cut at local midnights in the viewer's zone (`user_profiles.timezone`, else the workspace's, else UTC); the previous window has the same number of calendar days and ends the day before.

Response sections, each `null` when the caller lacks the capability (not zero):

| Section    | Needs                                               | Content                                                                                                                                  |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `deals`    | `record.deals.read`                                 | open (count, value, forecast), won/lost vs previous, win rate, average size and cycle, late expected close, funnel, trend, leaderboard |
| `contacts` | `record.contacts.read`                              | total, new contacts, new leads (contacts that came with a source), lead sources (to deal, to won, won value)                             |
| `tasks`    | `record.tasks.read`                                 | open, overdue, due later today, by assignee, next six                                                                                    |
| `invoices` | `record.payments.read` and plan feature `invoicing` | outstanding, overdue, collected (and previous), paid invoices, aging, last payments                                                      |
| `activity` | always                                              | newest deal timeline rows (and contact activities with contacts read)                                                                    |

Each section uses the record scope of its own table (`own`/`team`/`all`): deals and contacts by owner, tasks by assignee or creator, invoices and payments by invoice owner/creator. Money is exact per currency; with `convertTo` a converted total is added when every rate is known, else the currencies without a rate are named in `unconverted`.

Funnel: deals created in the period in one pipeline (the chosen one, else the default); a stage is reached when the deal's timeline has a move into it, or the deal sits in it or in a later non-lost stage. Conversion is reached / reached of the previous stage.

Errors: 404 unknown pipeline/owner/team, 422 bad range or a period over 366 days, 403 without deals read, 401 unauthenticated.

No cache: the main dashboard does not cache either. Every figure is one grouped query (EXPLAIN on 100k deals, 150k timeline rows, 40k contacts, 30k tasks: 1 to 52 ms per query, the funnel the slowest). Migrations `20261129090000` and `20261129090100` add the time-ordered indexes the activity feed needs (23 ms to 0.4 ms).
