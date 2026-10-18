# Wiring map: persona profiles (business type)

A product extension, not a Reference feature (spec [persona-profiles.md](../../specs/persona-profiles.md), backlog BL-280; the
`product-extensions.md` row is added when phase 1 ships). API: [persona-profiles.md](../../api/persona-profiles.md). Update this file in the same
change as any new route, table, permission, mark or consumer. **Status: phases 0 and 1 (data, resolver, session field, and the web visibility runtime). The web hides modules for a persona other than
`generic`; no such persona exists until phase 2.**

## API routes

| Method | Path               | Permission | Notes                                                                                                             |
| ------ | ------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/v2/auth/session` | signed in  | gains the optional `org.persona` (`personaViewSchema`); absent = nothing hidden. No other route changes (phase 0) |

Planned routes (not built): `GET /v2/persona/view`, `PATCH /v2/persona/settings` (`admin.settings.manage`), `POST /v2/persona/starter-pack/apply`,
`/v2/platform/personas/*`, `/v2/platform/workspaces/:id/persona/*` (spec 5.4, 7.1).

## Tables

`personas`, `persona_versions` (platform, no `org_id`), `workspace_persona`, `workspace_persona_applied`, `workspace_persona_log` (tenant, RLS
forced). Read: `PersonaRepository` (the workspace's own row joined to its persona's `current_version`, and one published definition). Written
by: the migration seed and backfill, `provisionWorkspacePersona` (organization provisioning), the dev seed (`packages/db/src/cli/seed.ts`).
Nothing else writes them yet.

## Producers (who creates a `workspace_persona` row)

| Path                                   | How                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sign-up, install setup, social sign-up | `TenantDirectory.provisionOrganization` calls `provisionWorkspacePersona` in the same transaction |
| Existing workspaces                    | migration `20261230090200_persona_generic_seed_backfill` (idempotent; rerun fills any gap)        |
| Dev seed                               | `packages/db/src/cli/seed.ts`                                                                     |
| A workspace created some other way     | no row; the API reads that as `generic` (nothing hidden)                                          |

## Consumers

| Consumer                                                                                      | Status                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccountService.sessionInfo` -> `org.persona`                                                 | built (phase 0)                                                                                                                               |
| Menu (`resolveNav`), Settings tiles (`resolveSettings`)                                       | built (phase 1): `Capabilities.hidden`, `hiddenByPersona` before `evaluateGates`                                                              |
| Help center (`helpFor`, `/help` pages via `help-center/server.ts`)                            | built (phase 1): a guide whose documented screens are all hidden leaves                                                                       |
| Contact tabs, quick-view tabs, section list                                                   | built (phase 1): `pageTabs`, `quickTabs`, `visibleSections` take a `hidden` predicate; the section on screen is spared and a link still opens |
| Contact action bar, compose box tabs, Lead score chip and card, Tasks / Deals / Company cards | built (phase 1): `usePersonaVisibility().isActionHidden / isSectionHidden`                                                                    |
| Home cards (ids in `dashboards-analytics-charts/home-cards.ts`)                               | built (phase 1): `dashboard-screen.tsx` skips a hidden card                                                                                   |
| Command palette, search                                                                       | built (follows the resolved lists, phase 1)                                                                                                   |
| Business type tile in Settings, Show more modules                                             | **open** (needs `PATCH /v2/persona/settings`; the resolver already honours `showAll`)                                                         |
| Platform console: personas, workspace Persona tab                                             | **phases 2 and 3**                                                                                                                            |
| Onboarding, solo mode, starter pack, Home checklist                                           | **phase 4**                                                                                                                                   |
| Vocabulary overlay (`i18n/request.ts`)                                                        | **phase 5**                                                                                                                                   |

## Module-id catalog

Generated by `apps/web/scripts/gen-registry.mjs` into `apps/web/src/features/_registry/module-catalog.generated.ts` (gitignored) from the nav,
Settings, planned, home-card (`features/<domain>/home-cards.ts`) and contact-page registries; `buildModuleCatalog` in `_registry/module-catalog.ts`.
A new screen adds its id with no second list. `module-catalog.test.ts` holds every id a seeded persona names to the catalog.

## Permissions

Platform: `platform.persona.view|manage|publish|override` (migration `20261230090100`). No tenant key (a workspace edits with the existing
`admin.settings.manage`, which avoids the `provision_workspace_presets` gap recorded for the Forms, Email templates and Companies keys).

## Where the web reads it (phase 1)

`apps/web/src/features/persona/`: `visibility.ts` (pure), `persona-provider.tsx` (`PersonaProvider`, `usePersonaVisibility`), `server.ts`
(`personaHiddenIds`, the catalog-wide hidden set for `Capabilities.hidden`), `testing.ts` (test views built with the real `resolvePersona`),
`golden.test.ts`. Help guide: `persona/help/hidden-menu-items.md`. `AppGate` and `PlanPaywall` read the unfiltered registries, which is what keeps
a typed address of a hidden module working.

## Rules that must keep holding

- A persona never grants or removes access. No guard, controller or `@RequirePermission` reads it. Entitlement is applied after it and wins.
- `generic` hides nothing; unknown or failed means "show everything". Golden checks: `module-catalog.test.ts` (web), `persona-session.e2e.spec.ts`
  and `persona-schema.spec.ts` (API).
- A hide in a published persona never reaches an existing workspace by default (spec 6.4): phase 2 and 3 must keep that.
