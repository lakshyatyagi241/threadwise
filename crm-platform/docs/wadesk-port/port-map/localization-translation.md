# Port map: localization-translation (I18N)

Spec: `inventory/localization-translation.md`. Zone: `ownership.json` key `localization-translation`.

## Modules

| Path                                                     | Role                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/localization-translation/`         | languages, providers admin, settings, usage, layered translator, detector, conversation translation                                              |
| `apps/api/src/infra/providers/localization-translation/` | `TranslationDriver` port, five drivers (MyMemory, Google GTX, LibreTranslate, DeepL, Google Cloud), SSRF endpoint guard, Redis breaker and cache |
| `packages/contracts/src/localization-translation/`       | locale rules (`resolveLocale`), language, provider, settings and usage schemas                                                                   |
| `apps/web/src/features/localization-translation/`        | operator pages (languages, providers, usage), workspace translation settings, `nav.ts`, `LocaleSwitcher`, `catalog-tools.ts`                     |

Round 2 additions in `apps/api/src/modules/localization-translation/`: `keyword-translation.ts` (pure rules and the 111-code target list),
`keyword-translation.service.ts` (fan-out, backfill, `resolveInbound`, `pickContent`), `keyword-rule-store.ts` and
`conversation-message-store.ts` (ports with Postgres shims over the auto-reply and inbox tables), `cli/translate-existing.ts`
(`pnpm --filter @crm/api auto-reply:translate-existing`). Migration `20261006090000_i18n_provider_copy.sql` puts WaDesk's provider descriptions on the seed rows.

## Tables (already ported under `schema/`; this domain adds one migration)

`languages`, `translation_providers`, `translation_usage` (partitioned ledger), workspace settings columns, `permission_defs` rows.
Migration `20261003090000_i18n_registry_seed.sql`: 21 languages, 5 providers, a partial unique index so at most one provider is
the default, and the two workspace permission keys. Seeds use `ON CONFLICT DO NOTHING` (WaDesk's upsert overwrote operator edits).

## Endpoints (all `/v2`)

| Route                                                                                                                    | Who                                           | Feature |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------- |
| `GET platform/i18n/languages`, `POST :id/toggle`, `POST :id/default`, `PATCH :id`, `DELETE :id`, `POST` (always refused) | operator (writes: super admin)                | 001-006 |
| `GET i18n/languages` (public), `GET/PATCH me/locale`                                                                     | guest / user                                  | 008-009 |
| `GET platform/i18n/translation-providers`, `PATCH :id`, `POST :id/toggle`, `POST :id/default`, `POST lockdown`           | operator                                      | 014-018 |
| `GET platform/i18n/translation-usage`                                                                                    | operator                                      | 029-030 |
| `GET/PATCH workspace/translation-settings`                                                                               | user, `i18n.translation_settings.read/update` | 035     |

## Permission keys

`i18n.translation_settings.read`, `i18n.translation_settings.update`. Operator endpoints use `OperatorGuard` / `OperatorRoles`.

## Web screens

`/admin/i18n/languages`, `/admin/i18n/providers`, `/admin/i18n/usage` (operator console, entries added to `OPERATOR_NAV`);
`/i18n/translation` (workspace, `nav.ts` entry in the settings group).

## Prerequisites from other domains

AUTH (operator pool, guards, `PlatformStore`/`TenantDirectory`), PLAN (`access_translation` plan gate), SET (system settings
reads), INBOX (calls `ConversationTranslationService` for WD-I18N-036/037/038), AUTOREPLY (WD-I18N-032/034), AI agent (039).

## Build order

1. Registry migration and contracts. 2. Languages and locale resolution. 3. Providers, drivers, router, lockdown.
2. Translator, detector, usage ledger. 5. Workspace settings and conversation translation. 6. Web screens.

## Risks

- Inbox, auto-reply and AI agent do not exist yet: 032-034 and 036-039 are exposed as a service (`ConversationTranslationService`)
  tested in isolation and are not wired to a message flow.
- Unofficial endpoints (MyMemory, Google GTX) can change without notice; the lockdown (WD-I18N-018) is the mitigation.
- Provider secrets are encrypted at rest and never returned; a blank field keeps the stored value.
