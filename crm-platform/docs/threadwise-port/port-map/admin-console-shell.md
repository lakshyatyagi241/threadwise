# Port map: admin-console-shell (ASHELL)

Spec: `inventory/admin-console-shell.md`. Evidence: `parity/admin-console-shell.md`.

## Where each P0 feature lands

| Feature                          | Where it lives                                                                                                | State                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 home router                  | `apps/web/src/app/page.tsx` + `homePathFor` (AUTH, TW-AUTH-011); landing decided server-side by `/v2/session` | Built by AUTH. Not rebuilt here.                                                                                                                                  |
| 002 console access gates         | `OperatorGuard` (operator pool, role, MFA, IP allowlist via `assertIpAllowed`) in `modules/auth`              | Built by AUTH. Allowlist is enforced on every `/v2/platform/*` call; the console pages sit behind the operator session. Support/Auditor decision stays with AUTH. |
| 003 console layout, 004 nav, 005 | `features/admin-console-shell` (rail, collapse, drawer, merged nav data)                                      | Built, committed.                                                                                                                                                 |
| 012 to 014 customer shell, menu  | `components/shell` and `features/_registry` (upstream icon rail, resolved from permissions)                   | Built upstream. Role-tier and plan-feature gating of entries waits on RBAC and PLAN catalogue keys.                                                               |
| 017 workspace switcher           | `features/auth-registration-security/account/workspace-switcher`                                              | Built by AUTH; WSP will extend.                                                                                                                                   |

## Built in this slice: 009 menu layout (top bar vs More)

- Storage: one platform setting `shell.nav_layout` = `{ bar: [...] }` in `platform_settings` (no new table, no migration; reached through `PlatformSettingsService`, the sanctioned door).
- Contracts: `packages/contracts/src/admin-console-shell/nav-layout.ts` (catalogue, one canonical default, `normalizeNavBar`, `resolveNavBar` incl. legacy flat list, request/response schemas).
- API (`modules/admin-console-shell`): `GET /v2/shell/nav-layout` (customers), `GET|PUT /v2/platform/shell/nav-layout`, `POST /v2/platform/shell/nav-layout/reset` (PUT and reset: super admin only). Writes are audited as `platform.shell.nav_layout_saved`.
- Web: `/admin/settings/menu-order` (editor with up/down/add/remove, More locked last), nav entry merged in `console-nav.ts`.
- Permission keys: none. Platform role (`super_admin`) via `OperatorRoles`, as the plans catalogue does.

## Not built yet, in build order

1. 026/027 banners and paywall sheet (needs PLAN trial and renewal state), 030 impersonation strip (WSP).
2. 006 header controls (health pill, bell: NOTIF), 007 warning toast variant.
3. 008 settings hub, 010/011/024 appearance tokens and shell mode (platform settings, SET), 016 to 023 sidebar strip, search palette, More page, quick access (`user_settings.quick_access`), tour.
4. 032 to 046 customer Settings hub tabs (workspace general, notifications, AI keys, security, export, delete workspace) depend on WSP, NOTIF, AIADM.

## Risks

- Customer shell does not yet read `/v2/shell/nav-layout`: the current upstream shell is the icon rail, not Reference's top bar, so the saved layout is stored and served but not yet consumed. Decide whether the rail honours it.
- `PlatformSettingsService.set` and the audit row are separate transactions (documented in the service).
