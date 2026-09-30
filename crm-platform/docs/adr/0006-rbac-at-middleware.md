# ADR-0006: RBAC in the guard layer; RLS does tenant isolation only

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Two different questions look similar and must not be conflated:

1. **Which tenant's rows is this connection allowed to touch?** (isolation)
2. **Is this user allowed to perform this action, on which subset of rows?**
   (authorisation)

Postgres RLS can express both. That does not make it a good idea.

## Decision

RLS answers question 1 only: `org_id = current_org_id()`.

Question 2 is answered by a guard, before the handler runs:

```ts
@RequirePermission('record.contacts.read')
async list(@Query(...) query, @GrantedScope('record.contacts.read') scope) { ... }
```

Model: `user → roles → grants(permission_key, effect, record_scope)`.

Merge rules:

1. **deny beats allow**, from any role.
2. Among allows, the **widest scope wins** (`all` > `team` > `own`).

The resolved scope is passed to the service, which narrows the query
(`own` → `owner_id = me`, `team` → owner in my teams).

Grants are cached in Redis under a key containing the org's `roles_version`.
Bumping that column invalidates every cached set for the org at once.

The Admin preset role is immutable — enforced by a database trigger
(`protect_locked_role`), not by hiding a button.

## Consequences

### Positive

- Query plans do not depend on who is asking. Pushing per-user predicates into
  policies gives admins a fast path and everyone else a sequential scan.
- Permission errors arrive as 403 with the missing capability named, before any
  query runs — instead of surfacing as a mysteriously empty list.
- Permissions are debuggable: log the grant set, read it.
- Invalidation is one counter, not key enumeration.

### Negative

- A service method called from somewhere without a guard has no permission
  check. The guard is the enforcement point, so anything that bypasses HTTP
  (a worker, a bot tool call) must apply its own policy explicitly.
- The scope-to-SQL translation is repeated per module. Contacts is the
  reference; the kernel will absorb it when the generic records store lands.
- Grants cached for up to 10 minutes if a `roles_version` bump is missed.

### Neutral

- Partner agents and candidates carry no grants at all. They are scoped
  _structurally_ — a partner query always joins through `partner_agent_leads`
  filtered by the agent id in their token, so there is no permission to check
  and no way to widen it.

## Alternatives considered

### Permissions in RLS policies

One enforcement point, and every plan becomes user-dependent. Also: a policy
that filters rows makes "you lack permission" indistinguishable from "there is
nothing here" — which turns an actionable 403 into a support ticket.

### Full ABAC / policy engine (OPA, Cedar)

More expressive than we need. Adds a service (or a WASM runtime) and a second
policy language for a permission model that is currently 33 capability keys.

## Revisit when

Customers ask for field-level permissions or conditional rules ("only leads
from my region"). That is where a real policy engine starts to earn its cost.
