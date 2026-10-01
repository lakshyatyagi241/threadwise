# ADR-0019: Server-side sessions, TOTP MFA and a platform operator pool

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** Lakshya Tyagi (lead), Vedant, Punya. Pending their approval.
- **Amends:** ADR-0002 (the list of sanctioned `privileged()` uses), ADR-0007 (refresh
  tokens stay stateless "for now"; no MFA; no pool for platform staff)

## Context

The WaDesk port (domain `auth`, 49 features) needs behaviour ADR-0007 deliberately
left out, and the base cannot express it:

- **Revocation.** "Sign out", "sign out other devices", "revoke every session",
  password change/reset killing old logins, an idle timeout and a concurrent-session
  cap all need the server to know which sessions exist. Refresh tokens are stateless
  JWTs, so none of them is possible today (ADR-0007 names this gap as known).
- **Second factor at login.** WaDesk's TOTP is enrol-only; its own docs promise a
  code "on every login". The port must enforce it.
- **Sign-up creates a tenant.** A visitor with no account creates an organization,
  its locked Admin role and its first user. Every one of those tables is
  `FORCE`-RLS'd by `org_id`, and there is no tenant context before the org exists.
- **Platform staff.** The Security Center, the social-login and captcha settings
  and the auth-page editor are platform-wide screens. There is no actor kind for
  "works for us, not for a customer" and no table for platform-wide settings.
- **Workspace switch** for a person who belongs to several organizations. Users are
  per-org rows (ADR-0007), so the same person is several unrelated rows.
- Existing facts: access TTL 15 minutes, refresh TTL 30 days, argon2id, the same
  "Invalid credentials" for every failure, `users` has `(org_id, email)` unique and no
  profile or security columns, Redis is already a dependency, the audit table is
  tenant-scoped (`org_id NOT NULL`), and a Clerk exchange exists (it creates a user in
  any org for any valid Clerk identity, which is a hole, see the Clerk note below).

## Decision

**Sessions are server-side, tokens stay JWTs.** Each login creates an `auth_sessions`
row (per tenant, RLS forced). The access JWT carries `sid`. The refresh JWT carries `sid`
and a `jti`; the row stores only a SHA-256 of the live `jti`. Refresh rotates the `jti`;
presenting an old `jti` revokes the whole session (token theft), except within a
30-second grace window that tolerates two tabs refreshing at once. Revoking a session
sets `revoked_at` and a Redis tombstone `auth:rev:<sid>` for the access-token TTL, so
the guard rejects the still-valid access token on the next request. Platform-wide
revocation bumps a global `auth:epoch` that every token carries in `ep`. Partner agents
and candidates keep stateless refresh; sessions apply to staff users and operators.
If Redis is unavailable the revocation check fails open and logs (bounded by the 15-minute
access TTL); the session row is still authoritative for refresh.

**MFA is TOTP (RFC 6238), enforced at login.** A correct password with MFA on returns
`mfa_required` and a 5-minute challenge token (Redis, single use, attempt-limited), never
a token pair. Secrets are AES-GCM encrypted with the existing `CryptoService`; recovery
codes are stored as argon2 hashes and shown once; the QR is rendered in the browser so the
secret never leaves for a third-party image service. An admin policy can require MFA for
everyone, for admins, or for owners; a covered, unenrolled user gets an
`MFA_ENROLMENT_REQUIRED` problem on every route except the enrolment, logout and session
routes.

**Platform operators are a fourth identity pool** (ADR-0007 gains a row): table
`platform_operators` (global, no `org_id`), token `typ: 'platform_operator'` with
`org: 0`, `@ActorKinds('platform_operator')` on every `/v2/platform/*` route, roles
`super_admin | support | auditor`, mandatory TOTP for `super_admin`. Operators have their
own sessions table and a separate login endpoint. This is the minimum of the "super-admin
actor kind" decision (D5); the admin-console modules extend it.

**Platform-wide data lives in three global tables behind forced RLS that only the
privileged flag satisfies:** `platform_settings` (key/value, secrets stored encrypted and
never returned), `platform_operators`/`platform_sessions`, and `security_events`. The
exception is `security_events`, which any transaction may append to (`INSERT ... WITH
CHECK (true)`) and only privileged transactions may read, so a failed login or a lockout is
recorded in the same transaction as the change without making that transaction
cross-tenant. Events that have no
tenant at all (an unknown workspace slug, an operator sign-in) are appended on the primary
handle for the same reason: the insert policy needs no tenant and no privilege, and the one
statement that does this lives in `AuthAuditService.recordStandalone`.

**Narrow privileged gateways.** `privileged()` is reachable from request handlers in
exactly two classes, and a unit test fails the build if a third file in the auth module
calls it (the worker-only maintenance job is the one listed exception):

1. `TenantDirectory`: each method is one fixed, parameterised statement or transaction.
   `findOrgBySlug`, `orgsForVerifiedEmail` and `slugExists` are the identity directory
   (login, workspace switch, "find my workspace"); `provisionOrganization` is sign-up, which
   inserts the organization, the locked Admin role with every capability key, an editable
   Agent role, the first user and its security and profile rows in one transaction (with a
   callback so the audit row and outbox event commit atomically); `forceResetAllUsers`,
   `revokeAllTenantSessions` and `userTotals` are the cross-tenant operator actions.
2. `PlatformStore`: the only door to the platform tables (`platform_settings`,
   `platform_operators`, `platform_sessions`, and the read side of `security_events`). Those
   tables are unreachable without the privileged flag, so they cannot be touched by a bug in
   tenant code.

Neither accepts SQL from a caller, and a test asserts there is no `sql.raw` in either. This
replaces ADR-0002's "none of them is reachable from an HTTP handler" with "each reachable
use is enumerated here".

**Identity across organizations is a verified email.** A person is "the same" in two
organizations only when both rows have `email_verified_at` set. Switching workspace
requires an authenticated session, issues a fresh session in the target organization, and
asks for no password because the current session already proves control of the verified
inbox. A user created by an admin and never verified is not switchable.

**Login still takes an organization slug** (ADR-0007), remembered by the web app. Email-only
entry is served by "find my workspace": a neutral response, with the slugs mailed only to
verified addresses. Social sign-in is scoped by the slug carried in the OAuth `state`; it
never creates a user in an existing organization (that would let any Google account join
any tenant). It can link an existing verified email, or, in sign-up mode, create a new
organization with the social identity as owner.

**The Clerk exchange no longer creates users.** `POST /auth/clerk/session` used to
auto-provision a user in any organization for any valid Clerk identity, which let anyone with a
Clerk account join any tenant. It now links an existing user (by `auth_subject`, then by email)
and opens a normal session; an identity with no row is refused. The web app does not use it.

## Consequences

### Positive

- Every revocation feature (logout, devices, revoke-all, reset-kills-sessions, idle
  timeout, session cap) is a row update, not a token trick.
- Refresh-token theft is detected (reuse of a rotated `jti`) instead of silently honoured
  for 30 days.
- MFA is actually enforced, and the secret never leaves our infrastructure.
- Platform screens get a real actor kind, real permissions and an audit stream, without
  borrowing a customer's admin role.
- The set of cross-tenant code in the auth path is small, named and testable.

### Negative

- Every authenticated request now costs one Redis read (revocation + epoch) on top of the
  JWT check; a Redis outage weakens revocation to the 15-minute access TTL.
- `privileged()` is now reachable from public, unauthenticated routes (sign-up,
  find-workspace). The statements are fixed and parameterised and each method is tested,
  but this is a larger blast radius than ADR-0002 promised; a bug in the gateway is a
  cross-tenant bug.
- Sessions table growth: one row per login, kept for 90 days after revocation so the
  new-device alert has history. Needs a prune job (not built here).
- The operator pool duplicates login, refresh, MFA and session code (ADR-0007 already
  accepts this per pool).
- The verified-email rule means an admin-invited colleague must verify before they can
  switch workspaces; and two people sharing one inbox share an identity.
- Closing the Clerk auto-provisioning hole changes that endpoint's behaviour: anyone relying on
  first-login auto-creation must be invited instead.
- Sign-up logic (org provisioning) lives in the auth module even though organizations
  belong to the workspace domain; it moves behind a `WorkspaceProvisioner` port when that
  domain lands.

### Neutral

- Access tokens gain `sid` and `ep` claims; old tokens without `sid` are rejected after
  deploy (one forced re-login).
- `users` is not altered. Credentials, MFA and profile data live in `user_security`,
  `user_profiles` and `user_avatars`, one row per user, created on demand.

## Alternatives considered

### Keep stateless refresh and add a revocation list

A deny-list of revoked `jti`s gives revoke-by-id but cannot answer "list this user's
devices", cannot enforce a concurrent-session cap or an idle timeout without scanning,
and still needs a table. Sessions rows answer all of these directly.

### Opaque session ids in a cookie (no JWT)

The API is consumed by the web proxy, partner portal, mobile app and public API with
bearer tokens (ADR-0008, ADR-0018). Replacing that is a larger change than this domain.

### A global `accounts` table (WaDesk's model: one user, many workspaces)

It makes switching trivial and email-only login possible, but it contradicts ADR-0007's
reasoning that pools and tenants stay structurally separate, needs a cross-tenant table the
app role can read, and is a migration of every `users` reference. The verified-email rule
gets the same user-visible result without that.

### Clerk for MFA, social login and sessions

ADR-0007 already rejected it for candidate-volume pricing and awkward multi-tenancy, and it
would leave password policy, lockout and sessions split across two systems.

### A separate database role for platform tables

Cleaner than a flag, but needs provisioning in every environment and a second connection
pool. The flag-based policy matches how the rest of the platform already works.

## Revisit when

An enterprise customer requires SAML/OIDC SSO (add the `IdentityProvider` seam from
ADR-0007 in front of the login service, the sessions model is unchanged); or Redis becomes
a hard availability dependency we cannot tolerate failing open; or the workspace domain
lands and organization provisioning moves out of the auth module; or operators exceed a few
dozen and need delegated administration.
