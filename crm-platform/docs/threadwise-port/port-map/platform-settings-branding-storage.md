# Port map: platform-settings-branding-storage (SET)

Spec: `docs/threadwise-port/inventory/platform-settings-branding-storage.md`. Zone: `ownership.json` key `platform-settings-branding-storage`.

## Target

| Piece          | Where                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------- |
| API module     | `apps/api/src/modules/platform-settings-branding-storage/` (flat, one Nest module)          |
| Providers      | `apps/api/src/infra/providers/platform-settings-branding-storage/` (S3 probe, Pusher probe) |
| Contracts      | `packages/contracts/src/platform-settings-branding-storage/`                                |
| Web (operator) | `apps/web/src/app/(admin)/(platform-settings-branding-storage)/admin/settings/...`          |
| Web feature    | `apps/web/src/features/platform-settings-branding-storage/`, messages `messages/en/...json` |
| Tests          | `apps/api/test/{unit,e2e}/platform-settings-branding-storage/`                              |

## Store (TW-SET-001)

No new table. The AUTH domain already owns the platform-wide, privileged-only store `platform_settings`
(`key`, `value jsonb`, `is_secret`, `updated_by`, `updated_at`) and `PlatformSettingsService` in front of it. SET adopts it
and adds, in the auth zone, two additive methods (`inTx`, `seal`) so a SET write can be compare-and-set and can record its
audit event in the same transaction without a new `.privileged(` call.

Keys written by SET: `set.<group>` (JSON document, includes `_rv`, the optimistic-lock counter) and
`set.<group>.<field>` (secret, AES-GCM envelope via `CryptoService`). A group is edited as a whole page, so one counter per
group is the unit of conflict. Replaces Reference's per-key rows, string typing and double encryption scheme (one scheme now).

Groups: general (005, 006, 008, 012), branding (010, 013-015), site (022, 023), mail (024), seo (026), privacy (029),
analytics (032), customCode (034), pwa (035), storage (039), realtime (041).

## Endpoints (all `/v2/platform/settings/...`, operator console only)

| Endpoint               | Who          | Feature                    |
| ---------------------- | ------------ | -------------------------- |
| `GET  /groups`         | any operator | 003 hub                    |
| `GET  /groups/:group`  | any operator | read one group             |
| `PATCH /groups/:group` | super_admin  | write, rowVersion required |
| `GET  /export`         | super_admin  | 004                        |
| `POST /mail/test`      | super_admin  | 025                        |
| `POST /storage/test`   | super_admin  | 039                        |
| `POST /realtime/test`  | super_admin  | 041                        |

Public (no auth): `GET /v2/public/site-config` (027, 030, 033, 036 data), `GET /v2/public/manifest.webmanifest` (036),
`GET /v2/public/robots.txt` (028).

## Permissions

Reference's `platform.system.settings` is never enforced there. Here: reads for every operator role, writes for `super_admin`
(`OperatorRoles`). Operators are a separate identity pool; tenant RBAC `permission_defs` do not apply.

## Audit and events

Every write records `platform.settings.<group>_updated` (changed field names only, never values) in `security_events` in the
same transaction as the write. No outbox event: platform settings are not tenant events and the outbox is tenant-scoped.

## Runtime consumers

- Mail (024): `SmtpMailAdapter` asks a registered resolver for the saved SMTP settings on every send (5 s snapshot), falling
  back to `.env`. Seam edit in the auth providers zone.
- Maintenance (008): middleware inside the SET module, machine paths and operator routes always open.
- Public projection: one cached read model of brand, footer, SEO, cookie banner, analytics ids, PWA, defaults.

## Prerequisites from other domains

AUTH (operator guard, audit, settings store, registration policy which already owns TW-SET-007), PLAN (default plan id lives in
registration policy), ASHELL (admin nav), I18N and WSP (consumers of defaults; not built yet, shims not needed).

## Build order

1. contracts + errors, 2. store seam + registry + service + audit, 3. controller + hub + export, 4. mail runtime + tests of mail,
   storage and realtime, 5. public projection and maintenance, 6. web screens, 7. gates.

## Risks

Secrets rotate with `CREDENTIALS_ENCRYPTION_KEY` (undecryptable secret reads as "not set"). Object storage probe is hand-signed
SigV4 (no SDK dependency may be added); real uploads need the file module (not built). Pusher is probe-only: runtime realtime is
the existing Socket.IO gateway (TW-SET-042 is not ported, see inventory port notes).
