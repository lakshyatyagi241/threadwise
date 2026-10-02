# Parity evidence: channel-instagram (IG)

Reference 1.7.0 vs branch `punya/punyafix`. Inventory: [inventory/channel-instagram.md](../inventory/channel-instagram.md). API reference:
[docs/api/channel-instagram.md](../../api/channel-instagram.md). Build order: [plan/punya-plan.md](../plan/punya-plan.md) (I1 to I6).

## Evidence so far

Automated only; no screen yet, so the Playwright twin run against the running Reference has not been done. Reference's Instagram needs a
running Instaflow deployment with a shared secret, which this workspace does not have, so nothing was compared against a live engine.

- `apps/api/test/unit/channel-instagram/account-rules.spec.ts`: 11 tests, passing (handle, live state, Manage address, picker, profile, engine list reading).
- `apps/api/test/e2e/channel-instagram/instagram-accounts.e2e.spec.ts` (10 scenarios: hub and engine state, isolation, picker by email, link and relink on one row, an account only the person owns, refusing an unlisted account even with a username, engine off, permissions, connect ticket and its refusals, unlink keeping threads until the last account, other organizations untouched). Typechecked and linted; NOT RUN (no Docker or Postgres in this environment).
- Typecheck, lint on the new files and `pnpm arch:check` (0 errors) are clean. The addons unit tests (39) still pass after the handshake adapter moved onto the shared guarded request.

## Status of each feature

| Feature          | Status       | Notes                                                                                                                                                                       |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-IG-001        | backend-done | `GET /instagram/accounts`: mirror rows by username with the engine state (connected, brand, Manage address). Screen is I5.                                                  |
| TW-IG-002        | pending      | Dialog is I5; its three calls (available, link, connect start) are done.                                                                                                    |
| TW-IG-003        | backend-done | `GET /instagram/accounts/available`: the person's accounts matched by email, minus linked; empty with no email or the engine off.                                           |
| TW-IG-004        | backend-done | `POST /instagram/accounts`: link or refresh on one row, profile from the engine, followers kept unless given. See difference 1.                                             |
| TW-IG-005        | backend-done | `POST /instagram/connect/start`: ticket with the workspace and the hub as the return address. The return fallback is the hub reading `?ig_account=` (I5), not an API route. |
| TW-IG-006        | backend-done | `DELETE /instagram/accounts/:id`: removes the mirror; with the last one, deletes the Instagram threads and their messages in the same transaction.                          |
| TW-IG-007 to 014 | pending      | I2 to I4.                                                                                                                                                                   |
| TW-IG-015        | partial      | Permission keys `ig.accounts.read`, `ig.accounts.manage`, `ig.broadcasts.manage` (`20261016090000_ig_permissions.sql`). The plan flag is a shim (see below).                |
| TW-IG-016        | partial      | Port `InstagramBridge` with an HTTP adapter (accounts, connect start) on the shared guarded request; the other calls come with the steps that use them.                     |
| TW-IG-017 to 019 | blocked      | Auto-reply, flow runtime and templates belong to other domains.                                                                                                             |
| TW-IG-020        | blocked      | The native add-on is not in the reference.                                                                                                                                  |

## Differences from Reference

1. **Linking is limited to listed accounts.** Reference saved any engine account id that came with a username, so one tenant could link another's account and read its messages through the pull. The port links only an account the engine lists to this workspace or to this person (by email); anything else is 404 `IG_ACCOUNT_NOT_FOUND`. A security fix, no screen can reach the old behavior.
2. **The engine address is guarded.** Calls refuse private, loopback and link-local destinations (checked at connection time, so a rebinding name cannot slip through) and never follow redirects, unless `ADDONS_ALLOW_PRIVATE_ENGINE_URLS` is on. Reference had no guard.
3. **Unlink is one transaction and says how many threads went** (`purgedThreads`); Reference deleted them in a transaction too but returned only a flash.
4. **Messages get their own delete.** In this schema messages carry no foreign key to their thread, so unlink deletes them by name before the threads.

## Shims

- `InstagramPlanGate` (`_shims/open-gates.ts`): `access_instagram` is not in the plan catalogue; every check passes.

## Not verified

Everything against a live Instaflow deployment; the e2e scenarios above (no database here); the Channels page rows and the dialog (screens are I5).
