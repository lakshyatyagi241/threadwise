# The platform kernel

The kernel is what makes five apps behave like one platform. It knows about
tenants, records, permissions and events — and nothing about contacts,
campaigns or exam applications.

Enforced in CI: `kernel/` may not import from `modules/`.

## What lives here today

| Service            | Responsibility                                       |
| ------------------ | ---------------------------------------------------- |
| `OutboxService`    | transactional event emission                         |
| `AuditService`     | append-only who-changed-what, with field-level diffs |
| `RbacService`      | grant resolution, merge, Redis caching               |
| `DisplayIdService` | batch-allocated human identifiers (CON-00001)        |

## What lives here next

| Component             | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| Metadata registry     | `modules`, `fields`, `relationships`, `status_options`   |
| Query AST compiler    | portable filter JSON → SQL, for saved views and segments |
| Generic records store | Tier-3 storage for user-defined modules                  |
| Rollup engine         | incremental child aggregates, driven by the outbox       |
| Index governance      | recommend → approve → `CREATE INDEX CONCURRENTLY`        |

## The three storage tiers

### Tier 1 — physical tables

Core entities. Typed columns, real composite FKs, purpose-built indexes.

```sql
contacts (org_id, id, name, email, phone, company_id, owner_id, ...)
```

Fast, constrained, and the shape you want for anything the product itself
reasons about.

### Tier 2 — `data` JSONB on a physical table

Org-defined custom fields on a core entity. Defined by a row in `fields`;
stored in the owning table's `data` column.

```sql
UPDATE contacts SET data = data || '{"college_tag":"RIT Dubai"}'::jsonb ...
```

**Adding a field is one metadata row and zero DDL.** That is the whole point:
an org that wants 40 custom fields on a contact does not get 40 `ALTER TABLE`
statements and a migration review.

Hot fields get promoted to an expression index:

```sql
CREATE INDEX CONCURRENTLY idx_contacts_college
  ON contacts ((data ->> 'college_tag')) WHERE org_id = 42;
```

Promotion is governed by `field_indexes`: recommended → approved → building →
active. `CONCURRENTLY` means no write lock, so promotion is an online
operation.

### Tier 3 — the generic `records` table

Entire user-defined modules. One table, `module_id` distinguishing them, values
in `data` JSONB.

```sql
records (org_id, id, module_id, data, lifecycle_state, status, ...)
```

~50 custom modules per org, and **no per-module DDL, ever**. A tenant creating
a "Scholarship" module does not create a table.

The kernel makes all three tiers look identical to the API: the same CRUD
routes, the same permission keys (`record.<module>.<action>`, auto-registered),
the same validation pipeline, the same outbox events.

## Outbox

```ts
await this.db.tx(async (tx) => {
  const contact = await this.repo.insert(tx, orgId, values);
  await this.audit.record(tx, { module: 'contacts', recordId: contact.id, action: 'insert' });
  await this.outbox.emit(tx, {
    aggregateModule: 'contacts',
    aggregateId: contact.id,
    eventType: 'contact.created',
    payload: { uuid: contact.uuid },
  });
});
```

`emit` takes a `tx`, not a database handle, so it cannot be called outside the
transaction it is supposed to be part of.

**In the outbox:** record CRUD, conversation lifecycle, campaign lifecycle,
application status, wallet postings.
**Not in the outbox:** individual messages and delivery receipts — they would
bury the drain and they already have a durable log.

## Audit

```ts
await this.audit.record(tx, {
  module: 'contacts',
  recordId: id,
  action: 'update',
  delta: this.audit.diff(before, after), // only changed keys survive
});
```

Append-only, partitioned monthly, never updated. Also the consent history.
Streams are exempt — auditing an append-only table doubles the write volume to
record nothing new.

## Display IDs

```ts
const displayId = await this.displayIds.next(tx, orgId, 'contacts', 'CON');
// CON-00001
```

Allocated 100 at a time and handed out from memory. The naive
increment-per-insert takes a row lock per row, which turns a 50k-row import
into 50k serialised round-trips.

**Gaps are expected and fine.** A process restart abandons the rest of its
batch. A display id is a label, not a count — nothing may infer volume from it.

## Optimistic locking

Every mutable table has `row_version`, incremented by the `touch_row()`
trigger. The application never writes it; it only asserts the value it read:

```sql
UPDATE contacts SET ... WHERE org_id = $1 AND id = $2 AND row_version = $3
```

Zero rows affected means someone else committed first → `409
ROW_VERSION_CONFLICT`. The client re-reads and re-applies; it must never retry
blindly.
