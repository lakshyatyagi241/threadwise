# Parity evidence: node-bridge-runtime (NODE)

Reference 1.7.0 vs this branch. Wiring map: [wiring/node-bridge-runtime.md](../wiring/node-bridge-runtime.md). Slice: TW-NODE-052 (settings and test),
TW-NODE-029 (admin pacing and the bridge's pull route), TW-NODE-002 (shared secret), TW-NODE-004 (health card consumer).

## Evidence

- `apps/api/test/e2e/node-bridge-runtime/node-bridge.e2e.spec.ts`: 18 scenarios over HTTP against real Postgres and Redis (access by role, save and
  version conflict, token never returned and stored encrypted, blank token keeps the stored one, installer port kept, all test-connection outcomes
  against a local stand-in bridge, pacing limits, the bridge's pull route and its wire format, fail-closed token guard, environment fallback, health card).
- `apps/web/src/features/node-bridge-runtime/lib/draft.test.ts`: 3 tests for the pacing form's limits.

## Deliberate deviations

- **No push or refresh dance.** Reference mirrored the address and token into the Laravel `.env` (`EnvWriter`) and called the bridge's `refresh-settings`
  after every save; the bridge also cached settings for an hour. Here the platform store is the only copy and the bridge pulls the pacing, so a save
  needs no push (inventory port note for TW-NODE-052). The pacing toast reads "Sending timing updated." (Reference: "...and pushed to the bridge", plus the
  value the bridge reported holding).
- **Version check on save.** Both forms send the `rowVersion` they read; a stale one is a 409 instead of a silent last-write-wins (architecture rule).
- **Operator roles.** Every operator may read the panel; only a super admin saves or tests (Reference: any admin). The token authenticates every bridge call,
  so changing it is not for every role. Same precedent as the settings and AI keys panels.
- **Test connection does not follow redirects** (hardening); a blank address is refused with 422 before any call, as in Reference.
- **Problem+json on a bad token** (403) instead of Reference's mix of `{ok:false}`, `abort(403)` and 401 bodies. The bridge only looks at the status.
- **Token resolution** keeps Reference's order: saved token first, then the `NODE_WEBHOOK_TOKEN` environment value; the legacy `baileys_callback_token` key
  has no equivalent in a fresh install and is not read. Reference's `groups/sync` reading the env only (a quirk) is not reproduced.
- **Bridge address keeps the installer's port.** The installer stores `{serverUrl, port}`; saving a new address leaves `port` alone, or takes it from
  the URL (default 8888) when there was none.

## Not verified

- **Side by side in a browser.** The reference screen is the top of Admin > Channel Settings (`/admin/settings/channel-setting`); ours is its own page
  at `/admin/node-bridge`. A Playwright run of both is still to do.
- **Against the real Node bridge.** The reference runs without its bridge here, so "Test connection" was exercised against a stand-in that answers
  like `/api/refresh-settings` (200, 401, 403, 500, connection refused), not the bridge itself.
- Not built: bridge-side endpoints of TW-NODE-004 (`/`, `/health`, `current-settings`), the daily cap and jitter of TW-NODE-029, and every other NODE
  feature. They depend on the decision on the bridge's runtime shape (decision E).
