# Parity evidence: dashboards-analytics-charts (DASH)

Reference 1.7.0 vs this port. API reference: [docs/api/dashboards-analytics-charts.md](../../api/dashboards-analytics-charts.md); plan:
[port-map](../port-map/dashboards-analytics-charts.md).

Evidence is automated: `apps/api/test/e2e/dashboards-analytics-charts/{dash,health}.e2e.spec.ts` (HTTP, real Postgres, Redis and
BullMQ), `apps/api/test/unit/dashboards-analytics-charts/*`, and the web unit tests under
`apps/web/src/features/dashboards-analytics-charts/`. The running reference was not opened for a screen pass in this run, so layout
parity rests on the inventory only (see Not verified).

## Built

TW-DASH-002..005, 012, 018, 022..025, 027, 031, 032 (workspace dashboard and analytics), 048 (system health core), 049 (response-time
bars), 050 (host vitals only), 051 (clear jobs).

## Deliberate deviations (intended)

| Id          | Reference                                                       | Port                                                                                                        | Reason                                                                        |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| TW-DASH-048 | the polled repaint leaves the overall banner stale           | the banner is repainted with the cards                                                                      | the inventory port note calls the stale banner a defect                       |
| TW-DASH-048 | probes `jobs`/`failed_jobs` tables, cache driver, media disk | Postgres, Redis, BullMQ, `NODE_BRIDGE_URL`, `S3_ENDPOINT`                                                   | different engine; same five cards in the same order                           |
| TW-DASH-048 | media storage writes, reads back and deletes a probe file    | reachability of the S3 endpoint only; `idle` when none is configured                                        | no storage adapter or S3 client exists yet; upgrade with the media domain     |
| TW-DASH-048 | no result cache                                              | one probe run shared for 3 seconds                                                                          | protects against poll storms (inventory port note)                            |
| TW-DASH-050 | PHP and Laravel versions                                     | Node and app version, uptime, memory                                                                        | the runtime differs                                                           |
| TW-DASH-051 | deletes every row of `jobs` and `failed_jobs`, no audit      | drains waiting and delayed jobs, removes failed ones, never touches running jobs, audited, super admin only | the inventory marks the blanket delete as dangerous and asks for these guards |

## Blocked (recorded, not dropped)

| Id                                                            | Blocked on                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TW-DASH-034..044                                              | admin overview and admin analytics: platform-wide aggregates over orders, workspaces and sign-ups need a sanctioned cross-tenant read door (PlatformStore does not touch tenant tables; no new `.privileged(` call is allowed) |
| TW-DASH-045..047                                              | admin financial dashboard: the same door, plus the orders and refunds tables no domain writes yet (PAYGW, checkout)                                                                                                            |
| TW-DASH-049 (counters, 14-day line)                           | platform-wide counts of messages, AI calls, conversations and webhooks need the same door                                                                                                                                      |
| TW-DASH-050 (engine cards)                                    | devices and provider configs are tenant tables; same door, plus TW-WADEV and TW-WABA                                                                                                                                           |
| TW-DASH-001, 006..011, 013..017, 019, 020, 026, 029, 030, 033 | other domains (CHAT, CON, WALLET, BCAST, WADEV, TPL, TIB1/2, FLR, NOTIF, SCHED) and the shell's landing and quick-access preferences; see the port map                                                                         |
| TW-DASH-052..054                                              | 052 is delivered as hand-drawn SVG (no chart dependency may be added); 053 is applied on the built screens; 054 is dead code and is not ported                                                                                 |

## Not verified

- Screen layout against the running reference (not opened).
- A browser smoke spec for the console health page.
- The bridge probe against a real Node bridge (tested against a local HTTP server and the harness stub).
