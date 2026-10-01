---
name: contracts-change
description: >-
  Add or change a request/response shape in @crm/contracts (packages/contracts)
  for this CRM platform — the Zod schemas shared by the API and every
  frontend. Use this whenever asked to add a field to an API response, create
  a new endpoint's input/output types, change what a DTO looks like, add a
  new error code, or add/change an enum. Never define a request or response
  type directly in apps/api (a class-validator DTO, an inline interface, a
  duplicate zod schema) — if it crosses the network boundary, it belongs in
  @crm/contracts or the frontend and the API will silently drift apart.
---

# Change @crm/contracts

Short version: one Zod schema, type inferred from it, imported by both sides
— the API validates with the literal same schema object the frontend imports
for its types, so a field rename breaks the frontend _build_, not a user's
session in production.

## Where things live

```
packages/contracts/src/
  common/
    ids.ts          uuid/phone/email/currency primitives
    pagination.ts   cursor + page envelope — reuse, don't reinvent
    errors.ts       ERROR_CODES + the problem+json shape
    enums.ts        mirrors of the Postgres enums
  crm/contact.ts     one file per entity, per app — follow this shape
  partner/...
  public/...
  index.ts           the barrel — everything must be re-exported here
```

New entity → new file under the right app folder (`crm/`, `partner/`,
`public/`, or a new folder for a new app), re-exported from `index.ts`. Don't
add unrelated shapes to an existing entity's file.

## The pattern for one entity — follow `crm/contact.ts` exactly

```ts
export const xResponseSchema = z.object({
  id: uuidSchema, // NEVER a raw internal id
  // ...camelCase fields...
  rowVersion: z.number().int(), // if the entity supports optimistic locking
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type XResponse = z.infer<typeof xResponseSchema>;

export const createXSchema = z
  .object({
    // only what a client may set on create
  })
  .refine(/* cross-field rule, if any — see contact.ts's "needs email or phone" */);
export type CreateXInput = z.infer<typeof createXSchema>;

export const updateXSchema = z.object({
  // .nullish() fields the client may unset, .optional() ones it may leave alone
  rowVersion: z.number().int().positive(), // required on every update — the optimistic lock
});
export type UpdateXInput = z.infer<typeof updateXSchema>;

export const listXQuerySchema = paginationQuerySchema.extend({
  // entity-specific filters
});
export type ListXQuery = z.infer<typeof listXQuerySchema>;
```

Rules that aren't optional:

- **Schema first, type inferred — never the reverse.** Don't write a
  TypeScript `interface` and then a matching Zod schema; the schema IS the
  type via `z.infer`.
- **Every identifier is `uuidSchema`.** If you're tempted to put a number id
  in a contract, the internal bigint is leaking.
- **camelCase, always.** The database is snake_case; the mapping happens in
  the API's `<entity>.mapper.ts`, never in the contract.
- **List queries extend `paginationQuerySchema`** from `common/pagination.ts`
  — don't hand-roll `limit`/`cursor`/`order` again.
- **Update schemas always carry `rowVersion`.** Omitting it silently disables
  optimistic locking for that entity.
- **New error codes go in `common/errors.ts`'s `ERROR_CODES` const**, not as
  a string literal at the throw site — `AppError` statics and the frontend
  both need the stable key to exist there.

## After editing

```bash
pnpm --filter @crm/contracts build
```

**Do this before touching the API.** The API imports `@crm/contracts` by its
built `dist/` output (see the package's `main`/`types` fields), not by
source — a schema change is invisible to `apps/api` until this rebuilds.
Forgetting this step is the most common way "I added the field but the API
says it doesn't exist" happens.

```bash
pnpm --filter @crm/contracts typecheck
pnpm --filter @crm/contracts lint
```

If you changed an **enum**, the matching Postgres enum must get the same
value — **invoke the `add-migration` skill** (`ALTER TYPE ... ADD VALUE`
needs `-- @no-transaction`, and enum values are append-only). The two must
agree; nothing checks that automatically.

If this contract belongs to a brand-new entity, **invoke the `new-module`
skill** for the API side. If it's consumed by the staff or partner frontend,
**invoke `frontend-api-call`** for the client side.

If you changed a **response shape** that an existing mapper produces
(`<entity>.mapper.ts` in the API), update the mapper in the same commit —
the contract describes the shape, the mapper is what actually produces it,
and a TypeScript type error there is the signal you missed a field, not a
false alarm to silence.
