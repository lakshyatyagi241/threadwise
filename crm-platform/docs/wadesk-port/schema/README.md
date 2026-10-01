# WaDesk data model in crm-platform

The whole WaDesk database (227 tables, 3,495 columns) translated into this repo's Postgres shape, with the Drizzle schema that
describes it and a check that keeps the two honest. Schema only: no WaDesk rows, no WaDesk migrations, no WaDesk code.

## What exists now

| What                                                                           | Where                                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 51 migrations, one per domain, in dependency order                             | `packages/db/migrations/2026100110*_<code>_wadesk_schema.sql`                                   |
| Drizzle tables, one folder per domain (50 folders)                             | `packages/db/src/schema/<domain>/tables.ts`, re-exported from `schema/index.ts` between markers |
| Every WaDesk table: what it became, owner, FK and loose-reference counts       | [table-map.md](table-map.md)                                                                    |
| What a person still has to look at (loose references, secrets, JSON, findings) | [review-notes.md](review-notes.md)                                                              |
| ERD for dbdiagram.io                                                           | [docs/db/wadesk-port-schema.dbml](../../db/wadesk-port-schema.dbml)                             |
| The judgement calls, in one file                                               | [source/decisions.toml](source/decisions.toml)                                                  |
| The generator and its inputs                                                   | `.claude/skills/wadesk-data-model-port/scripts/gen_schema.py`, [source/](source/)               |
| The drift check                                                                | `pnpm db:verify-schema` (`packages/db/src/verify.ts`), also run by the schema-invariants test   |

Of the 227 WaDesk tables: 129 became tenant tables, 28 tenant child tables (tenancy inherited from a parent row), 16 monthly-partitioned
streams, 14 platform catalogues (any tenant may read, only the privileged role writes), 9 platform-operator tables (invisible to
tenants). 20 already exist here and were mapped (column by column, see the table map). 11 were dropped: Laravel plumbing replaced by BullMQ,
Redis and the auth tables, plus `message_charges`, which is `usage_charges` now. Six tables exist that WaDesk does not have as one table:
`workspace_settings`, `contact_group_members`, `usage_charges`, `wallets`, `user_settings`, `referral_codes`. Total new: 202 tables, 288
foreign keys (277 composite), 456 indexes, 110 unique keys, 173 `jsonb` columns, 41 secret columns, 17 streams.

Seven existing tables got additive columns (`users`, `teams`, `team_members`, `contacts`, `companies`, `tags`, `api_keys`), written by
hand in `source/overlays/` and mirrored in their Drizzle files.

## The ORM question

Drizzle stays. The schema has composite primary and foreign keys on every tenant table, forced row-level security, monthly range
partitions, partial and expression indexes and trigger-maintained columns. Prisma and TypeORM cannot model those (has the
detail), and Kysely would give up `$inferSelect` in service signatures for no gain. What was missing was not a different ORM but a
Drizzle schema that is a complete, checked reference. That is what this adds:

- every new table declares its primary key, composite foreign keys with their `ON DELETE`, unique keys, indexes and check constraints
  in Drizzle, not just its columns;
- `pnpm db:verify-schema` compares every Drizzle table with the live catalog and fails on anything that would break at runtime (missing or
  mistyped column, nullability or default disagreement, a key or index that is not there, a tenant table without forced RLS and a policy);
- the SQL migrations stay the source of truth and Drizzle never generates DDL, so partitions, policies and triggers are not
  fought with a generator.

The check ran against the existing tables too and found one real mismatch (`organizations.roles_version` was `integer` in SQL and
`bigint` in Drizzle, fixed). It also reports 112 warnings about the older hand-written Drizzle files (undeclared foreign keys and the
`uuid` default); those cannot break a query and are listed by `--verbose`.

## How WaDesk columns were translated

| WaDesk                            | Here                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`                    | `org_id`, first column of the primary key and of every index                                                                                 |
| auto-increment `id`               | `bigint GENERATED BY DEFAULT AS IDENTITY`, plus a `uuid` (only the uuid leaves the API)                                                      |
| `*_id` pointing at a tenant table | composite `FOREIGN KEY (org_id, x) REFERENCES t (org_id, id)`                                                                                |
| `varchar` / `text`                | `text`                                                                                                                                       |
| `tinyint(1)`                      | `boolean`                                                                                                                                    |
| `decimal(p,s)`                    | `numeric(p,s)`, a string end to end                                                                                                          |
| `longtext` that holds JSON        | `jsonb`; found from the Eloquent casts, a `_json` name, or a reviewer reading the code                                                       |
| `enum(...)`                       | `text` plus a `CHECK`                                                                                                                        |
| `datetime`, `timestamp`           | `timestamptz`                                                                                                                                |
| `deleted_at`                      | gone: hard delete plus an audit row                                                                                                          |
| token, secret, credential columns | `text` holding AES-GCM ciphertext; a secret that is looked up by value (it has an index) stays plain or hashed, ciphertext cannot be indexed |
| unique key without `workspace_id` | per tenant, except platform-issued tokens, slugs and provider ids (the allowlist in `decisions.toml`)                                        |
| logs, events, per-message rows    | streams: monthly `RANGE` partition, primary key `(id, <time>)`, explicit sequence, default partition, no foreign keys in or out              |
| tenant row with no `workspace_id` | child table: `org_id` added, composite FK to its parent so the tenant cannot drift                                                           |

Every tenant table has `ENABLE` and `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy and the `touch_row` trigger. A platform
catalogue has a `read_all` select policy plus an `operator_write` policy gated on `app_is_privileged()`; a platform-operator table has
only the second, the same shape `auth_core` uses for the operator tables.

## Decisions made while translating

These are in `decisions.toml` and easy to change; none of them is a decision about WaDesk's behaviour.

1. **PII is stored plain under RLS, with no lookup hash** (P1). WaDesk encrypts contact name, number and email and keeps a hash for
   search. This repo already stores contacts plain behind RLS, so `contacts.mobile_hash` is not carried. Needs a decision before anyone
   encrypts PII here; until then secrets are ciphertext and personal data is not.
2. **A reference to a user is nullable and `SET NULL`** (P2). WaDesk `user_id` columns are mostly `NOT NULL`, which would make deleting a
   user either impossible or destructive. Per-user settings rows (`user_settings`) are the exception and cascade.
3. **Delete rules** (P3). A child row cascades from its parent. A `NOT NULL` reference to another tenant row cascades, except in the
   financial domains (`inv`, `wallet`, `paygw`, `plan`, `chk`, `sales`, `bsp`, `cpn`) where it restricts: an invoice or ledger row must
   not vanish because a contact was deleted. WaDesk's own explicit foreign-key rules win over all of this.
4. **Streams** (P4). 17 tables, chosen by whether they are append-only and high-volume, then corrected after reviewers read how the code
   uses each (for example `wa_link_clicks`, `flow_retry_logs` and `ai_call_logs` are updated after insert, so they are regular tables).
5. **The billing design wins where it already names a table** (P5). `wallets` (balance, reserved, the `balance >= 0 AND reserved >= 0 AND
reserved <= balance` check) replaces the two balances WaDesk keeps on `users`; `usage_charges` is `message_charges`;
   `wallet_transactions` gets the `(org_id, idempotency_key)` unique and `numeric(20,4)` amounts. A wallet has a `unit` (`credits` or a currency code) because WaDesk
   has two balances where the billing design assumes one.
6. **Loose references** (P6). A numeric `*_id` with no single target stays a plain column: polymorphic pairs, provider ids, streams (no
   foreign keys), and platform tables pointing at tenant rows. 57 of them, each listed in [review-notes.md](review-notes.md).
7. **Access to platform tables** (P7). `platform_only` tables (`payment_gateways`, `coupons`, `admin_ai_keys`, ...) cannot be read from a
   tenant transaction at all. The platform side reads them as the privileged role; a tenant-facing read (validating a coupon at
   checkout) must go through a worker or a security-definer function. See open decision 3.

## Open decisions (a person has to make these)

1. **One channel model.** `device_id` on `broadcasts`, `keyword_replies`, `auto_reply_lookups`, `scheduled_messages`,
   `warmer_daily_sends` and `conversations` is a `devices.id` for the Baileys engine and a `wa_provider_configs.id` for Cloud API, and
   WaDesk's own code warns that the ids collide. Here they are loose columns. The channel core (F3) needs a decision that replaces both with
   one channel table, then these columns get a real foreign key.
2. **PII encryption** (see P1).
3. **Reading platform tables from a tenant context** (see P7), part of the operator-layer work (F2, D4/D5).
4. **Partition maintenance.** Done (conflict-map H11). `apps/api/src/workers/partition-maintenance.service.ts` reads `pg_partitioned_table`
   (`RANGE` parents in `public`, partitions excluded) on every run, so the 17 new streams are kept three months ahead like `event_outbox`
   and `audit_log` with no list to edit. The worker runs as `crm_app_user`, which cannot create a partition, so
   `ensure_monthly_partition()` is `SECURITY DEFINER` (migration `20261001110000_partition_definer`, proposed: the db steward
   should review it, as it is the schema's first definer function). Two follow-ups in `20261001110100_partition_rls`: every partition
   now carries its parent's RLS and policy (`inherit_partition_rls()`; before, a query naming a partition read every tenant's rows), and
   the `0006` partitions got the app-role grants they lacked, so a pass ends by logging a warning when a `_default` partition holds rows.
   `apps/api/test/integration/partition-maintenance.spec.ts` runs all of it as the app role. A migration that creates a partition by hand
   (a stream's `_default`) must call `inherit_partition_rls()` on it; `schema-invariants.spec.ts` fails if one does not.
5. **`usage_charges` cannot keep a unique `wamid`.** WaDesk enforces one charge per WhatsApp message id; a partitioned table can only be
   unique over a key that includes the partition column. The ledger's idempotency has to be a `(org_id, wamid, created_at)` unique or
   an application check.
6. **Enum values.** 19 WaDesk `enum` columns became `CHECK`s. The closed value sets that reviewers found in code for the many
   `varchar` status columns are listed in review-notes but not enforced; add the `CHECK` when the feature is ported.
7. **JSON shapes.** 173 `jsonb` columns, no validation. Each needs a Zod schema in `@crm/contracts` before a feature depends on it.
   Several hold Laravel ciphertext in WaDesk, so a data migration must decrypt and re-encrypt them.
8. **Money representation.** WaDesk stores money as integer minor units (`*_minor`) and credits as integers, which is exact and was kept
   everywhere except the wallet and its ledger (`numeric(20,4)`). Decide whether `usage_charges.revenue_minor`/`cost_minor`
   and the order, invoice and plan amounts move to `numeric` too before the billing code is written.
9. **Foreign-key indexes.** Only WaDesk's own indexes were carried. A hard-delete of a parent with many children scans the child table
   unless the column is indexed; add the index where a feature deletes at scale.
10. **Data migration** is out of scope here: this is the schema. WaDesk ids, encrypted columns and the JSON-list-to-join-table
    conversion (`contacts.contact_group` to `contact_group_members`) are the data migration's job.

## Working with it

```bash
pnpm db:migrate                 # apply (every new table arrives with RLS forced)
pnpm db:verify-schema           # Drizzle versus the database, errors only
pnpm db:verify-schema --verbose # include the warnings
```

To change a table after this baseline: write a new migration with the `add-migration` skill, change the Drizzle file in the same commit,
run `pnpm db:verify-schema`. Do not regenerate over the repo; the generator is for comparing:

```bash
python3 .claude/skills/wadesk-data-model-port/scripts/gen_schema.py --out /tmp/wadesk-schema   # then diff against the repo
```

To refresh the inputs after WaDesk changes: `extract_schema.py` (needs the reference DB from the `wadesk-run-reference` skill) and
`extract_models.py`, then review `decisions.toml`. `merge_review.py` folds findings from agents that read the WaDesk source into
`source/review-overrides.json`.
