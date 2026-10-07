# ADR-0019: Workspace suspension is enforced at the account gate

- **Status:** accepted
- **Date:** 2026-10-07

## Context

An operator suspends a workspace from the platform inbox: a `frozen` (or `tos_violation`, `fraud`) flag is set and
`syncStatus()` writes `organizations.status = 'suspended'`. Until now nothing read that status except the invitation
flow, so a suspended workspace kept working: its members could sign in and use every route, its sockets stayed
connected, and its campaigns, scheduled messages and flows kept sending.

The platform already has one request-time place that decides "this person may not use the app right now": the global
`AccountGateGuard` (suspended user, unverified email, forced password change, missing MFA), which the web app maps to
lock screens. Outbound sends already pass one pre-send screen (`SendPolicyService`, bound to the providers through
`OUTBOUND_SEND_GUARD`) and every pipeline already understands `AUTH_SEND_HALTED` as "pause, retry later", not "fail".

## Decision

Suspension is enforced in the account gate, and the same one-call check is reused by the other entry points.

1. **HTTP.** `AccountGateGuard` refuses every authenticated request of a suspended workspace (actors `user`,
   `partner_agent`, `api_key`) with HTTP 403 and the stable code `WSP_ORG_SUSPENDED`. Platform operators are a different
   pool and are never gated. An operator's act-as (impersonation) session is let through so support can see what the
   owner sees; whether that session may write is the session's own read-only rule, not this gate's.
2. **Allow-list.** Open: `auth`, `me`, `i18n`, `shell`, `setup`, `health`, `support`. Read-only (GET/HEAD): `billing`,
   `plans`, `payments`, `account`. A route marked `@AllowWhileGated({ suspended: true })` is also open. Everything else is
   refused, so the owner can sign in, read the session, sign out, see the suspended screen and open a support ticket.
3. **One reader, cached.** `OrgSuspensionService.isSuspended(orgId)` reads `organizations.status` through a 5-second
   Redis cache. `PlatformInboxService.syncStatus()` calls `invalidate(orgId)` in the same code path that writes the status
   (immediately and once more 1.5 s later, because the write is not committed yet at the first call). The TTL bounds any
   miss. A read error fails open: a cache or database blip must not lock every workspace out; the suspension is durable
   and the next good read enforces it.
4. **Session flags.** `AccountGateService.stateFor()` adds the live organization status to `flags.suspended`, so
   `/auth/session` and sign-in tell the web app to route members to the existing `/suspended` screen, and the web error
   map sends `WSP_ORG_SUSPENDED` there as well.
5. **Realtime.** The socket handshake refuses members of a suspended workspace and the 30-second sweep that drops revoked
   sessions drops them too.
6. **Background work.** The send screen (`SendPolicyService.screen` / `screenBulk`, called by every provider send and by
   campaign, broadcast and scheduled starts) refuses a suspended workspace with `AUTH_SEND_HALTED`. That is deliberate:
   broadcasts, campaigns, scheduled runs and flows already treat that code as "pause and retry", so queued work resumes by
   itself on unsuspend instead of marking recipients failed. Inbound messages are still received and stored; the inbound
   listener hook (`InboundMessageHooks.run`) skips every listener and reports `consumed`, so no flow, keyword reply, AI
   agent or auto reply starts.

## Consequences

- One status column, one cached reader, one HTTP gate: a new route is covered without anyone remembering to guard it.
- A suspend or unsuspend reaches every instance within about 5 seconds, not instantly.
- Pause-instead-of-fail means a long suspension leaves queued sends waiting and re-checking; they do not burn retries,
  but they are not cleaned up either.
- A suspended workspace receives inbound messages and webhooks, so its inbox grows while nobody can read it. That is
  intended (no data loss) but means unsuspending shows a backlog.
- The allow-list is by first path segment, like the trial gate. A new top-level segment is closed by default, which is
  the safe direction, but the owner-facing ones (support, billing read) must be added here when they move.
- Background jobs that do not send (imports, exports, sweeps, billing roll-ups) keep running for a suspended workspace.

## Alternatives considered

- **A dedicated `SuspendedWorkspaceGuard` registered beside the others.** Rejected: a second global guard that
  duplicates the allow-list metadata and the lock-screen mapping, and the web app would need a second error family.
- **Revoke every session of the workspace on suspend.** Rejected: the owner could not sign in to see why or contact
  support, and revoking is not undone by an unsuspend.
- **Check the status inside every service or job.** Rejected: that is the "forgot one" failure this ADR exists to end.
- **No cache (database read per request).** Rejected: one extra read on every authenticated request.

## Revisit when

Operators need per-feature suspension (e.g. block sending but keep the inbox usable), or a workspace-status read path
shared with `TrialGateGuard` makes a single "workspace gate" worth extracting.
