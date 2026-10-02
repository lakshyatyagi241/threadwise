# API: dashboards-analytics-charts

Domain `dash` (TW-DASH). Base path `/v2`, staff bearer token. The domain owns no table: every number is a live aggregate over the
workspace's messages (`messages` and `inbox_messages` summed). Errors are `application/problem+json`. Shapes live in
`packages/contracts/src/dashboards-analytics-charts/`.

Definitions (TW-DASH-002): **sent** = every outbound row; **delivered** = outbound with status `delivered`, `read` or `sent`;
**failed** = status `failed`; **read** = outbound with `read_at` or status `read`; **queued** = max(0, sent - delivered - failed);
**replies** = inbound rows; **engaged** = distinct conversations with an inbound inbox message. Rates are percents with one decimal,
0 when the denominator is 0. Percent change is +100 when the previous value was 0 and the current is not. Windows are cut in the
workspace's time zone (`organizations.settings.timezone`, UTC when unset); the previous window has exactly as many days as the
current one.

## GET /v2/dashboard/summary?range=24h|7d|30d|qtd (`dash.dashboard.read`)

An unknown or missing `range` is `7d`. `7d` and `30d` run from the start of that day to the end of today (8 and 31 days).

```json
{
  "range": "7d",
  "window": {
    "from": "2026-10-07T00:00:00.000Z",
    "to": "2026-10-15T00:00:00.000Z",
    "prevFrom": "2026-09-29T00:00:00.000Z",
    "prevTo": "2026-10-07T00:00:00.000Z",
    "timezone": "UTC"
  },
  "current": {
    "sent": 15,
    "delivered": 11,
    "failed": 2,
    "read": 4,
    "queued": 2,
    "replies": 5,
    "repliers": 2,
    "deliverability": 73.3,
    "readRate": 26.7,
    "replyRate": 33.3
  },
  "previous": {
    "sent": 0,
    "delivered": 0,
    "failed": 0,
    "read": 0,
    "queued": 0,
    "replies": 0,
    "repliers": 0,
    "deliverability": 0,
    "readRate": 0,
    "replyRate": 0
  },
  "sentDeltaPct": 100,
  "readRateDeltaPp": 26.7,
  "sparkline": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3],
  "funnel": {
    "stages": [
      { "key": "sent", "count": 15, "pct": 100, "drop": 0 },
      { "key": "delivered", "count": 11, "pct": 73.3, "drop": 4 },
      { "key": "replied", "count": 5, "pct": 33.3, "drop": 6 },
      { "key": "engaged", "count": 2, "pct": 13.3, "drop": 3 }
    ],
    "endToEnd": 13.3
  }
}
```

`sparkline` is 20 hourly outbound counts, oldest first.

## GET /v2/dashboard/throughput?range=... (`dash.dashboard.read`)

Parallel arrays per bucket: `starts` (ISO instants), `sent`, `delivered`, `failed`. `24h` gives 24 hourly buckets ending with the
current zone hour; the other ranges one bucket per zone day. `peak` is the busiest of the 24 hours before now (null when none),
`avgPerHour` is the 24-hour outbound total divided by 24.

## GET /v2/analytics/overview?range=7d|30d|90d|custom&from=&to= (`dash.analytics.read`, plan feature `analytics`)

Default and fallback range is `30d`. `custom` takes inclusive `YYYY-MM-DD` dates; a missing From is 30 days ago, a missing To is
today, an inverted pair is swapped, bad dates are dropped, and a span over 366 days is `422`. A plan without the feature is
`422 PLAN_FEATURE_LOCKED` (`upgradeUrl` in the details).

Returns `window` (with `days`, `fromDate`, `toDate`), `current`, `previous`, `trends` (percent per metric; percentage points for
`replyRatePp` and `endToEndPp`), `daily` (`dates`, `sent`, `delivered`, `failed`, `queued`, one value per day, zeros included),
`funnel`, `types` (`text`, `template`, `media`, `interactive`, `location`; template wins over media; zero buckets omitted) and
`heatmap` (7 rows, Sunday first, of 24 hourly counts, both directions, in the workspace zone).

## GET /v2/analytics/export (same query, same gates)

`text/csv` attachment: `Metric,Value` rows for the window's totals and rates, a blank line, then `Date,Sent,Delivered,Failed,Queued`
per day. A cell starting with `=`, `+`, `-` or `@` (other than a plain number) is prefixed with an apostrophe.

## Capabilities

| Key                   | Scope | Grants                        |
| --------------------- | ----- | ----------------------------- |
| `dash.dashboard.read` | no    | summary and throughput        |
| `dash.analytics.read` | no    | analytics overview and export |

The Admin preset holds both; nobody else by default.

## Operator system health (TW-DASH-048, 049, 050, 051)

Console endpoints under `/v2/platform/health`, behind the operator guard. They read platform plumbing only, never a tenant table.

### GET /v2/platform/health[?fresh=1]

Every operator role. Returns `{ overall, checks, queues, vitals, ts }`. `checks` are five probes in a fixed order (`database`,
`cache`, `queue`, `bridge`, `storage`), each `{ key, state: up|warn|down|idle, value, detail, ping }`. `overall` is `down` if any probe
is down, else `warn` if any is, else `up` (idle does not count).

- database: `SELECT 1`.
- cache: writes and reads back `health:probe`.
- queue: sums waiting, paused, delayed and prioritized jobs (pending) and failed jobs over every BullMQ queue; `warn` for any failed
  job or more than 500 pending.
- bridge: calls `NODE_BRIDGE_URL` with `X-Node-Token` (`NODE_BRIDGE_TOKEN`); any HTTP answer is `up`, a refused connection `down`,
  an unset URL `warn`.
- storage: `idle` without `S3_ENDPOINT`, otherwise checks that the endpoint answers.

`queues` lists pending and failed per queue. `vitals` holds Node and app version, environment, uptime, memory and disk free/used.
One probe run is shared for 3 seconds (`?fresh=1` skips the share).

### POST /v2/platform/health/clear-queue

Super admin only. Body `{ queue? }` (a queue name; omit for all). Drains waiting and delayed jobs and deletes failed jobs; running
jobs are untouched. Returns `{ ok, clearedPending, clearedFailed, message }` and writes a `platform.health.queues_cleared` security
event. An unknown name is `422`.
