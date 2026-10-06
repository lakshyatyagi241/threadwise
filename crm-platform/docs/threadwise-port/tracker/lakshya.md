# Reference port tracker — Lakshya Tyagi

Only Lakshya Tyagi edits this file (`threadwise-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/threadwise-parity-tracker/scripts/tracker.py set TW-XXX-001 in-progress --pr 123`

## auth-registration-security (auth)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-AUTH-001 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-002 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-003 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-004 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-005 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-006 | frontend-done |  | page + API done; real senders (Meta Cloud API, Twilio, Node bridge) behind OTP_SENDER_PORT via an auth-zone sender registry; verified against local stubs only (no real Meta/Twilio credentials) |
| TW-AUTH-007 | frontend-done |  | senders, template create/refresh (+ worker poll every 5 min), test send done in the auth zone; Meta calls verified against local stubs only; the WABA template domain can replace the template client later |
| TW-AUTH-008 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc); sign-up now assigns the default plan + trial in the same transaction (PLAN resolver) |
| TW-AUTH-009 | frontend-done |  | real plan cards from GET /v2/plans (price, offer, period, messages, 3 chips, popular, current); free = continue, custom = /support, paid = /account/plans placeholder (checkout waits for billing); browser-verified |
| TW-AUTH-010 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-011 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-012 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-013 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-014 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-015 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-016 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-017 | backend-done |  | login side effects are server-side only; covered by e2e (no screen) |
| TW-AUTH-018 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| TW-AUTH-019 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-020 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-021 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-022 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-023 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-024 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-025 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-026 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-027 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-028 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-029 | frontend-done |  | branding gate is real: 422 PLAN_FEATURE_LOCKED without remove_branding, canEdit from the plan, locked state with upgrade link; browser-verified locked and editable |
| TW-AUTH-030 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-031 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-032 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-033 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-034 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-035 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-036 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-037 | frontend-done |  | backend + web; apiRateLimitPerMinute is a platform ceiling over each API key's limit, audit retention prunes audit_log + security_events daily; browser-verified |
| TW-AUTH-038 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-039 | frontend-done |  | backend + web; webhook rotation reports the real count through WebhookSecretRegistry (0 until the integrations domain registers a rotator) |
| TW-AUTH-040 | frontend-done |  | operator UI + service; enforced at every WhatsApp provider send (OUTBOUND_SEND_GUARD), re-checked at send time; e2e proves halt and resume |
| TW-AUTH-041 | frontend-done |  | operator UI + SendPolicyService; enforced at the provider boundary (content, per-minute and per-day caps, bulk skips rate caps); e2e covers enforce mode and the audit rows |
| TW-AUTH-042 | wontfix |  | dead code in Reference (mask_phone returns the number unchanged); do not port |
| TW-AUTH-043 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| TW-AUTH-044 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| TW-AUTH-045 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| TW-AUTH-046 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| TW-AUTH-047 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| TW-AUTH-048 | wontfix |  | unrouted legacy controller; its better rules (remember toggle, password max age, safe next path) are implemented in 001/035 |
| TW-AUTH-049 | wontfix |  | no installer in the target |

## workspaces-teams-tenancy (wsp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-WSP-001 | todo |  |  |
| TW-WSP-002 | todo |  |  |
| TW-WSP-003 | todo |  |  |
| TW-WSP-004 | todo |  |  |
| TW-WSP-005 | done |  | built by AUTH-010 |
| TW-WSP-006 | todo |  |  |
| TW-WSP-007 | todo |  |  |
| TW-WSP-008 | todo |  |  |
| TW-WSP-009 | todo |  |  |
| TW-WSP-010 | todo |  |  |
| TW-WSP-011 | todo |  |  |
| TW-WSP-012 | done |  | kernel tenant context |
| TW-WSP-013 | todo |  |  |
| TW-WSP-014 | todo |  |  |
| TW-WSP-015 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-016 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-017 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-018 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-019 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-020 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-021 | wontfix |  | invite token acceptance replaces login-time activation (port note) |
| TW-WSP-022 | frontend-done |  | teams CRUD done; device scoping picker blocked until channels (devices) domain exists |
| TW-WSP-023 | todo |  |  |
| TW-WSP-024 | todo |  |  |
| TW-WSP-025 | todo |  |  |
| TW-WSP-026 | todo |  |  |
| TW-WSP-027 | todo |  |  |
| TW-WSP-028 | todo |  |  |
| TW-WSP-029 | todo |  |  |
| TW-WSP-030 | todo |  |  |
| TW-WSP-031 | todo |  |  |
| TW-WSP-032 | todo |  |  |
| TW-WSP-033 | todo |  |  |
| TW-WSP-034 | wontfix |  | platform staff are platform_operators, outside tenant orgs |
| TW-WSP-035 | todo |  |  |
| TW-WSP-036 | todo |  |  |
| TW-WSP-037 | todo |  |  |
| TW-WSP-038 | todo |  |  |
| TW-WSP-039 | todo |  |  |
| TW-WSP-040 | todo |  |  |
| TW-WSP-041 | todo |  |  |
| TW-WSP-042 | todo |  |  |
| TW-WSP-043 | todo |  |  |
| TW-WSP-044 | todo |  |  |
| TW-WSP-045 | todo |  |  |
| TW-WSP-046 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| TW-WSP-047 | done |  | built by AUTH; members contract carries invitedAt/joinedAt |

## roles-permissions (rbac)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-RBAC-001 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-002 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-003 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-004 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| TW-RBAC-005 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-006 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-007 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-008 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-009 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-010 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-011 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-012 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-013 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-014 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-015 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-016 | wontfix |  | operator identity pool replaces role-name staff recognition (D-RBAC-04) |
| TW-RBAC-017 | wontfix |  | legacy users.role not ported (D-RBAC-04); plan/billing bypass is a PLAN/BILL flag |
| TW-RBAC-018 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-019 | blocked |  | guard + keys ready; waiting on platform inbox routes (ASHELL/SUPP) |
| TW-RBAC-020 | blocked |  | waiting on TW-WSP impersonation tokens |
| TW-RBAC-021 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-022 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running Reference |
| TW-RBAC-023 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| TW-RBAC-024 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| TW-RBAC-025 | blocked |  | each domain adopts its own permission keys; see wiring map |
| TW-RBAC-026 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| TW-RBAC-027 | backend-done |  | org.member.invite / role_assign enforced on staff-user create and role change and on the WSP members screen (invite, resend, remove, reset, role change) |
| TW-RBAC-028 | blocked |  | keys registered with the Reference matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| TW-RBAC-029 | blocked |  | keys registered with the Reference matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| TW-RBAC-030 | blocked |  | keys registered with the Reference matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| TW-RBAC-031 | blocked |  | keys registered with the Reference matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| TW-RBAC-032 | blocked |  | keys registered with the Reference matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| TW-RBAC-033 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| TW-RBAC-034 | blocked |  | keys org.owner_settings.manage / org.delete registered; SET, TCHAT, CHK adopt them |
| TW-RBAC-035 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| TW-RBAC-036 | blocked |  | one guard for all actor kinds already; API-key scopes belong to the public API domain |
| TW-RBAC-037 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |

## admin-console-shell (ashell)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-ASHELL-001 | todo |  |  |
| TW-ASHELL-002 | todo |  |  |
| TW-ASHELL-003 | todo |  |  |
| TW-ASHELL-004 | todo |  |  |
| TW-ASHELL-005 | todo |  |  |
| TW-ASHELL-006 | todo |  |  |
| TW-ASHELL-007 | todo |  |  |
| TW-ASHELL-008 | todo |  |  |
| TW-ASHELL-009 | todo |  |  |
| TW-ASHELL-010 | todo |  |  |
| TW-ASHELL-011 | todo |  |  |
| TW-ASHELL-012 | todo |  |  |
| TW-ASHELL-013 | todo |  |  |
| TW-ASHELL-014 | todo |  |  |
| TW-ASHELL-015 | todo |  |  |
| TW-ASHELL-016 | todo |  |  |
| TW-ASHELL-017 | todo |  |  |
| TW-ASHELL-018 | todo |  |  |
| TW-ASHELL-019 | todo |  |  |
| TW-ASHELL-020 | todo |  |  |
| TW-ASHELL-021 | todo |  |  |
| TW-ASHELL-022 | todo |  |  |
| TW-ASHELL-023 | todo |  |  |
| TW-ASHELL-024 | todo |  |  |
| TW-ASHELL-025 | todo |  |  |
| TW-ASHELL-026 | todo |  |  |
| TW-ASHELL-027 | todo |  |  |
| TW-ASHELL-028 | todo |  |  |
| TW-ASHELL-029 | todo |  |  |
| TW-ASHELL-030 | todo |  |  |
| TW-ASHELL-031 | todo |  |  |
| TW-ASHELL-032 | todo |  |  |
| TW-ASHELL-033 | todo |  |  |
| TW-ASHELL-034 | todo |  |  |
| TW-ASHELL-035 | todo |  |  |
| TW-ASHELL-036 | todo |  |  |
| TW-ASHELL-037 | todo |  |  |
| TW-ASHELL-038 | todo |  |  |
| TW-ASHELL-039 | todo |  |  |
| TW-ASHELL-040 | todo |  |  |
| TW-ASHELL-041 | todo |  |  |
| TW-ASHELL-042 | todo |  |  |
| TW-ASHELL-043 | todo |  |  |
| TW-ASHELL-044 | todo |  |  |
| TW-ASHELL-045 | todo |  |  |
| TW-ASHELL-046 | todo |  |  |
| TW-ASHELL-047 | todo |  |  |

## platform-settings-branding-storage (set)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-SET-001 | todo |  |  |
| TW-SET-002 | todo |  |  |
| TW-SET-003 | todo |  |  |
| TW-SET-004 | todo |  |  |
| TW-SET-005 | todo |  |  |
| TW-SET-006 | todo |  |  |
| TW-SET-007 | todo |  |  |
| TW-SET-008 | todo |  |  |
| TW-SET-009 | todo |  |  |
| TW-SET-010 | todo |  |  |
| TW-SET-011 | todo |  |  |
| TW-SET-012 | todo |  |  |
| TW-SET-013 | todo |  |  |
| TW-SET-014 | todo |  |  |
| TW-SET-015 | todo |  |  |
| TW-SET-016 | todo |  |  |
| TW-SET-017 | todo |  |  |
| TW-SET-018 | todo |  |  |
| TW-SET-019 | todo |  |  |
| TW-SET-020 | todo |  |  |
| TW-SET-021 | todo |  |  |
| TW-SET-022 | todo |  |  |
| TW-SET-023 | todo |  |  |
| TW-SET-024 | todo |  |  |
| TW-SET-025 | todo |  |  |
| TW-SET-026 | todo |  |  |
| TW-SET-027 | todo |  |  |
| TW-SET-028 | todo |  |  |
| TW-SET-029 | todo |  |  |
| TW-SET-030 | todo |  |  |
| TW-SET-031 | todo |  |  |
| TW-SET-032 | todo |  |  |
| TW-SET-033 | todo |  |  |
| TW-SET-034 | todo |  |  |
| TW-SET-035 | todo |  |  |
| TW-SET-036 | todo |  |  |
| TW-SET-037 | todo |  |  |
| TW-SET-038 | todo |  |  |
| TW-SET-039 | todo |  |  |
| TW-SET-040 | todo |  |  |
| TW-SET-041 | todo |  |  |
| TW-SET-042 | todo |  |  |
| TW-SET-043 | todo |  |  |
| TW-SET-044 | todo |  |  |
| TW-SET-045 | todo |  |  |
| TW-SET-046 | todo |  |  |

## localization-translation (i18n)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-I18N-001 | todo |  |  |
| TW-I18N-002 | todo |  |  |
| TW-I18N-003 | todo |  |  |
| TW-I18N-004 | todo |  |  |
| TW-I18N-005 | todo |  |  |
| TW-I18N-006 | todo |  |  |
| TW-I18N-007 | todo |  |  |
| TW-I18N-008 | todo |  |  |
| TW-I18N-009 | todo |  |  |
| TW-I18N-010 | todo |  |  |
| TW-I18N-011 | todo |  |  |
| TW-I18N-012 | todo |  |  |
| TW-I18N-013 | todo |  |  |
| TW-I18N-014 | todo |  |  |
| TW-I18N-015 | todo |  |  |
| TW-I18N-016 | todo |  |  |
| TW-I18N-017 | todo |  |  |
| TW-I18N-018 | todo |  |  |
| TW-I18N-019 | todo |  |  |
| TW-I18N-020 | todo |  |  |
| TW-I18N-021 | todo |  |  |
| TW-I18N-022 | todo |  |  |
| TW-I18N-023 | todo |  |  |
| TW-I18N-024 | todo |  |  |
| TW-I18N-025 | todo |  |  |
| TW-I18N-026 | todo |  |  |
| TW-I18N-027 | todo |  |  |
| TW-I18N-028 | todo |  |  |
| TW-I18N-029 | todo |  |  |
| TW-I18N-030 | todo |  |  |
| TW-I18N-031 | todo |  |  |
| TW-I18N-032 | todo |  |  |
| TW-I18N-033 | todo |  |  |
| TW-I18N-034 | todo |  |  |
| TW-I18N-035 | todo |  |  |
| TW-I18N-036 | todo |  |  |
| TW-I18N-037 | todo |  |  |
| TW-I18N-038 | todo |  |  |
| TW-I18N-039 | todo |  |  |

## platform-infrastructure (infra)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-INFRA-001 | todo |  |  |
| TW-INFRA-002 | todo |  |  |
| TW-INFRA-003 | todo |  |  |
| TW-INFRA-004 | todo |  |  |
| TW-INFRA-005 | todo |  |  |
| TW-INFRA-006 | todo |  |  |
| TW-INFRA-007 | todo |  |  |
| TW-INFRA-008 | todo |  |  |
| TW-INFRA-009 | todo |  |  |
| TW-INFRA-010 | todo |  |  |
| TW-INFRA-011 | todo |  |  |
| TW-INFRA-012 | todo |  |  |
| TW-INFRA-013 | todo |  |  |
| TW-INFRA-014 | todo |  |  |
| TW-INFRA-015 | todo |  |  |
| TW-INFRA-016 | todo |  |  |
| TW-INFRA-017 | todo |  |  |
| TW-INFRA-018 | todo |  |  |
| TW-INFRA-019 | todo |  |  |
| TW-INFRA-020 | todo |  |  |
| TW-INFRA-021 | todo |  |  |
| TW-INFRA-022 | todo |  |  |
| TW-INFRA-023 | todo |  |  |
| TW-INFRA-024 | todo |  |  |
| TW-INFRA-025 | todo |  |  |
| TW-INFRA-026 | todo |  |  |
| TW-INFRA-027 | todo |  |  |
| TW-INFRA-028 | todo |  |  |
| TW-INFRA-029 | todo |  |  |
| TW-INFRA-030 | todo |  |  |
| TW-INFRA-031 | todo |  |  |
| TW-INFRA-032 | todo |  |  |
| TW-INFRA-033 | todo |  |  |
| TW-INFRA-034 | todo |  |  |
| TW-INFRA-035 | todo |  |  |
| TW-INFRA-036 | todo |  |  |
| TW-INFRA-037 | todo |  |  |
| TW-INFRA-038 | todo |  |  |
| TW-INFRA-039 | todo |  |  |
| TW-INFRA-040 | todo |  |  |
| TW-INFRA-041 | todo |  |  |
| TW-INFRA-042 | todo |  |  |
| TW-INFRA-043 | todo |  |  |
| TW-INFRA-044 | todo |  |  |
| TW-INFRA-045 | todo |  |  |
| TW-INFRA-046 | todo |  |  |
| TW-INFRA-047 | todo |  |  |
| TW-INFRA-048 | todo |  |  |
| TW-INFRA-049 | todo |  |  |
| TW-INFRA-050 | todo |  |  |
| TW-INFRA-051 | todo |  |  |
| TW-INFRA-052 | todo |  |  |
| TW-INFRA-053 | todo |  |  |
| TW-INFRA-054 | todo |  |  |
| TW-INFRA-055 | todo |  |  |
| TW-INFRA-056 | todo |  |  |
| TW-INFRA-057 | todo |  |  |
| TW-INFRA-058 | todo |  |  |
| TW-INFRA-059 | todo |  |  |
| TW-INFRA-060 | todo |  |  |
| TW-INFRA-061 | todo |  |  |
| TW-INFRA-062 | todo |  |  |

## install-update-licensing (inst)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-INST-001 | todo |  |  |
| TW-INST-002 | todo |  |  |
| TW-INST-003 | todo |  |  |
| TW-INST-004 | todo |  |  |
| TW-INST-005 | todo |  |  |
| TW-INST-006 | todo |  |  |
| TW-INST-007 | todo |  |  |
| TW-INST-008 | todo |  |  |
| TW-INST-009 | todo |  |  |
| TW-INST-010 | todo |  |  |
| TW-INST-011 | todo |  |  |
| TW-INST-012 | todo |  |  |
| TW-INST-013 | todo |  |  |
| TW-INST-014 | todo |  |  |
| TW-INST-015 | todo |  |  |
| TW-INST-016 | todo |  |  |
| TW-INST-017 | todo |  |  |
| TW-INST-018 | todo |  |  |
| TW-INST-019 | todo |  |  |
| TW-INST-020 | todo |  |  |
| TW-INST-021 | todo |  |  |
| TW-INST-022 | todo |  |  |
| TW-INST-023 | todo |  |  |
| TW-INST-024 | todo |  |  |
| TW-INST-025 | todo |  |  |
| TW-INST-026 | todo |  |  |
| TW-INST-027 | todo |  |  |
| TW-INST-028 | todo |  |  |
| TW-INST-029 | todo |  |  |

## plans-subscriptions-trials (plan)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-PLAN-001 | in-progress |  | operator /admin/plans: KPI strip (total/active/free/paid), table + cards, in-use counts; no MRR/subscribers/analytics link |
| TW-PLAN-002 | in-progress |  | single modal with 4 grouped sections (identity, pricing, limits, features) instead of a 4-step wizard; no live review panel |
| TW-PLAN-003 | done |  | create/update validation shared via @crm/contracts (checkPlanRules), slug rules, one default; slug immutable; audited |
| TW-PLAN-004 | done |  | PATCH /v2/platform/plans/:id/active; refuses to deactivate the signup default |
| TW-PLAN-005 | done |  | DELETE refuses any org on the plan (PLAN_IN_USE) and the signup default |
| TW-PLAN-006 | done |  | 15 limit keys incl. total_campaigns and api_rate_limit_per_minute; usage meters, quota ledger, per-workspace overrides, assertCanAdd call sites; every cap editable per plan and per workspace |
| TW-PLAN-007 | done |  | 14 feature flags; enforced in context and by the route gate @RequirePlanFeature (analytics); entitlement keys feed the paywall, lock and crown; editable per plan and per workspace |
| TW-PLAN-008 | in-progress |  | 4-step default resolver + trial rule done and tested; registration default is a dropdown of active plans; billing_plan_scope not built |
| TW-PLAN-009 | done |  | operator CRUD /platform/pricing-faqs + /admin/pricing-faqs, readers: in-app, public; audited; partial update |
| TW-PLAN-010 | done |  | /pricing site route over GET /public/cms/pricing (+limits/features) and the FAQ table; yearly switch |
| TW-PLAN-011 | done |  | picker complete: validity banner, yearly switch, cards (server-decided action), add-ons, compare table, FAQ; admins may downgrade (intended) |
| TW-PLAN-012 | done |  | POST /v2/billing/subscription/cancel + driver cancelSubscription (Stripe, Razorpay, PayPal); buttons on picker and top bar while a subscription exists. Rows are written by PAYGW recurring checkout (not built) |
| TW-PLAN-013 | done |  | trial/renewal bar from GET /v2/billing/status, mounted in the app shell; renewal bar has no Cancel auto-renew (TW-PLAN-012 blocked); renew link goes to plans (Reference quirk fixed deliberately: no broken route guard) |
| TW-PLAN-014 | done |  | GET /v2/billing/usage + /account/usage pane: 11 meters from the same counts enforcement uses, calendar-month reset, features unlocked; no wallet tiles (WALLET domain) |
| TW-PLAN-015 | done |  | global TrialGateGuard after auth: 402 PLAN_TRIAL_EXPIRED + web redirect; API keys gated too (Reference leak closed); fails open on internal error; allow-list by path segment + @AllowWhenTrialExpired |
| TW-PLAN-016 | done |  | planStateOf/validityOf + entitlement resolver uses state: lapsed paid plan falls back to the free plan's caps and flags; per-workspace org_plan_state; operator attach (PUT /v2/platform/workspace-plans/:id) and workspace change (POST /v2/billing/plan) are the writers beside PAYGW |
| TW-PLAN-017 | done |  | assertFeature/assertWithinLimit, quota ledger, PlanUsageService.assertCanAdd for creators; broadcasts enforced; devices/flows/templates/auto-replies call sites wait for their domains |
| TW-PLAN-018 | done |  | PlanQuotaService + total_campaigns limit + meter; call site belongs to the campaigns domain |
| TW-PLAN-019 | done |  | @RequirePlanFeature + PlanFeatureGuard (app-wide, after permissions): 422 PLAN_FEATURE_LOCKED for reads and writes; typed keys; analytics routes use it |
| TW-PLAN-020 | done |  | GET /v2/billing/entitlements + /v2/billing/plans?unlocks=<feature>; PlanPaywall sheet in the app shell lists the plans that unlock the page |
| TW-PLAN-021 | done |  | menu entries needing a plan feature are locked/crowned from the entitlement keys (unknown locks nothing) |
| TW-PLAN-022 | done |  | ApiKeyGuard: plan api_rate_limit_per_minute caps the key (0 = platform default, workspace override -1 = unlimited); X-RateLimit-* and Retry-After headers; e2e |
| TW-PLAN-023 | done |  | plans.data_retention_days, org_plan_state.data_wiped_at, nightly worker sweep, operator preview/run with WIPE confirm, audit + org.data_wiped |
| TW-PLAN-024 | done |  | GET /v2/platform/plan-analytics (30/90/365 days, package filter), super admin only, default-currency money |
| TW-PLAN-025 | done |  | GET /v2/platform/plan-analytics/export CSV of the same numbers |
| TW-PLAN-026 | done |  | GET /v2/platform/financial: revenue, MRR, ARR, refunds, outstanding, charts, latest orders; unknown window = 30d |
| TW-PLAN-027 | done |  | GET /v2/platform/premium: paid vs free, ARPU, conversion, plan mix, revenue by plan |
| TW-PLAN-028 | wontfix |  | dead feature (package_features table has no UI and nothing reads it); bullets come from the catalogue per the port note |

## wallet-message-billing (wallet)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-WALLET-001 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-002 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-003 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-004 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-005 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-006 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-007 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-008 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-009 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-010 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-011 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-012 | done |  | emitters wired in broadcasts, campaigns, chat; scheduled/SMS/WABA/flow/api have no producer yet |
| TW-WALLET-013 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-014 | wontfix |  | intended: see parity file |
| TW-WALLET-015 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-016 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-017 | wontfix |  | intended: see parity file |
| TW-WALLET-018 | wontfix |  | intended: see parity file |
| TW-WALLET-019 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-020 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-021 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-022 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-023 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-024 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-025 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-026 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-027 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-028 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-029 | done |  | served by /wallet/snapshot, ledger, PAYGW orders; packages catalogue |
| TW-WALLET-030 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-031 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-032 | done |  | backend+web built, tests green; parity twin run not done (see parity file); deviations signed off |
| TW-WALLET-033 | wontfix |  | intended: see parity file |

## notifications-activity-audit (notif)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-NOTIF-001 | todo |  |  |
| TW-NOTIF-002 | todo |  |  |
| TW-NOTIF-003 | todo |  |  |
| TW-NOTIF-004 | todo |  |  |
| TW-NOTIF-005 | todo |  |  |
| TW-NOTIF-006 | todo |  |  |
| TW-NOTIF-007 | todo |  |  |
| TW-NOTIF-008 | todo |  |  |
| TW-NOTIF-009 | todo |  |  |
| TW-NOTIF-010 | todo |  |  |
| TW-NOTIF-011 | todo |  |  |
| TW-NOTIF-012 | todo |  |  |
| TW-NOTIF-013 | todo |  |  |
| TW-NOTIF-014 | todo |  |  |
| TW-NOTIF-015 | todo |  |  |
| TW-NOTIF-016 | todo |  |  |
| TW-NOTIF-017 | todo |  |  |
| TW-NOTIF-018 | todo |  |  |
| TW-NOTIF-019 | todo |  |  |
| TW-NOTIF-020 | todo |  |  |
| TW-NOTIF-021 | todo |  |  |
| TW-NOTIF-022 | todo |  |  |
| TW-NOTIF-023 | todo |  |  |
| TW-NOTIF-024 | todo |  |  |
| TW-NOTIF-025 | todo |  |  |
| TW-NOTIF-026 | todo |  |  |
| TW-NOTIF-027 | todo |  |  |
| TW-NOTIF-028 | todo |  |  |
| TW-NOTIF-029 | todo |  |  |
| TW-NOTIF-030 | todo |  |  |
| TW-NOTIF-031 | todo |  |  |
| TW-NOTIF-032 | todo |  |  |
| TW-NOTIF-033 | todo |  |  |
| TW-NOTIF-034 | todo |  |  |
| TW-NOTIF-035 | todo |  |  |
| TW-NOTIF-036 | todo |  |  |
| TW-NOTIF-037 | todo |  |  |
| TW-NOTIF-038 | todo |  |  |
| TW-NOTIF-039 | todo |  |  |
| TW-NOTIF-040 | todo |  |  |
| TW-NOTIF-041 | todo |  |  |
| TW-NOTIF-042 | todo |  |  |
| TW-NOTIF-043 | todo |  |  |
| TW-NOTIF-044 | todo |  |  |
| TW-NOTIF-045 | todo |  |  |

## platform-payment-gateways (paygw)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-PAYGW-001 | todo |  |  |
| TW-PAYGW-002 | todo |  |  |
| TW-PAYGW-003 | todo |  |  |
| TW-PAYGW-004 | todo |  |  |
| TW-PAYGW-005 | todo |  |  |
| TW-PAYGW-006 | todo |  |  |
| TW-PAYGW-007 | todo |  |  |
| TW-PAYGW-008 | todo |  |  |
| TW-PAYGW-009 | todo |  |  |
| TW-PAYGW-010 | todo |  |  |
| TW-PAYGW-011 | todo |  |  |
| TW-PAYGW-012 | todo |  |  |
| TW-PAYGW-013 | todo |  |  |
| TW-PAYGW-014 | todo |  |  |
| TW-PAYGW-015 | todo |  |  |
| TW-PAYGW-016 | todo |  |  |
| TW-PAYGW-017 | todo |  |  |
| TW-PAYGW-018 | todo |  |  |
| TW-PAYGW-019 | todo |  |  |
| TW-PAYGW-020 | todo |  |  |
| TW-PAYGW-021 | todo |  |  |
| TW-PAYGW-022 | todo |  |  |
| TW-PAYGW-023 | todo |  |  |
| TW-PAYGW-024 | todo |  |  |
| TW-PAYGW-025 | todo |  |  |
| TW-PAYGW-026 | todo |  |  |
| TW-PAYGW-027 | todo |  |  |
| TW-PAYGW-028 | todo |  |  |
| TW-PAYGW-029 | todo |  |  |
| TW-PAYGW-030 | todo |  |  |
| TW-PAYGW-031 | todo |  |  |
| TW-PAYGW-032 | todo |  |  |
| TW-PAYGW-033 | todo |  |  |
| TW-PAYGW-034 | todo |  |  |
| TW-PAYGW-035 | todo |  |  |
| TW-PAYGW-036 | todo |  |  |
| TW-PAYGW-037 | todo |  |  |
| TW-PAYGW-038 | todo |  |  |
| TW-PAYGW-039 | todo |  |  |
| TW-PAYGW-040 | todo |  |  |
| TW-PAYGW-041 | todo |  |  |
| TW-PAYGW-042 | todo |  |  |
| TW-PAYGW-043 | todo |  |  |
| TW-PAYGW-044 | todo |  |  |
| TW-PAYGW-045 | todo |  |  |
| TW-PAYGW-046 | todo |  |  |
| TW-PAYGW-047 | todo |  |  |
| TW-PAYGW-048 | todo |  |  |

## coupons-credits-referral-currency (cpn)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CPN-001 | verified |  | twin run 2026-10-06: coupons clean after one fix round |
| TW-CPN-002 | verified |  | twin run 2026-10-06: coupons clean after one fix round |
| TW-CPN-003 | verified |  | twin run 2026-10-06: coupons clean after one fix round |
| TW-CPN-004 | verified |  | twin run 2026-10-06: coupons clean after one fix round |
| TW-CPN-005 | verified |  | twin run 2026-10-06: coupons clean after one fix round |
| TW-CPN-006 | done |  | cpn-admin e2e + unit tests; admin web pages |
| TW-CPN-007 | backend-done |  | CouponCheckoutService.quote tested; Apply widget lives in checkout (CHK) |
| TW-CPN-008 | done |  | cpn-admin e2e + unit tests; admin web pages |
| TW-CPN-009 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-010 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-011 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-012 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-013 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-014 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-015 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-016 | done |  | moved to wallet-message-billing (TW-WALLET-019); not re-proved here |
| TW-CPN-017 | wontfix |  | not ported: unauthenticated self-confirm credit grant is a Reference defect |
| TW-CPN-018 | verified |  | twin run 2026-10-06: currencies clean after one fix round |
| TW-CPN-019 | verified |  | twin run 2026-10-06: currencies clean after one fix round |
| TW-CPN-020 | verified |  | twin run 2026-10-06: currencies clean after one fix round |
| TW-CPN-021 | verified |  | twin run 2026-10-06: currencies clean after one fix round |
| TW-CPN-022 | done |  | twin run: non-default delete compared; delete/switch-off of the default compared from the inventory only (Reference cannot restore it) |
| TW-CPN-023 | done |  | fetch-rates control compared; live rate fetch not run (public provider call) |
| TW-CPN-024 | done |  | twin ran ours only; Reference default setting not touched (shared instance) |
| TW-CPN-025 | done |  | cpn-admin e2e + currency-engine unit tests; admin web page |
| TW-CPN-026 | done |  | cpn-admin e2e + currency-engine unit tests; admin web page |
| TW-CPN-027 | todo |  | resolution lives in platform-settings-branding-storage; no CPN test proves it |
| TW-CPN-028 | done |  | cpn-admin e2e + currency-engine unit tests; admin web page |
| TW-CPN-029 | verified |  | twin run 2026-10-06: referral/affiliate clean after one fix round (reward on paid order not compared live) |
| TW-CPN-030 | verified |  | twin run 2026-10-06: referral/affiliate clean after one fix round (reward on paid order not compared live) |
| TW-CPN-031 | verified |  | twin run 2026-10-06: web form, cookie and field paths clean; mobile refer_code belongs to MOB |
| TW-CPN-032 | verified |  | twin run 2026-10-06: referral/affiliate clean after one fix round (reward on paid order not compared live) |
| TW-CPN-033 | done |  | reward on a paid order not compared live (no payment in a parity run); api e2e |
| TW-CPN-034 | done |  | wallet rules save audited; 100000 cap added; e2e |
| TW-CPN-035 | verified |  | twin run 2026-10-06: referral/affiliate clean after one fix round (reward on paid order not compared live) |
| TW-CPN-036 | verified |  | twin run 2026-10-06: referral/affiliate clean after one fix round (reward on paid order not compared live) |
| TW-CPN-037 | verified |  | twin run 2026-10-06: account tab merged into /account/affiliate, clean; reward on paid order not compared live |
| TW-CPN-038 | wontfix |  | docs-only, not ported; no commission copy shown |

## developer-rest-api-v1 (api)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-API-001 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |
| TW-API-002 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |
| TW-API-003 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |
| TW-API-004 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |
| TW-API-005 | backend-done |  | bearer guard, shared rate limit, v1 envelope, scopes, plan gate; e2e auth.e2e.spec.ts; no screen of its own |
| TW-API-006 | backend-done |  | bearer guard, shared rate limit, v1 envelope, scopes, plan gate; e2e auth.e2e.spec.ts; no screen of its own |
| TW-API-007 | backend-done |  | bearer guard, shared rate limit, v1 envelope, scopes, plan gate; e2e auth.e2e.spec.ts; no screen of its own |
| TW-API-008 | backend-done |  | bearer guard, shared rate limit, v1 envelope, scopes, plan gate; e2e auth.e2e.spec.ts; no screen of its own |
| TW-API-009 | backend-done |  | bearer guard, shared rate limit, v1 envelope, scopes, plan gate; e2e auth.e2e.spec.ts; no screen of its own |
| TW-API-010 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |
| TW-API-011 | done |  | consumed from AUTH/PLAN (security policy + plan limit); covered by auth.e2e.spec.ts rate-limit test |
| TW-API-020 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-021 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-022 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-023 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-024 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-025 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-026 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-027 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-028 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-029 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-030 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-031 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-032 | backend-done |  | PARTIAL: no location pin, no carousel; saved as draft (not approved); see parity file |
| TW-API-033 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-034 | backend-done |  | PARTIAL: no location pin, no carousel; saved as draft (not approved); see parity file |
| TW-API-035 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-036 | backend-done |  | PARTIAL: body variables only; header, media header, buttons and daily cap not carried by the chat facade; answers 202 queued |
| TW-API-037 | backend-done |  | PARTIAL: upload guard runs; file not stored or used until the chat facade carries template components |
| TW-API-038 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-039 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-040 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-041 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-042 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-043 | blocked |  | blocked: auto-reply-keywords has only a schema (no service, contracts or permission keys); Reference create/update itself is broken (missing helper) |
| TW-API-044 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-045 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-046 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-047 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-048 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-049 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-050 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-051 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-052 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-053 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-054 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-080 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-081 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-082 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-083 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-084 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-085 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-086 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-087 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-088 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-089 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-090 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-091 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-092 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-093 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-094 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-095 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-110 | backend-done |  | text and media done; PARTIAL: location pin recorded as text (chat facade has no location kind); answers sent or pending after waiting up to 3 s for the worker |
| TW-API-111 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-112 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-113 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-114 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-115 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-116 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-117 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-118 | backend-done |  | PARTIAL: WhatsApp senders; Twilio-engine sends blocked (no Twilio channel kind) |
| TW-API-119 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-120 | backend-done |  | built under /api/v1, thin controller over the dashboard service; e2e per acceptance criterion |
| TW-API-140 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-141 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-142 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-143 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-144 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-145 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-146 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-147 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-148 | blocked |  | blocked: integrations-hubspot-slack-trello-google-webhooks (webhooks/webhook_deliveries tables only; no CRUD, event emit or delivery) |
| TW-API-149 | done |  | public page + /docs redirects; docs twin: no defect vs Reference (122 same, 8 intended); webhook events card is a coming-soon note |
| TW-API-150 | backend-done |  | GET /docs/api.json generated from controllers, brand token substitution; e2e auth.e2e.spec.ts |
| TW-API-151 | frontend-done |  | console API (keys, plan cap, audit/outbox) + Developers page; browser run recorded in parity/developer-rest-api-v1.md |

## addons-extension-registry (add)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-ADD-001 | todo |  |  |
| TW-ADD-002 | todo |  |  |
| TW-ADD-003 | todo |  |  |
| TW-ADD-004 | todo |  |  |
| TW-ADD-005 | todo |  |  |
| TW-ADD-006 | todo |  |  |
| TW-ADD-007 | todo |  |  |
| TW-ADD-008 | todo |  |  |
| TW-ADD-009 | todo |  |  |
| TW-ADD-010 | todo |  |  |
| TW-ADD-011 | todo |  |  |
| TW-ADD-012 | todo |  |  |
| TW-ADD-013 | todo |  |  |
| TW-ADD-014 | todo |  |  |
| TW-ADD-015 | todo |  |  |
| TW-ADD-016 | todo |  |  |
| TW-ADD-017 | todo |  |  |
| TW-ADD-018 | todo |  |  |
| TW-ADD-019 | todo |  |  |
| TW-ADD-020 | todo |  |  |
| TW-ADD-021 | todo |  |  |
| TW-ADD-022 | todo |  |  |
| TW-ADD-023 | todo |  |  |
| TW-ADD-024 | todo |  |  |
| TW-ADD-025 | todo |  |  |
| TW-ADD-026 | todo |  |  |
| TW-ADD-027 | todo |  |  |
| TW-ADD-028 | todo |  |  |
| TW-ADD-029 | todo |  |  |
| TW-ADD-030 | todo |  |  |
| TW-ADD-031 | todo |  |  |
| TW-ADD-032 | todo |  |  |
| TW-ADD-033 | todo |  |  |
| TW-ADD-034 | todo |  |  |
| TW-ADD-035 | todo |  |  |

## marketing-site-cms (cms)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CMS-001 | todo |  |  |
| TW-CMS-002 | todo |  |  |
| TW-CMS-003 | todo |  |  |
| TW-CMS-004 | todo |  |  |
| TW-CMS-005 | todo |  |  |
| TW-CMS-006 | todo |  |  |
| TW-CMS-007 | todo |  |  |
| TW-CMS-008 | todo |  |  |
| TW-CMS-009 | todo |  |  |
| TW-CMS-010 | todo |  |  |
| TW-CMS-011 | todo |  |  |
| TW-CMS-012 | todo |  |  |
| TW-CMS-013 | todo |  |  |
| TW-CMS-014 | todo |  |  |
| TW-CMS-015 | todo |  |  |
| TW-CMS-016 | todo |  |  |
| TW-CMS-017 | todo |  |  |
| TW-CMS-018 | todo |  |  |
| TW-CMS-019 | todo |  |  |
| TW-CMS-020 | todo |  |  |
| TW-CMS-021 | todo |  |  |
| TW-CMS-022 | todo |  |  |
| TW-CMS-023 | todo |  |  |
| TW-CMS-024 | todo |  |  |
| TW-CMS-025 | todo |  |  |
| TW-CMS-026 | todo |  |  |
| TW-CMS-027 | todo |  |  |
| TW-CMS-028 | todo |  |  |
| TW-CMS-029 | todo |  |  |
| TW-CMS-030 | todo |  |  |
| TW-CMS-031 | todo |  |  |
| TW-CMS-032 | todo |  |  |
| TW-CMS-033 | todo |  |  |
| TW-CMS-034 | todo |  |  |
| TW-CMS-035 | todo |  |  |
| TW-CMS-036 | todo |  |  |
| TW-CMS-037 | todo |  |  |
| TW-CMS-038 | todo |  |  |
| TW-CMS-039 | todo |  |  |
| TW-CMS-040 | todo |  |  |
| TW-CMS-041 | todo |  |  |
| TW-CMS-042 | todo |  |  |
| TW-CMS-043 | todo |  |  |
| TW-CMS-044 | todo |  |  |
| TW-CMS-045 | todo |  |  |
| TW-CMS-046 | todo |  |  |
| TW-CMS-047 | todo |  |  |
| TW-CMS-048 | todo |  |  |
| TW-CMS-049 | todo |  |  |
| TW-CMS-050 | todo |  |  |
| TW-CMS-051 | todo |  |  |
| TW-CMS-052 | todo |  |  |
| TW-CMS-053 | todo |  |  |

## dashboards-analytics-charts (dash)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-DASH-001 | todo |  |  |
| TW-DASH-002 | todo |  |  |
| TW-DASH-003 | todo |  |  |
| TW-DASH-004 | todo |  |  |
| TW-DASH-005 | todo |  |  |
| TW-DASH-006 | todo |  |  |
| TW-DASH-007 | todo |  |  |
| TW-DASH-008 | todo |  |  |
| TW-DASH-009 | todo |  |  |
| TW-DASH-010 | todo |  |  |
| TW-DASH-011 | todo |  |  |
| TW-DASH-012 | todo |  |  |
| TW-DASH-013 | todo |  |  |
| TW-DASH-014 | todo |  |  |
| TW-DASH-015 | todo |  |  |
| TW-DASH-016 | todo |  |  |
| TW-DASH-017 | todo |  |  |
| TW-DASH-018 | todo |  |  |
| TW-DASH-019 | todo |  |  |
| TW-DASH-020 | todo |  |  |
| TW-DASH-021 | todo |  |  |
| TW-DASH-022 | todo |  |  |
| TW-DASH-023 | todo |  |  |
| TW-DASH-024 | todo |  |  |
| TW-DASH-025 | todo |  |  |
| TW-DASH-026 | todo |  |  |
| TW-DASH-027 | todo |  |  |
| TW-DASH-028 | todo |  |  |
| TW-DASH-029 | todo |  |  |
| TW-DASH-030 | todo |  |  |
| TW-DASH-031 | todo |  |  |
| TW-DASH-032 | todo |  |  |
| TW-DASH-033 | todo |  |  |
| TW-DASH-034 | todo |  |  |
| TW-DASH-035 | todo |  |  |
| TW-DASH-036 | todo |  |  |
| TW-DASH-037 | todo |  |  |
| TW-DASH-038 | todo |  |  |
| TW-DASH-039 | todo |  |  |
| TW-DASH-040 | todo |  |  |
| TW-DASH-041 | todo |  |  |
| TW-DASH-042 | todo |  |  |
| TW-DASH-043 | todo |  |  |
| TW-DASH-044 | todo |  |  |
| TW-DASH-045 | todo |  |  |
| TW-DASH-046 | todo |  |  |
| TW-DASH-047 | todo |  |  |
| TW-DASH-048 | todo |  |  |
| TW-DASH-049 | todo |  |  |
| TW-DASH-050 | todo |  |  |
| TW-DASH-051 | todo |  |  |
| TW-DASH-052 | todo |  |  |
| TW-DASH-053 | todo |  |  |
| TW-DASH-054 | todo |  |  |

## platform-support-desk (supp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-SUPP-001 | todo |  |  |
| TW-SUPP-002 | todo |  |  |
| TW-SUPP-003 | todo |  |  |
| TW-SUPP-004 | todo |  |  |
| TW-SUPP-005 | todo |  |  |
| TW-SUPP-006 | todo |  |  |
| TW-SUPP-007 | todo |  |  |
| TW-SUPP-008 | todo |  |  |
| TW-SUPP-009 | todo |  |  |
| TW-SUPP-010 | todo |  |  |
| TW-SUPP-011 | todo |  |  |
| TW-SUPP-012 | todo |  |  |
| TW-SUPP-013 | todo |  |  |
| TW-SUPP-014 | todo |  |  |
| TW-SUPP-015 | todo |  |  |
| TW-SUPP-016 | todo |  |  |
| TW-SUPP-017 | todo |  |  |
| TW-SUPP-018 | todo |  |  |
| TW-SUPP-019 | todo |  |  |
| TW-SUPP-020 | todo |  |  |
| TW-SUPP-021 | todo |  |  |
| TW-SUPP-022 | todo |  |  |
| TW-SUPP-023 | todo |  |  |
| TW-SUPP-024 | todo |  |  |
| TW-SUPP-025 | todo |  |  |
| TW-SUPP-026 | todo |  |  |
| TW-SUPP-027 | todo |  |  |
| TW-SUPP-028 | todo |  |  |
| TW-SUPP-029 | todo |  |  |
| TW-SUPP-030 | todo |  |  |
| TW-SUPP-031 | todo |  |  |
| TW-SUPP-032 | todo |  |  |
| TW-SUPP-033 | todo |  |  |
| TW-SUPP-034 | todo |  |  |
| TW-SUPP-035 | todo |  |  |
| TW-SUPP-036 | todo |  |  |
| TW-SUPP-037 | todo |  |  |
| TW-SUPP-038 | todo |  |  |
| TW-SUPP-039 | todo |  |  |
| TW-SUPP-040 | todo |  |  |
| TW-SUPP-041 | todo |  |  |
| TW-SUPP-042 | todo |  |  |
| TW-SUPP-043 | todo |  |  |
| TW-SUPP-044 | todo |  |  |
| TW-SUPP-045 | todo |  |  |
| TW-SUPP-046 | todo |  |  |

## bsp-billing-engine (bsp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-BSP-001 | todo |  |  |
| TW-BSP-002 | todo |  |  |
| TW-BSP-003 | todo |  |  |
| TW-BSP-004 | todo |  |  |
| TW-BSP-005 | todo |  |  |
| TW-BSP-006 | todo |  |  |
| TW-BSP-007 | todo |  |  |
| TW-BSP-008 | todo |  |  |
| TW-BSP-009 | todo |  |  |
| TW-BSP-010 | todo |  |  |
| TW-BSP-011 | todo |  |  |
| TW-BSP-012 | todo |  |  |
| TW-BSP-013 | todo |  |  |
| TW-BSP-014 | todo |  |  |
| TW-BSP-015 | todo |  |  |
| TW-BSP-016 | todo |  |  |
| TW-BSP-017 | todo |  |  |
| TW-BSP-018 | todo |  |  |
| TW-BSP-019 | todo |  |  |
| TW-BSP-020 | todo |  |  |
| TW-BSP-021 | todo |  |  |

## ai-keys-usage-admin (aiadm)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-AIADM-001 | todo |  |  |
| TW-AIADM-002 | todo |  |  |
| TW-AIADM-003 | todo |  |  |
| TW-AIADM-004 | todo |  |  |
| TW-AIADM-005 | todo |  |  |
| TW-AIADM-006 | todo |  |  |
| TW-AIADM-007 | todo |  |  |
| TW-AIADM-008 | todo |  |  |
| TW-AIADM-009 | todo |  |  |
| TW-AIADM-010 | todo |  |  |
