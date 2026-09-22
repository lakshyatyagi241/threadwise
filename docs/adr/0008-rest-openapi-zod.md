# ADR-0008: REST with OpenAPI, and Zod contracts shared with the frontend

- **Status:** accepted
- **Date:** 2026-09-16

## Context

The API is consumed by a Next.js staff app, a partner portal, a candidate
portal, provider webhooks and external partner systems. Types drifting between
server and client is the recurring cost.

## Decision

REST with URI versioning (`/v2/...`), documented by `@nestjs/swagger`.

Request and response shapes live in `@crm/contracts` as Zod schemas, with
TypeScript types inferred from them. The API validates with those exact schemas
via a small `ZodValidationPipe`; the frontends import the same package.

```ts
// packages/contracts — written once
export const createContactSchema = z.object({ ... })
  .refine((v) => Boolean(v.email || v.phone), { ... });

// apps/api — validates and transforms
async create(@Body(zodPipe(createContactSchema)) body: CreateContactInput) { ... }

// apps/web — parses at the boundary
const contact = contactResponseSchema.parse(await res.json());
```

Nest's own `class-validator` DTOs are not used.

## Consequences

### Positive

- One definition, both sides. Renaming a field breaks the frontend build in the
  same commit instead of at runtime in production.
- The pipe output is the _parsed_ value, so defaults and coercions (numeric
  `limit`, lowercased email) reach the handler already applied.
- Zod refinements express rules class-validator cannot — "at least one of email
  or phone" is one `.refine`.
- REST works for webhooks, partner integrations and curl. GraphQL does not,
  without a second surface.

### Negative

- Swagger cannot introspect Zod, so request/response schemas are not in the
  generated OpenAPI document automatically — only routes, tags and descriptions
  are. Filling that gap needs `zod-to-openapi` or hand-written `@ApiResponse`
  decorators. **Known gap.**
- The contracts package is a build dependency of the API; a stale build produces
  confusing type errors.
- Zod validation is slower than class-validator at very high request rates. Not
  a factor at this volume.

### Neutral

- Enum values are mirrored in `contracts/common/enums.ts` and in SQL. Adding a
  value means touching both in the same commit; nothing checks it for you.

## Alternatives considered

### GraphQL

A genuinely good fit for the metadata-driven dynamic-field model. Rejected for
now: rate limiting and caching are harder, webhooks still need REST, and
partner integrations are far easier to support over REST.

### tRPC for internal, REST for external

End-to-end types with no codegen, but two API surfaces to keep in step and no
OpenAPI for the internal one.

### class-validator DTOs

The Nest default. Types cannot be shared with the frontend, so the client
either regenerates from OpenAPI or redeclares by hand.

## Revisit when

The OpenAPI schema gap starts costing real time — the fix is
`@asteasolutions/zod-to-openapi` wired into the document builder, without
changing any contract.
