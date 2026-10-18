# Resource limits

What each container may consume, and a check that keeps the deploy files inside it. Standard: WaDesk Resource Limits (RES-001 to RES-100). The audit that produced this, with its findings (RL-01 to RL-13) and the NOT_RUN list, is in the project files under `resource-limits/`.

| File                                             | What                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource-policy-registry.json`                  | thresholds, host sizes (empty until recorded), per-service policy, `acceptedGaps` (known failures, each with a finding id and an expiry)                                                                                                                                            |
| `tools/resource-limits/check.mjs`                | reads `deploy/hostinger/docker-compose.yml`, `docker-compose.prod.yml` and the `@Processor` options; 24 checks (memory, CPU, PID, log caps, V8 heap vs container, DB connections vs `max_connections`, Redis `maxmemory` and policy, worker stop grace, worker concurrency vs pool) |
| `tools/resource-limits/redis-pressure.sh`        | real `redis-server` at `maxmemory` with `noeviction`: refused not dropped, nothing evicted                                                                                                                                                                                          |
| `deploy/observability/resource-limits.rules.yml` | container memory, OOM, restart-loop, PID alerts (tests beside it)                                                                                                                                                                                                                   |

```bash
pnpm audit:resource-limits      # CI runs this; fails on a new failure or a stale accepted gap
pnpm test:redis-pressure        # needs redis-server on PATH
node tools/resource-limits/check.mjs --json
```

The check is static: PASSED means the configuration is inside the policy, not that the service survives load. Anything that needs a running stack (OOM recovery, pool exhaustion, noisy neighbor, soak) is listed in the registry under `notRun` and is not claimed.

## Changing a limit

1. Change the compose file. 2. Run `pnpm audit:resource-limits`. 3. If a gap you fixed was in `acceptedGaps`, delete it (the check fails on a stale entry so the list only shrinks). 4. If you add a service, give it a memory limit, CPU limit, PID limit, log cap and a Node heap under 75% of the memory limit. Do not raise a limit without comparing `crm_container_memory_bytes` and the host's free memory.

`hosts.hostinger.memoryBytes` is empty because the shared host's size is not in the repo. Fill it in from `free -b` on the host and the host-budget check starts comparing for real.
