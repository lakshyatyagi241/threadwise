# Persona profiles API (phase 0)

Spec: [../specs/persona-profiles.md](../specs/persona-profiles.md) (backlog BL-280). Wiring map: [../threadwise-port/wiring/persona-profiles.md](../threadwise-port/wiring/persona-profiles.md).

Phase 0 has **no route of its own**. It adds the data, the pure resolver, and one optional field on the session. Nothing in the product reads
that field yet, and every workspace resolves to the `generic` persona, which hides nothing, so no person can see a difference. The workspace and
operator endpoints (`/v2/persona/*`, `/v2/platform/personas/*`, `/v2/platform/workspaces/:id/persona/*`) arrive with the screens that use them,
phases 1 to 4.

## `GET /v2/auth/session`: `org.persona` (optional)

```jsonc
"org": {
  "id": "…", "slug": "…", "name": "…", "plan": "…", /* … existing fields unchanged … */
  "persona": {
    "key": "generic",
    "version": 1,
    "rev": 1,                      // bumped by every change to the workspace's persona row: the cache key
    "solo": false,                 // only an explicit "on" for now; the seat count that drives "auto" arrives with onboarding (phase 4)
    "showAll": false,              // the workspace's "Show more modules" switch
    "defaultVisibility": "show",   // what every module NOT listed in `modules` is
    "modules": {                   // only the ids whose decision differs from the default, or that the operator locked
      "nav:deals": { "visible": false, "locked": false }
    }
  }
}
```

- Zod: `personaViewSchema` in `@crm/contracts` (`packages/contracts/src/persona/view.ts`), added to `sessionOrgSchema` as `.optional()`.
- **Absent means nothing is hidden.** The field is left out when the workspace has no persona row, when its persona or version cannot be found,
  when the stored definition no longer parses, and when the read fails. A client that does not know the field ignores it.
- It carries the decision, never the layers: no operator note, no reason, no source. `locked: true` is all a workspace may learn ("set by your
  account team").
- It never changes anything else in the response: the permissions, plan, landing and flags are computed exactly as before (an e2e test compares
  the session with and without overrides).

### How a module id is hidden

`isModuleHidden(view, id)` in `@crm/contracts`: `view.modules[id]` decides when present, otherwise `view.defaultVisibility`. A `null` view hides
nothing. The ids are the module ids of the spec (`nav:<id>`, `tile:<id>`, `section:contact.<id>`, `card:dashboard.<id>`, `action:contact.<id>`),
all listed in the catalog the web app generates.

## The resolver (`resolvePersona`, pure)

For one module id, first match wins (spec section 6):

1. an operator override with `locked: true` (beats the workspace and beats "Show more modules");
2. a workspace override;
3. "Show more modules", if the item would otherwise be hidden;
4. an operator override;
5. the persona's explicit entry, else the persona's default.

Silence at a layer falls through. Words resolve per noun and locale, `workspace > operator > persona > default`, and the persona layer is
all-or-nothing per locale. Entitlement (role, channel, app, plan feature) is applied after it, unchanged, and wins: the persona never unlocks
anything and no guard or controller reads it.

## Tables

| Table                       | Kind     | Access                                                                                                                                                                                            |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personas`                  | platform | everyone reads; only the privileged path writes; `generic` is a system persona and cannot be archived                                                                                             |
| `persona_versions`          | platform | everyone reads published and superseded versions, never a draft; only the privileged path writes; a published version is immutable (trigger)                                                      |
| `workspace_persona`         | tenant   | one row per workspace; the `operator_*` columns can only be written on the privileged path (trigger); `rev` is bumped by every update (trigger); no DELETE                                        |
| `workspace_persona_applied` | tenant   | the starter-pack ledger (phase 4); tenant isolation                                                                                                                                               |
| `workspace_persona_log`     | tenant   | append-only for every role; a workspace reads only its own non-operator rows and can only append rows as itself (`actor_id` is bound to the acting user, `created_at` is stamped by the database) |

Migrations: `20261230090000_persona_profiles_schema`, `20261230090100_persona_permissions`, `20261230090200_persona_generic_seed_backfill`.
Backfill: every existing workspace gets `generic`, solo mode off, onboarding marked done (idempotent, batched by organization id). New
workspaces get their row from `TenantDirectory.provisionOrganization`, in the same transaction as the organization.

## Permissions

Platform keys (seeded now, used by phases 2 and 3): `platform.persona.view` (Super Admin, Admin, Platform Support), `platform.persona.manage`,
`platform.persona.publish`, `platform.persona.override` (Super Admin, Admin). No tenant key: a workspace will edit its persona with the existing
`admin.settings.manage`.

## Privacy

No table here holds personal data: keys, versions, module ids, label overrides and the numeric ids of whoever made a change (no contact link, no
phone, email, address or free-text about a person). The personal-data registry test (`apps/api/test/integration/privacy/registry.spec.ts`)
finds none of its triggers in these tables, so nothing is registered.
