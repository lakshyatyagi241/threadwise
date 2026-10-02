# Parity evidence: node-bridge-runtime (NODE)

WaDesk 1.7.0 vs this branch. Wiring map: [wiring/node-bridge-runtime.md](../wiring/node-bridge-runtime.md). Slice: WD-NODE-052 (settings and test),
WD-NODE-029 (admin pacing and the bridge's pull route), WD-NODE-002 (shared secret), WD-NODE-004 (health card consumer).

## Evidence

- `apps/api/test/e2e/node-bridge-runtime/node-bridge.e2e.spec.ts`: 18 scenarios over HTTP against real Postgres and Redis (access by role, save and
  version conflict, token never returned and stored encrypted, blank token keeps the stored one, installer port kept, all test-connection outcomes
  against a local stand-in bridge, pacing limits, the bridge's pull route and its wire format, fail-closed token guard, environment fallback, health card).
- `apps/web/src/features/node-bridge-runtime/lib/draft.test.ts`: 3 tests for the pacing form's limits.

## Checked by hand, side by side (2026-10-02)

Reference: Admin > Channel Settings (`/admin/settings/channel-setting`), ours: `/admin/node-bridge`, signed in locally on both.

- Same: block order (address, token, buttons, then pacing), labels, placeholders, hints, the "No token" / "Token set" badge, field order and limits of the
  pacing card, the "Pacing tip" text, the blank-token placeholder after saving, and the messages "Enter a valid Server URL (http:// or https://) first."
  and "Could not reach the bridge — check the URL and that the Node service is running."
- Ours, driven in the browser: save address and token, token field cleared with the "stored" placeholder, Test connection ("Bridge responded with HTTP 404."
  against a server without the route), Update timing, and the bridge route then returning exactly the saved pacing and 403 for a wrong or missing token.
- Differences: the address and pacing live on their own console page (WaDesk: top of the Channels hub and inside its providers form); the "Test connection"
  button has no icon; the pacing result is a toast instead of the inline "Saved · Ns gap active on bridge" line.

## Deliberate deviations

- **No push or refresh dance.** WaDesk mirrored the address and token into the Laravel `.env` (`EnvWriter`) and called the bridge's `refresh-settings`
  after every save; the bridge also cached settings for an hour. Here the platform store is the only copy and the bridge pulls the pacing, so a save
  needs no push (inventory port note for WD-NODE-052). The pacing toast reads "Sending timing updated." (WaDesk: "...and pushed to the bridge", plus the
  value the bridge reported holding).
- **Version check on save.** Both forms send the `rowVersion` they read; a stale one is a 409 instead of a silent last-write-wins (architecture rule).
- **Operator roles.** Every operator may read the panel; only a super admin saves or tests (WaDesk: any admin). The token authenticates every bridge call,
  so changing it is not for every role. Same precedent as the settings and AI keys panels.
- **Test connection does not follow redirects** (hardening); a blank address is refused with 422 before any call, as in WaDesk.
- **Problem+json on a bad token** (403) instead of WaDesk's mix of `{ok:false}`, `abort(403)` and 401 bodies. The bridge only looks at the status.
- **Token resolution** keeps WaDesk's order: saved token first, then the `NODE_WEBHOOK_TOKEN` environment value; the legacy `baileys_callback_token` key
  has no equivalent in a fresh install and is not read. WaDesk's `groups/sync` reading the env only (a quirk) is not reproduced.
- **Bridge address keeps the installer's port.** The installer stores `{serverUrl, port}`; saving a new address leaves `port` alone, or takes it from
  the URL (default 8888) when there was none.

## WD-NODE-028 media fetch (deliberate deviations)

- **Every redirect hop is checked** (WaDesk checked only the first, so an allowed host could redirect to an internal one). Security hardening.
- **The connection is pinned** to the address that was checked (WaDesk resolved the name twice).
- **Local file paths are refused** instead of read from an allow-list. A user-supplied value must never name a file on the server; media comes from a URL
  or from storage. WaDesk's internal callers that passed a path will pass a storage key or URL instead.
- **100 MB size cap** (WaDesk had none). WhatsApp's own document ceiling.
- Evidence: `apps/api/test/unit/node-bridge-runtime/safe-fetch.spec.ts` (49): every blocked range, redirect re-validation, DNS names, size cap, MIME.

## WD-NODE-030 to 036 scheduled messages (deliberate deviations)

- **The row is the schedule.** No in-memory cron, no boot sync: nothing is lost on a restart (WaDesk lost single and broadcast schedules and left their rows
  `scheduled` for ever). A job is only the next occurrence; a reconciliation pass queues a run again if its job finished or vanished.
- **`repeat_every` is honoured and the end date is inclusive** (the bridge ignored the first and stopped before the second); weekly walks to the next chosen
  weekday, monthly adds months without overflow, all in the schedule's own zone.
- **Late policy.** A one-off more than `SCHED_MAX_LATE_MINUTES` (60) late is failed with "Missed its time" instead of being left `scheduled`; a recurring one
  does not catch up and moves to its next future occurrence (as WaDesk did).
- **Per-recipient claim** (`processing`, new migration) so a retry after a crash never messages the same person twice (WaDesk sent again after a restart).
- **Every occurrence of a recurring schedule reaches the whole audience**; recipients are pending again after each run and totals are cumulative. WaDesk ignored
  later runs as "duplicate callbacks".
- **`paused` is a real status** with an automatic resume (daily cap: next midnight UTC; emergency halt: retried in 5 minutes). Laravel rejected `paused` and left
  the row `running`.
- **No callbacks.** The bridge's status posts and Laravel's duplicate guard are direct writes in the run's own transactions; a single scheduled message's outcome is
  now recorded (WaDesk never reported it). The unknown-interval 500 at registration becomes "the recurrence ends after its first run".
- **One run per number** across broadcasts and schedules (shared lease).

## Not verified (scheduler)

- Real transports: the engine is tested with a fake transport. The Cloud API text transport exists; Baileys and Twilio register their own when built.
- Not built here: wallet and plan metering of each message (WALLET, PLAN), the warmer's daily budget and hold (SCHED), re-resolving tags and groups at fire time
  (the SCHED screens write the audience), a run-history table (none in the schema), delivered and read states (WD-NODE-020 receipts), media from storage and
  templates (they fail the schedule up front with the reason).

## Not verified

- **Automated twin run.** `wadesk-playwright-parity` could not be used for this slice: its scripts list changed files without `git diff --relative`,
  so under this repo layout (git root one level above `crm-platform/`) they see zero feature files, and the operator console login needs MFA enrolment
  that the harness does not drive. Checked by hand instead (below). The twin spec is still to write.
- **Against the real Node bridge.** The reference runs without its bridge here, so "Test connection" was exercised against a stand-in that answers
  like `/api/refresh-settings` (200, 401, 403, 500, connection refused), not the bridge itself.
- Not built: bridge-side endpoints of WD-NODE-004 (`/`, `/health`, `current-settings`), the daily cap and jitter of WD-NODE-029, and every other NODE
  feature. They depend on the decision on the bridge's runtime shape (decision E).
