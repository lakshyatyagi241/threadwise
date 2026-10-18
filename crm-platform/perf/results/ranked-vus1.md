# Latency ranking

Median of 3 run(s). p95 in ms. Ratio is p95 over the class budget (above 1.00 is over budget).

## By class

| Class | p50   | p95   | p99    | p95 budget | p95  | p99 vs budget |
| ----- | ----- | ----- | ------ | ---------- | ---- | ------------- |
| A     | 15.7  | 917.6 | 1088.8 | 50         | OVER | over 120      |
| B     | 19.1  | 371.2 | 453.8  | 150        | OVER | over 400      |
| C     | 156.4 | 237.8 | 269.3  | 300        | pass | ok            |

## Top 20 endpoints by distance over budget

| #   | Route                          | Class | p50   | p95    | p99    | Budget | Ratio |
| --- | ------------------------------ | ----- | ----- | ------ | ------ | ------ | ----- |
| 1   | `GET /v2/inbox/counts`         | A     | 905.0 | 1052.9 | 1072.7 | 50     | 21.06 |
| 2   | `GET /v2/inbox/conversations`  | A     | 875.7 | 1046.9 | 1100.3 | 50     | 20.94 |
| 3   | `GET /v2/contacts?q`           | B     | 339.6 | 465.8  | 488.1  | 150    | 3.11  |
| 4   | `GET /v2/crm/dashboard`        | C     | 179.0 | 252.6  | 272.8  | 300    | 0.84  |
| 5   | `GET /v2/tasks`                | A     | 16.8  | 28.1   | 29.2   | 50     | 0.56  |
| 6   | `GET /v2/companies`            | A     | 16.0  | 26.4   | 31.6   | 50     | 0.53  |
| 7   | `GET /v2/inbox/analytics/team` | C     | 101.1 | 141.6  | 151.7  | 300    | 0.47  |
| 8   | `GET /v2/contacts`             | A     | 12.1  | 18.5   | 18.7   | 50     | 0.37  |
| 9   | `GET /v2/tags`                 | A     | 9.8   | 16.5   | 18.1   | 50     | 0.33  |
| 10  | `GET /v2/auth/session`         | A     | 11.0  | 15.6   | 17.9   | 50     | 0.31  |
| 11  | `POST /v2/contacts`            | B     | 26.8  | 36.2   | 44.4   | 150    | 0.24  |
| 12  | `POST /v2/companies`           | B     | 17.4  | 24.7   | 28.3   | 150    | 0.16  |
| 13  | `POST /v2/tasks`               | B     | 18.7  | 23.9   | 25.4   | 150    | 0.16  |
| 14  | `POST /v2/tags`                | B     | 15.8  | 21.6   | 24.7   | 150    | 0.14  |
