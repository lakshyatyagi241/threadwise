# ADR-0007: Separate identity pools with our own JWT auth

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Four kinds of actor authenticate against this system:

| Actor             | Who                                    | Sees                       |
| ----------------- | -------------------------------------- | -------------------------- |
| **Staff user**    | counsellors, managers, admins          | the CRM, per RBAC          |
| **Partner agent** | external sub-agents / channel partners | only leads they submitted  |
| **Candidate**     | exam applicants                        | only their own application |
| **API key**       | external systems                       | `/public/v1`, per scope    |

A "user" table with a role column would put all four in one place.

## Decision

Separate tables per pool: `users`, `partner_agents`, `candidates` (with Exams),
`api_keys`. Each has its own login endpoint and its own guard.

Tokens carry a `typ` claim (`user` / `partner_agent` / `candidate`), and
controllers declare which types may reach them:

```ts
@ActorKinds('partner_agent')
@Controller({ path: 'partner', version: '1' })
```

Authentication is our own: argon2id password hashes, short-lived access JWT,
longer-lived refresh JWT, **different signing secrets for each**.

`users.auth_subject` is reserved for an external IdP subject, so SSO can be
added later without a schema change.

## Consequences

### Positive

- An external agent cannot appear in an assignment dropdown, an SLA report or a
  team inbox — not because a filter excludes them, but because they are not in
  the table those features read.
- Each pool gets the fields it actually needs (agents have a `code` and
  commission settings; candidates have `email_verified` / `phone_verified`).
- A cross-pool token is rejected at the controller, not deep in a service.
- No per-MAU billing on candidate volume.

### Negative

- Login, refresh, password reset and lockout logic is written once per pool.
  `AuthService` shares the mechanics, but the surface is duplicated.
- Every new identity pool is a new guard and a new set of tests.
- We own password storage, reset flows and MFA if it is ever wanted. That is a
  real, permanent security responsibility.

### Neutral

- Refresh tokens are currently stateless JWTs. Server-side revocation needs a
  `refresh_tokens` table — a known, deliberate gap, not an oversight.

## Security notes

- Login verifies against a dummy argon2 hash when the account does not exist, so
  response timing does not reveal which emails are registered.
- "Org not found", "user not found" and "wrong password" all return the same
  `Invalid credentials`. Distinguishing them turns login into an enumeration
  endpoint.
- Token verification failures never say _why_ (expired vs malformed vs bad
  signature) — that is a free hint to anyone probing.

## Alternatives considered

### One `users` table with a `type` column

One forgotten `WHERE type = 'staff'` and an external agent is in the staff
picker. The failure is silent and the blast radius is a customer relationship.

### Keycloak / Auth0 / Clerk

Offloads MFA, SSO and social login. Candidate volume makes per-MAU pricing
expensive, multi-tenant modelling is awkward in all three, and the candidate
portal usually ends up custom anyway.

## Revisit when

An enterprise customer requires SAML/OIDC SSO. `auth_subject` is the hook;
the `IdentityProvider` seam goes in front of `AuthService` at that point.
