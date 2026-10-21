# Runbook: health and readiness

Coverage matrix: `docs/performance/health/coverage-matrix.json` (checked by `node tools/health-readiness/check.mjs`). Owner of every row: platform
(on-call pager, then Vedant). Rule of thumb: **liveness never depends on a dependency** (a database blip must not restart healthy processes);
**readiness reports dependencies** and pulls an instance from rotation with 503 without restarting it.

## API

`GET /health` always 200 while the process runs. `GET /ready` returns 503 when the primary database or Redis does not answer within 2 s; the body
holds fixed words only (`up`, `down`, `timeout`, `unreachable`), never a host or DSN. A failing replica, worker or outbox is reported but does not make
the API unready. **Alert:** ApiProbeFailing (probe target `ready`), 3 minutes. **First look:** `curl -s localhost:3000/ready` from inside the container
(`docker exec desk-api-blue ...`): the check that says `down` is the dependency to fix (see Postgres, Redis).

## Web

`GET /api/health` is liveness (no API call). `GET /api/ready` is 200 only if the API's `/health` answers within 2 s, else 503 `{"api":"down"}`. The
compose healthcheck still uses `/login` (a real render). **Alert:** ApiProbeFailing with target `webready` (and `web`). **First look:** is the API slot named
in the web container's `API_URL` running? (`docker ps`, the slot's `/health`).

## Worker

No HTTP port: the compose healthcheck runs `worker-probe.js`, which asks Redis whether this container's worker has beaten in the last three beats.
**Alert:** RuntimeMetricsTargetDown (job `crm-worker`). **First look:** Redis reachable, worker logs, `docker inspect worker --format '{{.State.Health.Status}}'`.

## Postgres

`pg_isready` healthcheck; the API `/ready` shows `primary: down`. **Alert:** ApiProbeFailing (no direct database gauge exists). **Fix:** see
`docs/runbooks/p0-failure-modes.md#dbpoolexhausted` and `docs/runbooks/backup-restore.md`.

## Redis

See `docs/runbooks/p0-failure-modes.md#redisdown`.

## Not covered by an alert (open)

Backup and offsite containers go unhealthy but no metric pages anyone. Prometheus and Alertmanager are not watched by a dead-man's-switch. The external
object store (R2) has no probe. Traefik is outside this repository.
