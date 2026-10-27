# Top queries by total time (Sheet 3 D-02)

Target from the sheet: rank the normalized queries by total time and fix the top 20; each cut by 50 % or justified in writing.

All numbers are from one machine with the sheet's perf data set (1 organisation, 100,000 contacts, 1,000,000 messages, 50,000 conversations), one user, 7 timed
calls per route (`tools/api-inventory/measure.mjs`, 472 timed GET routes). They show shape and ranking, not production latency, and a single run varies by
about 30 %. **Production `pg_stat_statements` was not read** (no access): re-run the ranking there with the query at the end before acting on any row.

## What was found

1. **Ten message-count statements are 77 % of all database time** (ranks 1 to 8, 11 and 13 below). They are scans of one to thirty days of `messages`. The rollup
   built for them (`ANALYTICS_SOURCES`, metrics `msg_feed` and `msg_feed_overview`) is switched off by default, so production still runs the scans.
2. **Switching the rollup on is a large win on the History screen and a regression on the admin hub, unless JIT is off too.** See the route table.
3. **JIT compilation is the reason.** A rollup read does about 2 ms of work, but the planner over-estimates the live-tail branches (333,937 rows estimated,
   817 actual), the plan cost passes `jit_above_cost` (100,000), and Postgres compiles 198 functions for about 140 ms on every call. No `jit` setting exists in any
   compose file, so production runs the default (on).
4. **One cheap fix was made:** the team report looked the workspace's zone up in `pg_timezone_names` on every request (55 ms, a view that reads the zone files).
   It is now cached for 60 s per workspace, the same reasoning as `orgTimezone`: 8 requests cost one lookup instead of eight.

## Routes, p95 in ms

| Route                          | Rollup off | Rollup off, JIT off | Rollup on | Rollup on, JIT off |
| ------------------------------ | ---------- | ------------------- | --------- | ------------------ |
| `/v2/message-history/summary`  | 2,123      | 893                 | 336       | **66**             |
| `/v2/message-history/insights` | 595        | 501                 | 672       | 462                |
| `/v2/shell/overview-stats`     | 298        | 411                 | **1,056** | 201                |
| `/v2/shell/workspace/export`   | 723        | 1,214               | 856       | 709                |
| `/v2/dashboard/summary`        | 293        | 344                 | 281       | 305                |
| `/v2/contacts/duplicates`      | 303        | 338                 | 418       | 365                |

Routes over 120 ms: 15, 12, 13, 12 in the four columns. Reading it:

- **Rollup on with JIT on makes the admin hub 3.5 times slower** (298 to 1,056 ms): it does six rollup reads and pays the compile each time. With JIT off it is the
  fastest of the four (201 ms). So the two settings go together; neither alone is safe.
- **JIT off alone is mixed on the scans.** The History summary improves (2,123 to 893), but the hub (298 to 411) and the export card (723 to 1,214) look worse.
  Some of that is noise, some is JIT helping the heavy aggregates. Do not change `jit` on production without a before/after on staging.
- With the rollup on and JIT off, the History summary falls from 2.1 s to 66 ms (97 %) and the hub from 298 to 201 ms (33 %). Insights and the dashboard summary do
  not move: they are per-conversation aggregates the org-level rollup cannot answer (see the spec, decisions D11 and D12).

## The top 20

Share is of all database time in the rollup-off sweep (41.9 s over 37,359 calls). Means are in ms.

| #   | Share  | Calls | Mean, rollup off | Mean, rollup on + JIT off | What                                                                            | Disposition                                                                                                                                                                                                                                                                      |
| --- | ------ | ----- | ---------------- | ------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 26.8 % | 8     | 1,406            | gone                      | History summary: per-conversation first reply                                   | **Cut by the rollup** (route 2,123 to 66 ms). Needs the backfill and the switch.                                                                                                                                                                                                 |
| 2   | 12.9 % | 8     | 674              | 671                       | Export card counts (`workspace-export.service`)                                 | **Justified, tried and reverted.** A set-based rewrite gave 674 to 616 ms through the app: row-level security on 1M rows is the floor. The rollup cannot serve it: it leaves out system lines and mirrored bubbles that the CSV holds, so the card would disagree with the file. |
| 3   | 10.0 % | 8     | 524              | gone                      | History charts (volume, type mix, top conversations in one pass)                | **Cut by the rollup** for volume and type mix. The top-conversations list stays a scan (302 ms) because it groups by conversation.                                                                                                                                               |
| 4   | 7.8 %  | 16    | 204              | gone                      | History summary cards (counts by status)                                        | **Cut by the rollup.**                                                                                                                                                                                                                                                           |
| 5   | 5.0 %  | 24    | 88               | 73                        | Outbound messages in one window (billing usage, platform overview)              | **Justified.** Under 120 ms; an exact count of one month of a 1M-message workspace is a 190 ms scan at best. The billing meter must be exact.                                                                                                                                    |
| 6   | 4.5 %  | 8     | 238              | 229                       | Dashboard summary, one pass per conversation                                    | **Justified.** Already reduced to a single statement (P-15). Per-conversation aggregates are the case the rollup does not cover.                                                                                                                                                 |
| 7   | 4.5 %  | 24    | 78               | 76                        | Platform overview: messages in a window across workspaces                       | **Justified.** Under 120 ms, operator-only page.                                                                                                                                                                                                                                 |
| 8   | 3.0 %  | 8     | 155              | gone                      | Admin hub: delivered share, 7-day and month counts                              | **Cut by the rollup** (route 298 to 201 ms **only with JIT off**).                                                                                                                                                                                                               |
| 9   | 1.6 %  | 168   | 4                | 5                         | Contacts keyset page (duplicates screen reads all contacts, 21 pages a request) | **Justified.** 4 ms a call; the cost is 21 round trips in the duplicates route (303 ms p95), an application loop, not a slow statement.                                                                                                                                          |
| 10  | 1.4 %  | 8     | 74               | 63                        | Messages per day bucket                                                         | **Justified.** Under 120 ms.                                                                                                                                                                                                                                                     |
| 11  | 1.3 %  | 8     | 67               | gone                      | All-time message count of a workspace                                           | **Cut by the rollup.**                                                                                                                                                                                                                                                           |
| 12  | 1.1 %  | 8     | 59               | 64                        | Platform overview: recent workspaces with plan and owner                        | **Justified.** Under 60 ms.                                                                                                                                                                                                                                                      |
| 13  | 1.1 %  | 8     | 59               | 61                        | Platform workspaces: messages per workspace                                     | **Justified.** Under 60 ms.                                                                                                                                                                                                                                                      |
| 14  | 1.1 %  | 8     | 57               | 64                        | Contact export rows (groups aggregated per contact)                             | **Justified.** Under 60 ms, owner-only export.                                                                                                                                                                                                                                   |
| 15  | 1.1 %  | 8     | 56               | gone                      | Team report: workspace zone from `pg_timezone_names`                            | **Fixed here.** Cached per workspace for 60 s: 8 requests, 1 lookup (119 ms cold), 7 reads of 0 ms.                                                                                                                                                                              |
| 16  | 1.0 %  | 8     | 52               | 50                        | Distinct custom-field keys over contacts                                        | **Justified.** Under 60 ms; a settings screen.                                                                                                                                                                                                                                   |
| 17  | 1.0 %  | 8     | 52               | 45                        | Dashboard widgets: recent conversations                                         | **Justified.** Under 60 ms.                                                                                                                                                                                                                                                      |
| 18  | 0.9 %  | 8     | 50               | 53                        | Messages in a window for one workspace                                          | **Justified.** Under 60 ms.                                                                                                                                                                                                                                                      |
| 19  | 0.9 %  | 16    | 24               | 23                        | Message age buckets (hours since)                                               | **Justified.** 24 ms.                                                                                                                                                                                                                                                            |
| 20  | 0.8 %  | 8     | 42               | 36                        | Distinct lifecycle stages of contacts                                           | **Justified.** 42 ms, a filter dropdown.                                                                                                                                                                                                                                         |

After the rollup and JIT off, exactly three statements are still over 120 ms mean: the export card (671), the History top-conversations list (302) and the dashboard
summary (229). Ranks 5 and 7 to 20 are all under 120 ms.

## D-01: the four statements over 120 ms from the 19 October run

Re-checked against the fresh sweep (same data set). The first two match by text; the last two changed their parameter numbering and match by shape (ranks 4 and 8 above).

| 19 Oct statement                              | Mean then | Now, rollup off | Now, rollup on + JIT off |
| --------------------------------------------- | --------- | --------------- | ------------------------ |
| History summary, per-conversation first reply | 534       | 1,406           | gone                     |
| History charts, grouping sets                 | 397       | 524             | gone                     |
| History summary counts by status              | 162       | 204             | gone                     |
| Admin hub delivered share and counts          | 150       | 155             | gone                     |

So all four are still over 120 ms while the rollup is off (the two runs are on different machines, so compare the shape, not the digits), and all four
disappear once it is on. What replaces them is under 120 ms except the History top-conversations list (302 ms), which groups by conversation.
Statements over 120 ms mean in the sweeps: 6 (rollup off), 5 (rollup on, JIT on), 3 (rollup on, JIT off: the export card counts at 671, the top-conversations list at 302,
the dashboard summary at 229). That is the local answer. The sheet's target is about production, which was not read: production's `pg_stat_statements` is the
query at the end of this page, and the weekly database digest (D-06) and the 5-minute alert (D-04) flag any statement over 120 ms from then on.

## Decisions and steps for a person

1. **Rollup**: run `pnpm --filter @crm/api backfill:message-feed` per workspace, set `ANALYTICS_SOURCES='{"msg_feed":"shadow","msg_feed_overview":"shadow"}'` first (the old
   query is served and the new one compared), then `rollup`. **Do this together with the JIT decision, not before it**, or the admin hub gets slower.
2. **JIT**: on staging with the rollup on, compare `jit=off` against the default (or `jit_above_cost` raised to 500,000, which keeps JIT for genuinely heavy plans)
   using this ranking. The evidence above is one machine; the production change is a Postgres setting in the compose `command` and needs a container recreate.
3. **Export card**: decide whether the card may show the rollup total (fast, but it would not equal the CSV's row count), or stays an exact count.
4. The same `pg_timezone_names` lookup remains in four nightly sweeps (`owner-restore`, `invoice-overdue`, `recurring-invoices`, `leave-sweep`) and the rollup worker.
   They run once a night or per workspace, not per request, so they were left alone.

## Rerun

```bash
# the stack: README in docs/quality/api-inventory (scratch Postgres with pg_stat_statements, migrate, build, start the API in production mode)
# what that README does not say, learned the hard way:
#   production mode refuses the placeholder secrets of .env.example (JWT_*, CREDENTIALS_ENCRYPTION_KEY) and CHANNEL_SIMULATOR_ENABLED
#   sign-up wants a WhatsApp code: use /v2/auth/signup/start -> /signup/verify-email-code (code in Mailpit) -> /signup/set-password, after
#     insert into platform_settings (key, value, is_secret) values ('registration', '{"requirePhoneVerification": false}', false);
#   the sweep looks for the slug perf-org: pass PERF_ORG=<your slug>
PERF_ORG=<slug> OPERATOR_EMAIL=... PSQL=... node tools/api-inventory/measure.mjs --out /tmp/before
node tools/api-inventory/compare-sweeps.mjs /tmp/before /tmp/after --top 20     # ranking, and what happened to each statement
node --test tools/api-inventory/compare-sweeps.test.mjs
```

On production, read-only (needs `pg_read_all_stats`):

```sql
select round(total_exec_time) as total_ms, calls, round(mean_exec_time::numeric, 1) as mean_ms, left(query, 120)
from pg_stat_statements where query not ilike '%pg_stat_statements%' order by total_exec_time desc limit 20;
```
