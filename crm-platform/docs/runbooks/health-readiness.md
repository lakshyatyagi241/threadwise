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

## PostgresDown

`crm_postgres_up` is 0: the API's `SELECT 1` (2 s deadline, every 10 s) failed for 2 minutes. `/ready` is 503 on that instance. **Check:** `docker compose ps postgres`, `docker compose logs --tail=100 postgres`, disk space on the data volume. **Fix:** restart the container only if it is stopped or hung; never delete the volume. See `docs/runbooks/p0-failure-modes.md#dbpoolexhausted` and `docs/runbooks/backup-restore.md`.

## BackupStale

The marker `/backups/.last-ok` is older than 26 hours (`crm_probe_file_age_seconds{file="backup"}`). **Check:** `docker compose logs --tail=200 backup`, free disk, `docker inspect backup --format '{{.State.Health.Status}}'`. **Fix:** run a dump by hand per `docs/runbooks/backup-restore.md`, then fix the cause. **Escalate:** platform owner if two dump cycles fail.

## BackupMarkerMissing

No marker visible to the probe for 30 minutes: either no dump ever succeeded, or the probe lost its read-only mount of `./backups`. **Check:** `ls -la backups/` on the host; `docker inspect probe` mounts.

## OffsiteBackupStale

No whole offsite pass in 3 hours. The marker lives in the `offsite_state` volume. Silent when offsite is not configured. **Check:** `docker compose logs --tail=100 offsite`, bucket credentials in `.env`, `ObjectStoreUnreachable`.

## ObjectStoreUnreachable

The `s3` probe target (set `PROBE_S3_URL` in `.env` to the `S3_ENDPOINT`) got no HTTP answer for 10 minutes. Uploads and offsite backup fail; the app still serves. **Check:** provider status page, DNS and egress from the host.

## Watchdog

Always firing on purpose. Alertmanager sends it hourly to the default receiver in `alertmanager.yml` (webhook). Point that URL, or add a receiver, at a heartbeat service that alerts when the heartbeat STOPS; that is what notices a dead Prometheus or Alertmanager. In `alertmanager.slack.yml` and `alertmanager.pagerduty.yml` the Watchdog route is dropped (it would otherwise page every hour), so those variants have no dead-man's-switch until a heartbeat receiver is added.

## Still open

Traefik is outside this repository. The routing of Watchdog to an external heartbeat service is a deployment step (no such service is configured here).
