# CPU profile summary

**Status: NOT VERIFIED.** No CPU or heap profile of the real API or worker was taken. Profiling needs the application running against
Postgres and Redis with representative data, and that environment was not available in this work.

## What exists instead

| Evidence                                                              | What it shows                                                                                                                                                                  | What it does not show                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `evidence/zlib-hold.json` (`tools/event-loop-audit/measure-zlib.mjs`) | `gzipSync` holds the event loop about 14 ms per MB, `gunzipSync` about 3.3 ms per MB, on a synthetic export. 20 MB: 274 ms; 50 MB: 763 ms. The async forms hold it 5 to 30 ms. | Real export sizes, the real request mix, or the effect on API latency end to end |
| `evidence/bench-monitor.json` (`tools/event-loop-audit/bench.mjs`)    | The monitor sees a 300 ms synchronous block under load as a critical window, request max reaches 329 ms, and both recover afterwards                                           | Anything about the real endpoints                                                |

## How to take the first real profile

1. Run the API in a performance environment (isolated database and Redis, seeded to a realistic size, with `OBS_METRICS_PORT` set).
2. Drive the mix in `event-loop-observability-runbook.md` with a load tool (none is in the repo: choose one, e.g. k6, and add it deliberately).
3. While `crm_event_loop_delay_p99_seconds` is elevated: `node --cpu-prof --cpu-prof-interval 1000 dist/src/main.js`, load the `.cpuprofile` in Chrome DevTools, and look for self-time on one synchronous function.
4. Record the function, the route templates from the `event loop blocked` log lines, and the before/after in `event-loop-blocking-hotspots.json`.
