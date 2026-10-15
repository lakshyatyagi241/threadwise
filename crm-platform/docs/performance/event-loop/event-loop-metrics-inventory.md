# Event-loop metrics inventory

Every API and worker process exposes these from its own `GET /metrics` listener (`OBS_METRICS_PORT`, see the architecture note). Every series carries `service` (`api` | `worker`) and `instance` (`<hostname>:<pid>`). No tenant, user, contact or request id is ever a label.

Units are seconds and bytes (Prometheus convention); the engineering targets in the standard are in milliseconds, so 20 ms is `0.020`.

| Series                                                                    | Type                   | Extra labels                                                        | Meaning                                                                    | Standard #    |
| ------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- |
| `crm_event_loop_delay_p50_seconds`                                        | gauge                  |                                                                     | Loop scheduling delay p50, last window                                     | 1             |
| `crm_event_loop_delay_p95_seconds`                                        | gauge                  |                                                                     | p95, last window                                                           | 2             |
| `crm_event_loop_delay_p99_seconds`                                        | gauge                  |                                                                     | p99, last window                                                           | 3             |
| `crm_event_loop_delay_max_seconds`                                        | gauge                  |                                                                     | Worst delay in the last window                                             | 4             |
| `crm_event_loop_delay_mean_seconds`                                       | gauge                  |                                                                     | Mean delay                                                                 | 5             |
| `crm_event_loop_utilization_ratio`                                        | gauge                  |                                                                     | ELU as an interval delta (0..1), never averaged since start                | 6             |
| `crm_event_loop_blocked_windows_total`                                    | counter                | `level` = `warn` \| `critical`                                      | Windows whose loop DELAY crossed a target (utilization alone never counts) | 14, 18        |
| `crm_process_cpu_ratio`                                                   | gauge                  |                                                                     | Process CPU over the window, in cores                                      | 7             |
| `crm_process_heap_used_bytes` / `_heap_total_bytes` / `_heap_limit_bytes` | gauge                  |                                                                     | V8 heap and its limit                                                      | 8             |
| `crm_process_rss_bytes` / `crm_process_external_bytes`                    | gauge                  |                                                                     | Resident set and Buffer memory                                             | 9             |
| `crm_gc_pause_max_seconds` / `crm_gc_pause_window_seconds`                | gauge                  |                                                                     | Longest and total GC pause, last window                                    | 10            |
| `crm_gc_pause_seconds_total` / `crm_gc_events_total`                      | counter                | `kind` = `major` \| `minor` \| `incremental` \| `weakcb` \| `other` | Cumulative GC time and count                                               | 11            |
| `crm_process_active_resources`                                            | gauge                  |                                                                     | Active handles and requests                                                | 12            |
| `crm_http_request_duration_seconds`                                       | histogram              | `method`, `route` (template), `status` (`2xx`..)                    | API latency; `route` is the Express route template or `unmatched`          | 13            |
| `crm_queue_job_duration_seconds`                                          | histogram              | `queue`                                                             | Time a job ran                                                             | 15            |
| `crm_queue_job_wait_seconds`                                              | histogram              | `queue`                                                             | Time a job waited before starting                                          | 16            |
| `crm_queue_jobs_total`                                                    | counter                | `queue`, `outcome`                                                  | Finished jobs                                                              | 15            |
| `crm_container_cpu_throttled_periods_total` / `_seconds_total`            | gauge (kernel counter) |                                                                     | cgroup v2 `cpu.stat` throttling; absent off Linux/cgroup v2                | 19            |
| `crm_runtime_last_report_timestamp_seconds`                               | gauge                  |                                                                     | Unix time of the last completed window; stale means the monitor stopped    | ELM-009       |
| `crm_runtime_window_seconds`                                              | gauge                  |                                                                     | Length of the last window                                                  | ELM-007       |
| `crm_process_start_time_seconds`                                          | gauge                  |                                                                     | Process start; a changing value is a restart                               | 20 (restarts) |

## Not covered, on purpose or for now

- **Webhook acknowledgement latency (#17)**: derived from `crm_http_request_duration_seconds` for the webhook route templates; no separate series.
- **Per-process OOM count (#20)**: an orchestrator signal (container restarts, exit code 137), not something a dying process can report. Use `crm_process_start_time_seconds` changes plus the orchestrator.
- **Queue job metrics are not fed yet.** `RuntimeMonitor.observeJob(queue, waitMs, durationMs, outcome)` exists and is tested, but none of the BullMQ processors calls it. Until they do, the two queue histograms are empty and the worker alert `WorkerEventLoopBlockingWithQueueImpact` cannot fire. Tracked in the optimization backlog.
- **`apps/web` (Next.js server) is not instrumented.**

## Behaviour on bad data

- A window with no valid histogram sample publishes **nothing** for the loop series (they keep their previous value). Publishing zeros would claim a healthy loop that was too starved to be measured. The stale-timestamp alert covers a monitor that stops completing windows.
- Non-finite values are dropped by the registry. Histogram label sets are capped at 500 per series; past that they fold into an `overflow` set.
