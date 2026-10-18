# Latency ranking

Median of 3 run(s). p95 in ms. Ratio is p95 over the class budget (above 1.00 is over budget).

## By class

| Class | p50 | p95 | p99 | p95 budget | p95 | p99 vs budget |
|---|---|---|---|---|---|---|
| A | 337.2 | 4982.8 | 5448.3 | 50 | OVER | over 120 |
| B | 300.1 | 941.4 | 1194.5 | 150 | OVER | over 400 |
| C | 760.7 | 1178.3 | 1310.6 | 300 | OVER | over 800 |

## Top 20 endpoints by distance over budget

| # | Route | Class | p50 | p95 | p99 | Budget | Ratio |
|---|---|---|---|---|---|---|---|
| 1 | `GET /v2/inbox/conversations` | A | 4728.0 | 5696.4 | 5953.1 | 50 | 113.93 |
| 2 | `GET /v2/inbox/counts` | A | 4626.1 | 5358.9 | 5684.7 | 50 | 107.18 |
| 3 | `GET /v2/tasks` | A | 350.9 | 624.9 | 776.1 | 50 | 12.50 |
| 4 | `GET /v2/companies` | A | 376.1 | 617.0 | 735.8 | 50 | 12.34 |
| 5 | `GET /v2/auth/session` | A | 239.1 | 429.4 | 508.6 | 50 | 8.59 |
| 6 | `GET /v2/contacts?q` | B | 825.6 | 1224.1 | 1434.0 | 150 | 8.16 |
| 7 | `GET /v2/tags` | A | 195.3 | 392.3 | 509.5 | 50 | 7.85 |
| 8 | `GET /v2/contacts` | A | 202.3 | 353.0 | 444.5 | 50 | 7.06 |
| 9 | `POST /v2/contacts` | B | 404.0 | 682.3 | 974.8 | 150 | 4.55 |
| 10 | `GET /v2/crm/dashboard` | C | 986.7 | 1244.6 | 1355.4 | 300 | 4.15 |
| 11 | `POST /v2/companies` | B | 281.4 | 517.9 | 1097.6 | 150 | 3.45 |
| 12 | `POST /v2/tasks` | B | 252.6 | 456.4 | 698.7 | 150 | 3.04 |
| 13 | `POST /v2/tags` | B | 251.9 | 418.4 | 653.3 | 150 | 2.79 |
| 14 | `GET /v2/inbox/analytics/team` | C | 488.1 | 661.4 | 740.4 | 300 | 2.20 |
