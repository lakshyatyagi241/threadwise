# RBAC

Permissions are checked in a guard, before the handler runs. RLS does tenant
isolation and nothing else. See
[ADR-0006](../adr/0006-rbac-at-middleware.md).

## Model

```
user ──< user_roles >── role ──< role_grants >── permission_def
                                    │
                                    ├── effect:       allow | deny
                                    └── record_scope: all | team | own
```

- `permission_defs` is **global** — the set of things the platform can do is a
  property of the platform, not of a customer.
- `roles` and `role_grants` are **per org** — every tenant defines its own.

## Capability keys

Dotted, resource-first, action-last:

```
record.contacts.read        record.contacts.update
inbox.conversation.assign   broadcast.campaign.start
billing.wallet.topup        exam.application.verify
partner.agent.manage        admin.role.manage
```

Custom modules auto-register `record.<module>.<action>` at creation, which is
why the registry is global rather than per-tenant.

## Merge rules

When a user has several roles, grants merge:

1. **deny beats allow**, from any role, always.
2. Among allows, the **widest scope wins**: `all` > `team` > `own`.

Rule 1 makes a "revoke" role actually revoke. Rule 2 makes
"Counsellor + Manager" behave the way a human expects.

## Scopes

| Scope  | Means                               | Applied as                        |
| ------ | ----------------------------------- | --------------------------------- |
| `all`  | every record in the tenant          | no extra predicate                |
| `team` | records owned by anyone on my teams | `owner_id IN (my teams' members)` |
| `own`  | only records I own                  | `owner_id = me`                   |

The guard resolves the scope and stashes it on the request context; the handler
passes it to the service, which applies it to the query:

```ts
@Get()
@RequirePermission('record.contacts.read')
async list(
  @Query(zodPipe(listContactsQuerySchema)) query: ListContactsQuery,
  @GrantedScope('record.contacts.read') scope: RecordScope,
) {
  return this.contacts.list(query, scope);
}
```

A caller with no resolvable user id collapses to a predicate that matches
nothing, never to "everything".

## Caching and invalidation

Cache key: `rbac:{orgId}:v{rolesVersion}:u{userId}`, TTL 10 minutes.

`organizations.roles_version` is part of the key. Bumping that column
invalidates **every** cached grant set for the org at once — no key
enumeration, no stale permissions after an admin revokes access.

```ts
await this.rbac.bumpRolesVersion(orgId); // after any role/grant change
```

A cache write failure never fails the request: the authoritative answer already
came from the database.

## The Admin preset is immutable

Enforced by a database trigger, not by hiding a button:

```sql
CREATE TRIGGER trg_role_grants_protect
  BEFORE INSERT OR UPDATE OR DELETE ON role_grants
  FOR EACH ROW EXECUTE FUNCTION protect_locked_role();
```

Any attempt to change grants on a role with `is_locked = true` raises
`insufficient_privilege`. An org that could edit its own Admin role could lock
itself out of its own tenant — and that is a support incident with no clean
recovery.

There is an integration test for this.

## Non-staff actors

Partner agents and candidates carry **no grants at all**. They are scoped
structurally instead: every partner query joins through `partner_agent_leads`
filtered by the agent id in their token, so there is no permission to check and
no way to widen it.

Controllers additionally pin which token types may reach them:

```ts
@ActorKinds('partner_agent')   // a staff token is rejected here, and vice versa
```

## Adding a permission

1. Add the key to `packages/db/migrations/0008_seed_permission_defs.sql`
   (or a new migration — that file is already applied and immutable).
2. Decorate the route with `@RequirePermission('your.new.key')`.
3. Grant it to the roles that should have it.
4. Bump `roles_version` for affected orgs.

Keys not present in `permission_defs` cannot be granted — the foreign key
refuses them, which is what stops typo-permissions from silently never matching.
