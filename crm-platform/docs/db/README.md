# Database documentation

## The diagram

The full platform ERD is maintained as DBML for
[dbdiagram.io](https://dbdiagram.io). **Save your DBML source here:**

```
docs/db/crm_platform_v3.dbml
```

It is not reproduced in this repo automatically — paste the file you maintain in
dbdiagram into that path so the diagram and the code live together. Prettier is
configured to leave `.dbml` alone.

To view: dbdiagram.io → New Diagram → paste. Use _Detail Level → Table name
only_ for the big picture, full detail when drilling into one domain.

## Diagram vs implementation

The diagram is the design target. Migrations in `packages/db/migrations` are
what actually exists. Today that is the foundation plus the contacts slice —
see [`packages/db/README.md`](../../packages/db/README.md) for the exact list.

### Where the implementation differs from the diagram

These came out of the requirements discussion after the diagram was drawn:

| Addition                         | Why                                                             |
| -------------------------------- | --------------------------------------------------------------- |
| `partner_agents`                 | sub-agents are a third identity pool, not a role                |
| `partner_agent_leads`            | agent → contact mapping; the only thing the partner side stores |
| `contacts.submitted_by_agent_id` | "Submitted by" on staff lists without a join                    |
| `api_keys`                       | missing from the diagram; required for any external caller      |
| `contacts.lifecycle_stage`       | the funnel field the partner portal reads live                  |
| `contacts.legacy_id`             | reconciliation key for the Geta migration                       |
| `organizations.roles_version`    | RBAC cache invalidation for a whole org at once                 |
| `event_outbox.available_at`      | retry backoff without a separate scheduler                      |

If you update the diagram, update this table too.

## Conventions the diagram encodes

- Every business table carries `org_id` — RLS predicate and future partition key
- Composite primary key `(org_id, id)`
- Internal `bigint` id, external `uuid`; only the uuid leaves the system
- Composite foreign keys `(org_id, x) → (org_id, id)` make cross-tenant
  references structurally impossible
- Solid line = real Postgres FK. Dotted = app-enforced (streams have no FKs;
  polymorphic references span many tables). Green = money flow.

## Reading order for a newcomer

1. [Architecture overview](../architecture/overview.md)
2. [Multi-tenancy](../architecture/multi-tenancy.md) — why every table looks
   the way it does
3. [Kernel](../architecture/kernel.md) — the three storage tiers
4. The migrations themselves, in order. They are commented with _why_, not
   _what_.
