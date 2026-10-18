| Target rps | Achieved rps | Sustained | Why not                                                                                                           |
| ---------- | ------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
| 10         | 10.4         | no        | class A p95 1043 ms over 50; class B p95 497 ms over 150                                                          |
| 20         | 20.5         | no        | class A p95 1290 ms over 50; class B p95 669 ms over 150; class C p95 799 ms over 300                             |
| 40         | 31.2         | no        | errors 16.01% over 1%; class A p95 18940 ms over 50; class B p95 19586 ms over 150; class C p95 20322 ms over 300 |
| 80         | 39.2         | no        | errors 52.13% over 1%; class A p95 20454 ms over 50; class B p95 20426 ms over 150; class C p95 21468 ms over 300 |

Sustained: 0 requests/second (first step that fails: 10)
