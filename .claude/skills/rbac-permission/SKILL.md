---
name: rbac-permission
description: >-
  Register a new RBAC capability key correctly for this CRM platform, grant it
  to the right role(s), and wire it to a route with @RequirePermission. Use
  this whenever asked to add a permission, restrict a new endpoint, gate a
  feature behind a role, add a new action to an existing module's
  permissions, or when writing a new controller route that needs access
  control. Never invent a permission key inline in a decorator without first
  registering it in permission_defs — the foreign key on role_grants will
  reject a key that was never seeded, and it will look like a silent
  no-op (the grant insert fails) rather than an obvious error.
---

# Add an RBAC permission

Full model: [docs/architecture/rbac.md](../../../docs/architecture/rbac.md).
This is the four-step "just add the key" version.

## Key naming

`<category>.<resource>.<action>` — dotted, resource in the middle, action
last. Look at what's already seeded in
`packages/db/migrations/0008_seed_permission_defs.sql` before inventing a new
shape:

```
record.contacts.read      record.contacts.update     record.contacts.delete
inbox.conversation.assign broadcast.campaign.start
billing.wallet.topup      exam.application.verify
partner.agent.manage      admin.role.manage
```

If you're adding CRUD for a new entity, its four keys are almost always
`record.<module>.read` / `.create` / `.update` / `.delete`, matching the
pattern every existing entity uses.

## 1. Register the key — a new migration, not an edit

`0008_seed_permission_defs.sql` is **already applied** and immutable — the
runner refuses to re-run an edited file. Adding a permission is a **new**
migration; **invoke the `add-migration` skill** to create it properly, or at
minimum use `pnpm db:new`:

```bash
pnpm db:new add_x_permissions
```

```sql
-- 0009_add_x_permissions
-- New capability keys for the X module.

INSERT INTO permission_defs (key, label, category, supports_scope) VALUES
  ('record.x.read',   'View x',   'x', true),
  ('record.x.create', 'Create x', 'x', false),
  ('record.x.update', 'Edit x',   'x', true),
  ('record.x.delete', 'Delete x', 'x', true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, category = EXCLUDED.category, supports_scope = EXCLUDED.supports_scope;
```

`supports_scope = true` means this permission's grants can be scoped to
`team`/`own`, not just `all` — set it `true` for anything where "only my own
records" is a sensible thing for an org to configure (basically all
`record.*` reads/updates), `false` for org-wide toggles like
`billing.wallet.topup` where partial scope makes no sense.

## 2. Run it

```bash
pnpm db:migrate
```

## 3. Grant it to a role

This is data, not a migration — either via the app once role management UI
exists, or directly for seed/dev purposes in
`packages/db/src/cli/seed.ts` (see how it grants the Admin preset every key,
and grants the Counsellor preset a narrower `own`-scoped set). Remember: the
Admin preset role is `is_locked = true`, and a database trigger
(`protect_locked_role`) refuses any grant change on a locked role — grant to
Admin only **before** locking it, exactly as the seed script does.

```sql
INSERT INTO role_grants (org_id, role_id, permission_key, effect, record_scope)
VALUES ($orgId, $roleId, 'record.x.read', 'allow', 'own')
ON CONFLICT (org_id, role_id, permission_key) DO NOTHING;
```

## 4. Use it on a route

```ts
@Get()
@RequirePermission('record.x.read')
async list(
  @Query(...) query: ListXQuery,
  @GrantedScope('record.x.read') scope: RecordScope,   // 'all' | 'team' | 'own'
) {
  return this.x.list(query, scope);
}
```

The guard resolves the caller's merged grants (deny beats allow; among
allows, widest scope wins — see the RBAC doc for why) and throws 403 before
the handler runs if the key isn't granted. The **scope** it resolves is
handed to the service, which must actually apply it to the query — see
`contacts.repository.ts`'s `list()` for the exact SQL pattern for `team`
scope (a subquery over `team_members`) vs `own` (`owner_id = me`).

**A permission with no scope-applying code behind it is worse than no
permission** — it reads as "this is properly restricted" in the controller
while the service quietly returns everything. If you add
`@RequirePermission(...)` with `supports_scope: true`, the repository method
it calls must branch on `own`/`team`/`all`.

## If the caller isn't staff

Partner agents and candidates carry no grants at all — don't add permission
keys for them. They're scoped structurally instead (a partner query joins
through `partner_agent_leads` filtered by the token's agent id). Use
`@ActorKinds('partner_agent')` on the controller instead of
`@RequirePermission`. See
[docs/architecture/partner-agents.md](../../../docs/architecture/partner-agents.md).
