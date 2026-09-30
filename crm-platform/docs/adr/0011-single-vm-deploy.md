# ADR-0011: Single VM with docker compose for v1

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Infrastructure cost was explicitly discussed and bounded: a ~$4,000/month
managed-cloud quote was rejected, with roughly $3,000 as the ceiling and bare
metal on the table.

Actual v1 load: tens of leads a day, a handful of staff users, growing toward
the message volumes the schema is designed for. The database is the component
that matters, and it benefits from tuning that managed services restrict.

## Decision

One VM (or dedicated server), docker compose, reverse proxy in front:

```
caddy ──> api      (HTTP + WebSocket)
          worker   (no inbound traffic)
          postgres (tuned: shared_buffers, work_mem, wal_level=replica)
          redis    (appendonly, noeviction)
```

`docker-compose.prod.yml` is the deployment description. Postgres is configured
with `wal_level=replica` from day one so a streaming replica can be attached
without downtime — which ADR-0013 requires.

## Consequences

### Positive

- Cheapest option by a wide margin, and within the stated budget.
- Full control of Postgres configuration — the parameters that matter for
  partitioned tables and JSONB workloads are exactly the ones managed tiers
  restrict.
- No network hop between app and database: single-digit-millisecond queries.
- One machine to reason about during an incident.

### Negative

- **Single point of failure.** A host failure is downtime. Accepted for v1;
  mitigated by automated off-host backups and a documented restore procedure.
- Backups, OS patching, monitoring and disk-space alerts are our job.
- Vertical scaling only, until the database moves off the box.
- No managed point-in-time recovery — it has to be set up (WAL archiving) and,
  more importantly, _tested_.

### Neutral

- The migration path stays open precisely because nothing depends on compose:
  the same image runs under ECS, k8s or a PaaS.

## Required before this is production-safe

- [ ] Automated `pg_dump` + WAL archiving to off-host storage (S3/B2)
- [ ] A **restore drill** — an untested backup is not a backup
- [ ] Uptime monitoring on `/ready`
- [ ] Disk-space alerting (partitions grow; a full disk stops writes)
- [ ] Log shipping off the box
- [ ] Documented rebuild procedure

## Alternatives considered

### Kubernetes

Rolling deploys, self-healing, horizontal scale. Also a control plane to run and
upgrade, and a skill set to maintain, for three containers.

### AWS ECS Fargate + RDS + ElastiCache

The rejected ~$4,000/month shape. Managed backups and failover are real value;
the price and the loss of Postgres tuning control were not acceptable here.

### PaaS (Railway / Render / Fly)

Fastest to deploy, least control over the database — which is the one component
this design has opinions about.

## Revisit when

- Uptime becomes contractual (an SLA with penalties), or
- one machine can no longer hold the load.

First move is to split Postgres onto its own host with a streaming replica,
keeping the app on compose. That change is already anticipated by
`DATABASE_REPLICA_URL`.
