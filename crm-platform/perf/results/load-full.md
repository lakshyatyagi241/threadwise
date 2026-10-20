# Load test: full mix, 3 to 8 s between actions

Stages of concurrent active users, each ramped 60 s and held 120 s. Times in ms.

| Users | Req/s | Errors | A p95 | B p95 | C p95 | All p50 | All p95 | All p99 | Inside the budgets | Usable |
| ----- | ----- | ------ | ----- | ----- | ----- | ------- | ------- | ------- | ------------------ | ------ |
| 50    | 7.5   | 0.00%  | 355   | 370   | 491   | 188     | 375     | 486     | no                 | yes    |
| 100   | 14.1  | 0.04%  | 1323  | 1237  | 3052  | 329     | 1557    | 2900    | no                 | yes    |
| 200   | 16.0  | 0.17%  | 10771 | 9698  | 14122 | 5376    | 12027   | 13943   | no                 | no     |
| 350   | 16.6  | 0.83%  | 25740 | 23306 | 30124 | 13745   | 27174   | 30108   | no                 | no     |
| 500   | 20.2  | 20.91% | 31779 | 28585 | 40991 | 17823   | 33210   | 40134   | no                 | no     |
| 750   | 23.4  | 31.96% | 42882 | 39332 | 52463 | 24909   | 44332   | 53538   | no                 | no     |

## Server side (peak readings while each stage was held)

| Users | Machine CPU % | API CPU % (100 = one core) | API memory MB | DB connections | Queue depth |
| ----- | ------------- | -------------------------- | ------------- | -------------- | ----------- |
| 50    | 65            | 68                         | 1139          | n/a            | 0           |
| 100   | 96            | 95                         | 1135          | n/a            | 0           |
| 200   | 99            | 106                        | 1138          | n/a            | 0           |
| 350   | 99            | 133                        | 1179          | n/a            | 0           |
| 500   | 99            | 131                        | 1230          | n/a            | 0           |
| 750   | 99            | 115                        | 1286          | n/a            | 0           |

Highest stage inside the budgets: **none** users. Highest stage that stays usable: **100** users.
The 500-user baseline is NOT inside the budgets (errors 20.91%; over p95 budget: A 31779 ms, B 28585 ms, C 40991 ms) and NOT usable.
