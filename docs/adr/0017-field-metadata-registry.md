# ADR-0017: Generic field-metadata registry for Tier-2 custom fields

- **Status:** accepted
- **Date:** 2026-09-25
- **Deciders:** —

## Context

`0004_crm_contacts.sql`'s header comment already committed this platform to
a two-tier field model: Tier-1 is a typed physical column, Tier-2 is an
org-defined custom field stored in a `data jsonb` column, so that "add a
custom field" needs zero DDL against a live table. That comment named the
mechanism ("defined by `fields` metadata, which arrives with the kernel
migration") but no such table existed yet.

Phase 8 (`docs/phase-plan.md`) — Settings > Data Management > Contact
Properties — is the first consumer: an admin-facing UI to define sections,
fields (with type, validation flags, options, conditional dependencies) and
per-module status pills (lifecycle stage, deal status, ...). The full
six-table design was drafted and reviewed against the live reference product
in `docs/contacts-schema-design.dbml`; `docs/global-schema-design.dbml`
tracks which parts are migrated vs. still proposed.

The obvious comparison point is Twenty CRM's metadata system
(`docs/twenty-schema-design.dbml`, kept for reference only): `objectMetadata`

- `fieldMetadata` there back a **fully dynamic** schema — creating a custom
  field there means Postgres DDL (`ALTER TABLE ... ADD COLUMN`) against that
  workspace's own physical table, because each Twenty workspace already owns a
  separate Postgres schema. This platform made the opposite tenancy choice in
  ADR-0002 (shared schema, RLS, not schema-per-tenant), so that approach does
  not transplant cleanly: DDL triggered by an org admin against a table shared
  by every tenant is a locking and migration-ownership problem this platform
  does not have today.

## Decision

Custom fields stay schemaless storage (Tier-2, `data jsonb`), described by a
generic metadata registry rather than one registry per module:

- `field_sections` — named groups a field renders under, per `module_key`.
- `fields` — one row per custom field: `module_key`, `key` (the storage key
  inside `data`), `label`, `field_type`, and the validation/visibility flags
  (`is_required`, `is_hidden`, `is_read_only`, `is_masked`, `is_unique`,
  `is_quick_create`, `is_global_search`, `is_system`). `config` is a jsonb
  bag for whatever the type needs (currency code, rating max, formula
  expression, lookup target).
- `field_options`, `field_dependencies`, `field_option_dependencies` — the
  choice list and the field-level / option-level conditional-visibility
  edges.
- `status_options` — per-module enum groups (`lifecycle_stage`,
  `deal_status`, subscription statuses, ...) that are pills/dropdowns in the
  UI but extensible by an org without a code deploy.

`module_key` is the generalisation: `'contacts'` today, `'companies'` reuses
the identical six tables later with zero new migration — only the API layer
adds a new value to `moduleKeySchema` (`packages/contracts/src/common/enums.ts`)
and a new caller. A field's `key` and `field_type` are immutable after
creation; a genuine type change creates a new field row pointing at the old
one via `replaces_field_id`; no code path ever changes a live field's type
in place.

Every value coming through this registry is validated at the **application**
layer (the field-metadata API module, `apps/api/src/modules/crm/{field-sections,fields,status-options}`)
against the org's own `fields`/`field_options` rows — never by a Postgres
column type or `CHECK` constraint, because there is no per-field column to
constrain.

Implemented in `packages/db/migrations/0010_add_contact_properties.sql`
through `0013_add_status_options_uuid.sql`; Drizzle mirror in
`packages/db/src/schema/field-metadata.ts`; contracts in
`packages/contracts/src/crm/field-metadata.ts`.

## Consequences

### Positive

- Adding a custom field, or a whole new module's worth of them, is an INSERT
  into `fields`, not a migration — exactly the promise `0004_crm_contacts.sql`
  made before this registry existed to back it.
- One set of tables serves every module that adopts Tier-2 fields. Companies
  (Phase 7) is close to free once this lands, rather than a second registry
  to build and keep in sync.
- RLS and the standard `(org_id, id)` / composite-FK shape apply uniformly —
  this is ordinary tenant data, not a schema-mutation surface, so it needed
  no new isolation model.

### Negative

- **No column-level type safety.** A `fields.field_type = 'integer'` custom
  field is still stored as whatever JSON the request body contained; a bug
  in the application-layer validator can write a string into what the admin
  configured as a number, and Postgres will not catch it. Twenty CRM's real
  columns don't have this gap — that safety is exactly what shared-schema
  multi-tenancy gives up.
- **No native index on a custom field's value** beyond the single GIN index
  on the whole `data` column (`idx_contacts_data`). A custom field an org
  filters or sorts on heavily has no equivalent to a dedicated btree index
  without a further, per-field opt-in (not built here).
- Renaming or retyping a field is a multi-step, versioned operation
  (`replaces_field_id`) rather than a single `ALTER TABLE ... TYPE`. Correct
  for this tenancy model, but more moving parts than the DDL-per-field
  alternative for that one operation.
- Six tables and a matching API surface is a bigger initial build than a
  single `field_defs` table would have been. Justified as soon as options,
  dependency rules, and per-module status groups are all needed — verified
  against the live reference UI in `docs/contacts-schema-design.dbml`, not
  guessed.

### Neutral

- `status_options` duplicates some of what `fields` + `field_options` could
  express (an enum-typed field with options) but is kept separate: status
  groups are read by non-admin flows too (pipeline stage badges, the
  sub-agent portal polling `lifecycle_stage` per ADR-0014) and are addressed
  by `(module_key, option_group)`, not by a field id — a different access
  pattern, not the same data modeled twice.

## Alternatives considered

### Fully dynamic schema (Twenty CRM's model)

Real Postgres columns, added by DDL when an admin defines a field. Rejected
because it assumes schema-per-tenant (or workspace-per-database), which
ADR-0002 already decided against for this platform. Running admin-triggered
`ALTER TABLE` against a table shared by every tenant turns a settings-page
click into a schema-migration event with locking and rollback semantics no
part of this system is set up to own.

### One custom-field registry per module

A `contact_fields` table, later a separate `company_fields` table, and so on
per module. Rejected: identical shape every time, and the whole point of
`module_key` being a plain column is that Companies (Phase 7) and anything
after it cost an API module, not a migration.

### No registry — validate against a hardcoded per-org config blob

A single `jsonb` "schema config" row per org instead of normalised tables.
Rejected: field ordering, section grouping, per-option dependency edges, and
reorder-by-drag all need to be queried and updated piecemeal (move one
field, add one option) — a single blob forces a read-modify-write of the
entire org's field configuration for every such edit, and loses row-level
optimistic locking (`row_version`) on individual fields.

## Revisit when

An org's custom-field volume or query patterns make the single `data` GIN
index a measured bottleneck (a specific field needs its own index), or this
platform ever moves to schema-per-tenant for an unrelated reason — at which
point the dynamic-DDL model this ADR rejected becomes viable and worth
re-costing.

## Verification

RLS on all six tables verified against a live Postgres connection via
`.claude/skills/add-migration/scripts/check-rls.sh` (enabled, forced, one
`tenant_isolation` policy each) at migration time. Field-level and
option-level dependency edges are cycle-checked before insert
(`FieldDependenciesRepository.wouldCreateCycle`, `apps/api/src/modules/crm/fields/field-dependencies.repository.ts`) —
Phase 8's exit criteria requires this before dependency support ships.
