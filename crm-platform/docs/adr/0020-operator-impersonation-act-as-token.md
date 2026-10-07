# ADR-0020: Operator impersonation via act-as token

- **Status:** accepted
- **Date:** 2026-10-07

## Context

Reference's "Login as owner" (TW-WSP-032/033) puts an `impersonation_session_id` in the admin's browser session and overrides the
admin's `current_workspace_id` in memory. It has no expiry, no read-only mode, no limit on what the admin may do as the owner
(password, 2FA, API keys, billing), and its audit rows carry only the admin's own user id. Here an operator is a
`platform_operators` row (a different identity pool from workspace users), workspace data is isolated by RLS on `app.org_id`, and
every request already passes one global JWT guard that checks the platform epoch and a revocable session.

## Decision

An operator acts as a workspace owner through a distinct, short-lived access token. The operator's own session is never touched.

1. **Session row.** `impersonation_sessions` (platform-only, `privileged_only` policy like `platform_sessions`; reached through
   `PlatformStore` only) holds operator, workspace, the owner acted as, reason (8..500), `read_only`, `expires_at` (at most
   `IMPERSONATION_MAX_MINUTES` = 60), `ended_at` + `ended_by` (`operator`, `expiry`, `new_session`, `access_revoked`) and the
   one-time handoff code (hash only, 60 s, single use). A partial unique index allows one open session per operator; starting
   a new one ends the previous one in the same transaction.
2. **Start.** `POST /v2/platform/workspaces/:id/impersonate` needs the permission `platform.workspace.impersonate` AND the
   operator role `super_admin` (and therefore the MFA enrolment `OperatorGuard` already forces on super admins). The owner is
   `organizations.settings.ownerUserId`, else the oldest active holder of the admin preset; none, or a non-active one, is
   `WSP_IMPERSONATION_NO_OWNER`. The answer is a handoff URL, not a token.
3. **Redeem.** `POST /v2/auth/impersonation/redeem` (public, rate-limited, called server-to-server by the web app) flips
   `handoff_used_at` in one UPDATE (the single-use gate) and mints an access-only JWT: `typ user`, `sub` = owner, `org` = target,
   `sid` = the impersonation session uuid, `imp = { sid, oid, ro, exp }`, expiry = the session's end. No refresh token exists, so
   nothing can extend it; the web app stores it as the normal access cookie and no refresh cookie.
4. **Every request.** `JwtAuthGuard` sees `imp`, skips the owner's `auth_sessions` checks (idle timeout, session cap: those belong
   to the owner's real sessions and must not be touched) and instead reads the impersonation row (Redis tombstone first, then a
   5 s cached row read) and requires: open, unexpired, the operator still active and super admin, claims equal to the row.
   Stop writes the tombstone, so it takes effect on every instance at once. The request context carries `impersonation`.
5. **Rules.** A global `ImpersonationGuard` refuses every non-GET/HEAD/OPTIONS request in a read-only session
   (`WSP_IMPERSONATION_READ_ONLY`, except `POST /v2/auth/impersonation/stop`) and, in every session, the routes in
   `impersonation-rules.ts` (`WSP_IMPERSONATION_FORBIDDEN`): password, email change, 2FA, the owner's sessions, account deletion,
   workspace API keys and provider keys, switching workspace, and all of `/v2/platform/*`. The owner's own account gates
   (forced password change, 2FA enrolment, unverified email) do not apply to the operator.
6. **Audit with both actors.** `security_events` records the operator as actor and the owner in the payload for every event written
   in an act-as request; the start and stop events and a row in the workspace's own `audit_log` (actor `platform_operator`) are
   written in the same transaction as the session change. Every other `audit_log` row written in an act-as request is stamped by
   a trigger (`trg_audit_log_impersonation`) from two transaction-local settings that `DatabaseService.tx/txAs` set, so the ~20
   services that insert into `audit_log` directly cannot forget. Stop writes `platform.impersonation.stopped` with the duration and
   a count of audited changes by action.

## Consequences

- The operator cannot do anything a normal admin of that workspace could not undo, and the dangerous things (credentials, console)
  are not possible at all. Reference allowed all of it.
- A leaked act-as token is good for at most 60 minutes, only until stop, and cannot be refreshed; a leaked handoff URL is good for
  60 seconds once.
- One extra row read per act-as request (cached 5 s). Ordinary requests pay one property check.
- `audit_log` gets a BEFORE INSERT trigger: every audit insert reads two settings (`current_setting(..., true)`), a small cost on
  a hot, partitioned table.
- Realtime sockets opened with an act-as token follow the same session (the realtime auth already treats `imp` specially).
- Read-only is coarse: it is by HTTP method, so a POST used as a read (a search) is refused too.
- The start route lives in the WSP domain (`WorkspaceImpersonationModule`), the service in auth: `roles-permissions` imports auth,
  so a controller using `PlatformPermissionGuard` cannot sit inside auth without a module cycle.
- No step-up prompt beyond the operator's MFA: the repo has no step-up facility, and the session is limited, reasoned and audited
  instead. Expired sessions are closed lazily on the next check or the operator's next start; no sweep job yet.

## Alternatives considered

- **Mint the owner's normal session (Reference's effect).** The owner's sessions would show an unknown device, hit the session cap,
  stop revoking cleanly, and the audit trail could not tell operator from owner. Rejected.
- **A flag on the operator's session that switches workspace per request.** Operator tokens have `org 0` and the platform
  guards; every tenant code path assumes `typ user`. Teaching all of them an operator-in-workspace mode is far more invasive
  than one guard that reads one claim.
- **A stateless act-as JWT with no row.** Cannot be stopped or listed, and "revoke now" is the main property required.
- **Per-request actor stamping in each service.** Twenty writers, one forgotten is a silent hole; the trigger is mechanical.
- **Renewable token (refresh).** A refresh token for an impersonation is a standing credential for someone else's identity.
  The operator restarts from the console, which re-checks the permission.

## Revisit when

- the platform gets a step-up (re-enter password or code) facility: start should demand it;
- support needs finer control than "read-only or all" (per-area write allow-lists);
- impersonation volume makes the per-request row read visible (move the row state into Redis).
