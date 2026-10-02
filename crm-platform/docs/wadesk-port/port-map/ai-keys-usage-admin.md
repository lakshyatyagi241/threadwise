# Port map: ai-keys-usage-admin (AIADM)

Spec: `docs/wadesk-port/inventory/ai-keys-usage-admin.md`. Zone: `ownership.json` entry `ai-keys-usage-admin`.

## Target modules

| Piece      | Where                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API module | `apps/api/src/modules/ai-keys-usage-admin/` (`AiKeysUsageAdminModule`, exports `AiKeyResolver`, `AiTokenMeter`, `AiModelsService` through its barrel for AI callers in other domains) |
| Contracts  | `packages/contracts/src/ai-keys-usage-admin/` (catalog of the 22 providers, platform keys, workspace keys, usage) plus two error codes                                                |
| Web        | `apps/web/src/features/ai-keys-usage-admin/`, routes in `(admin)/(ai-keys-usage-admin)` and `(app)/(ai-keys-usage-admin)`, `messages/en/ai-keys-usage-admin.json`                     |

## Tables (already in the schema port; this domain adds one migration)

- `admin_ai_keys` (platform scope, operator-only RLS under the privileged flag): one row per provider, key stored encrypted, `key_last4` added.
- `ai_provider_keys` (tenant scope, forced RLS): a workspace's own key (BYOK), `key_last4` added.
- `ai_token_usage` (tenant scope, forced RLS): the ledger; CHECKs on payer and non-negative counts added.
- Migration `20261002110000_aiadm_provider_registry.sql`: seeds the 22 provider rows once (no GET that writes, no sort-order ties), adds the columns and CHECKs and the capability keys.

## Endpoints (all `/v2`)

| Surface                  | Endpoints                                                                                          | Guard                          |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| Operator keys            | `GET/PATCH platform/ai-keys`, `PATCH platform/ai-keys/:id/active`                                  | `OperatorGuard`, `super_admin` |
| Operator dashboard       | `GET platform/ai-dashboard?window=`                                                                | `OperatorGuard`, `super_admin` |
| Workspace keys           | `GET ai/provider-keys`, `PUT ai/provider-keys/:provider`, `PATCH .../:id/active`, `DELETE .../:id` | tenant auth + capability keys  |
| Workspace usage / models | `GET ai/usage?window=`, `GET ai/models`                                                            | tenant auth + capability keys  |

Optimistic locking (`rowVersion`), audit and outbox in the same transaction as each write; no id leaves the system except uuid. Platform-wide reads and writes go only through the auth module's `PlatformStore` (no `.privileged(` in this module, enforced by a unit test).

## Web screens

Operator console: AI provider keys (`/admin/api-keys`, legacy `/admin/ai-keys` redirects), AI dashboard (`/admin/ai-dashboard`). Customer shell: AI keys (`/ai-keys`), AI usage (`/ai-usage`). Nav: two operator items (seam edit in the auth operator menu) and the customer nav registry entry.

## Prerequisites from other domains

AUTH (operator guards, `PlatformStore`), PLAN (`allow_byok_ai_keys`, `ai_token_limit_monthly`, read through the resolver's plan lookup), web shell. Callers that must use `AiKeyResolver` and `AiTokenMeter` (AIAG, AICRM, CALL, FLB, TPL, CAMP) are not built yet; the services are ready for them.

## Build order

Migration and schema, contracts, vault and rules (pure logic), platform keys, resolver, meter, usage queries, workspace keys, controllers, web screens, tests.

## Risks and decisions

- The monthly token cap is displayed, not enforced (as in WaDesk, WD-AIADM-018 stays dead code; enforcement needs a product decision).
- Voice and Node-bridge usage is not in the ledger (WaDesk parity; needs CALL/NODE).
- Extras that WaDesk saved but never read (organization, project id, voice id) are not ported.
- Audit for key changes: WaDesk wrote none; this port audits every key change (deliberate fix).
