# Wiring map: persona profiles (business type)

A product extension, not a Reference feature (spec [persona-profiles.md](../../specs/persona-profiles.md), backlog BL-280; the
`product-extensions.md` row is added when phase 1 ships). API: [persona-profiles.md](../../api/persona-profiles.md). Update this file in the same
change as any new route, table, permission, mark or consumer. **Status: phase 0 (data, resolver, session field) plus the early, label-only slice of phase 5, "dynamic object naming" (BL-310: the workspace's own words for contact, appointment, deal and meeting). Nothing else reads the persona to change a screen yet.**

## API routes

| Method | Path                             | Permission              | Notes                                                                                                                                                                                                             |
| ------ | -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v2/auth/session`               | signed in               | gains the optional `org.persona` (`personaViewSchema`); absent = nothing hidden. BL-310 adds the optional `org.persona.nouns` (language -> noun -> forms, omitted when none). No other route changes              |
| GET    | `/v2/persona/vocabulary?locale=` | `admin.settings.manage` | BL-310: for each of contact, appointment, deal, meeting, what is shown in that language, which layer says so, the workspace's own words, and `rev` ([api/persona-vocabulary.md](../../api/persona-vocabulary.md)) |
| PUT    | `/v2/persona/vocabulary?locale=` | `admin.settings.manage` | BL-310: saves the workspace's own words per noun and language (409 on a stale `rev`); logs in `workspace_persona_log` (layer `workspace`) and audits; labels only                                                 |

Planned routes (not built): `GET /v2/persona/view`, `PATCH /v2/persona/settings` (`admin.settings.manage`; the vocabulary part of it is the two routes above), `POST /v2/persona/starter-pack/apply`,
`/v2/platform/personas/*`, `/v2/platform/workspaces/:id/persona/*` (spec 5.4, 7.1).

## Tables

`personas`, `persona_versions` (platform, no `org_id`), `workspace_persona`, `workspace_persona_applied`, `workspace_persona_log` (tenant, RLS
forced). Read: `PersonaRepository` (the workspace's own row joined to its persona's `current_version`, and one published definition). Written
by: the migration seed and backfill, `provisionWorkspacePersona` (organization provisioning), the dev seed (`packages/db/src/cli/seed.ts`).
BL-310 adds one writer: `PersonaVocabularyService.save` updates `workspace_persona.workspace_overrides.vocab` (and nothing else of that row), appends to `workspace_persona_log` and writes the audit trail, all in one transaction under the workspace's own RLS context (no migration).

## Producers (who creates a `workspace_persona` row)

| Path                                   | How                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Sign-up, install setup, social sign-up | `TenantDirectory.provisionOrganization` calls `provisionWorkspacePersona` in the same transaction |
| Existing workspaces                    | migration `20261230090200_persona_generic_seed_backfill` (idempotent; rerun fills any gap)        |
| Dev seed                               | `packages/db/src/cli/seed.ts`                                                                     |
| A workspace created some other way     | no row; the API reads that as `generic` (nothing hidden)                                          |

## Consumers

| Consumer                                                                                                                        | Status                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AccountService.sessionInfo` -> `org.persona`                                                                                   | built (phase 0)                                                                                                                                                                                |
| Menu (`resolveNav`), Settings tiles, Help center                                                                                | **phase 1** (`Capabilities.hidden`, skip a hidden id before `evaluateGates`)                                                                                                                   |
| Contact sections, quick tabs, action bar                                                                                        | **phase 1** (`visibleSections`, `quickTabs`, `ADD_TARGETS`)                                                                                                                                    |
| Home cards (ids in `dashboards-analytics-charts/home-cards.ts`)                                                                 | **phase 1** (`dashboard-screen.tsx` skips a hidden card)                                                                                                                                       |
| Command palette, search                                                                                                         | follow the resolved lists, phase 1                                                                                                                                                             |
| Business type tile in Settings, Show more modules                                                                               | **phase 1**                                                                                                                                                                                    |
| Platform console: personas, workspace Persona tab                                                                               | **phases 2 and 3**                                                                                                                                                                             |
| Onboarding, solo mode, starter pack, Home checklist                                                                             | **phase 4**                                                                                                                                                                                    |
| Vocabulary overlay (message rewrite of the bound surfaces)                                                                      | **built, BL-310**: `(app)/layout.tsx` -> `withVocabulary` (`features/persona-vocabulary/lib/`), not `i18n/request.ts`; surfaces in `lib/bindings.ts`; `useVocabulary()` for text built in code |
| Words we use (Settings, Business, `/workspace-words`)                                                                           | **built, BL-310**: tile `workspace-words`, gate `admin.settings.manage`                                                                                                                        |
| Operator Words grid, compile at publish, completeness meters, persona packs in 21 languages, bindings beyond the first surfaces | **phase 5** (what BL-310 does not do)                                                                                                                                                          |

## Module-id catalog

Generated by `apps/web/scripts/gen-registry.mjs` into `apps/web/src/features/_registry/module-catalog.generated.ts` (gitignored) from the nav,
Settings, planned, home-card (`features/<domain>/home-cards.ts`) and contact-page registries; `buildModuleCatalog` in `_registry/module-catalog.ts`.
A new screen adds its id with no second list. `module-catalog.test.ts` holds every id a seeded persona names to the catalog.

## Permissions

Platform: `platform.persona.view|manage|publish|override` (migration `20261230090100`). No tenant key (a workspace edits with the existing
`admin.settings.manage`, which avoids the `provision_workspace_presets` gap recorded for the Forms, Email templates and Companies keys).

## Rules that must keep holding

- A persona never grants or removes access. No guard, controller or `@RequirePermission` reads it. Entitlement is applied after it and wins.
- `generic` hides nothing; unknown or failed means "show everything". Golden checks: `module-catalog.test.ts` (web), `persona-session.e2e.spec.ts`
  and `persona-schema.spec.ts` (API).
- A hide in a published persona never reaches an existing workspace by default (spec 6.4): phase 2 and 3 must keep that.
