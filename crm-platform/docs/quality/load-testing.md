# Load testing (500 concurrent users baseline)

Script: `perf/load.js` (k6). Judge: `tools/perf/load-report.mjs`. Budgets: `perf/budgets.json` (`load`).

## Run

```bash
psql "$DATABASE_URL" -v users=800 -f tools/perf/seed-users.sql   # loaduser<N>@perf.example.test
k6 run -e USERS=100,250,500,750 -e HOLD=180 -e OUT=perf/results/load-full.json perf/load.js
node tools/perf/load-report.mjs perf/results/load-full.json       # exits 1 if 500 users is not inside the budgets
```

Each virtual user is a distinct logged-in user: one user holds about 5 sessions, so sharing one login invalidates the rest.

## Result (one 4-core machine shared by k6, API, Postgres, Redis; one API process; DB pool 20)

| Users | Req/s | Errors | All p95 (ms) |
| ----- | ----- | ------ | ------------ |
| 50    | 7.5   | 0.00%  | 375          |
| 100   | 14.1  | 0.04%  | 1557         |
| 200   | 16.0  | 0.17%  | 12027        |
| 350   | 16.6  | 0.83%  | 27174        |
| 500   | 20.2  | 20.91% | 33210        |
| 750   | 23.4  | 31.96% | 44332        |

The 500-user baseline is not met. The highest usable stage is 100 users. The inbox counts aggregate is 68% of DB time; the errors are 503s from the exhausted pool. See `Load_Testing_QA_Report.html`.
