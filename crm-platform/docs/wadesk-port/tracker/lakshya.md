# WaDesk port tracker — Lakshya Tyagi

Only Lakshya Tyagi edits this file (`wadesk-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/wadesk-parity-tracker/scripts/tracker.py set WD-XXX-001 in-progress --pr 123`

## auth-registration-security (auth)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-AUTH-001 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-002 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-003 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-004 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-005 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-006 | frontend-done |  | page + API done; real senders (Meta Cloud API, Twilio, Node bridge) behind OTP_SENDER_PORT via an auth-zone sender registry; verified against local stubs only (no real Meta/Twilio credentials) |
| WD-AUTH-007 | frontend-done |  | senders, template create/refresh (+ worker poll every 5 min), test send done in the auth zone; Meta calls verified against local stubs only; the WABA template domain can replace the template client later |
| WD-AUTH-008 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc); sign-up now assigns the default plan + trial in the same transaction (PLAN resolver) |
| WD-AUTH-009 | frontend-done |  | real plan cards from GET /v2/plans (price, offer, period, messages, 3 chips, popular, current); free = continue, custom = /support, paid = /account/plans placeholder (checkout waits for billing); browser-verified |
| WD-AUTH-010 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-011 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-012 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-013 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-014 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-015 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-016 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-017 | backend-done |  | login side effects are server-side only; covered by e2e (no screen) |
| WD-AUTH-018 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| WD-AUTH-019 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-020 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-021 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-022 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-023 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-024 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-025 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-026 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-027 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-028 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-029 | frontend-done |  | branding gate is real: 422 PLAN_FEATURE_LOCKED without remove_branding, canEdit from the plan, locked state with upgrade link; browser-verified locked and editable |
| WD-AUTH-030 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-031 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-032 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-033 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-034 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-035 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-036 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-037 | frontend-done |  | backend + web; apiRateLimitPerMinute is a platform ceiling over each API key's limit, audit retention prunes audit_log + security_events daily; browser-verified |
| WD-AUTH-038 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-039 | frontend-done |  | backend + web; webhook rotation reports the real count through WebhookSecretRegistry (0 until the integrations domain registers a rotator) |
| WD-AUTH-040 | frontend-done |  | operator UI + service; enforced at every WhatsApp provider send (OUTBOUND_SEND_GUARD), re-checked at send time; e2e proves halt and resume |
| WD-AUTH-041 | frontend-done |  | operator UI + SendPolicyService; enforced at the provider boundary (content, per-minute and per-day caps, bulk skips rate caps); e2e covers enforce mode and the audit rows |
| WD-AUTH-042 | wontfix |  | dead code in WaDesk (mask_phone returns the number unchanged); do not port |
| WD-AUTH-043 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| WD-AUTH-044 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| WD-AUTH-045 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| WD-AUTH-046 | frontend-done |  | backend + web, 55 e2e + 397 web unit tests; browser-verified (parity doc) |
| WD-AUTH-047 | backend-done |  | server-side only; covered by unit/e2e tests (no screen of its own) |
| WD-AUTH-048 | wontfix |  | unrouted legacy controller; its better rules (remember toggle, password max age, safe next path) are implemented in 001/035 |
| WD-AUTH-049 | wontfix |  | no installer in the target |

## workspaces-teams-tenancy (wsp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-WSP-001 | todo |  |  |
| WD-WSP-002 | todo |  |  |
| WD-WSP-003 | todo |  |  |
| WD-WSP-004 | todo |  |  |
| WD-WSP-005 | done |  | built by AUTH-010 |
| WD-WSP-006 | todo |  |  |
| WD-WSP-007 | todo |  |  |
| WD-WSP-008 | todo |  |  |
| WD-WSP-009 | todo |  |  |
| WD-WSP-010 | todo |  |  |
| WD-WSP-011 | todo |  |  |
| WD-WSP-012 | done |  | kernel tenant context |
| WD-WSP-013 | todo |  |  |
| WD-WSP-014 | todo |  |  |
| WD-WSP-015 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-016 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-017 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-018 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-019 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-020 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-021 | wontfix |  | invite token acceptance replaces login-time activation (port note) |
| WD-WSP-022 | frontend-done |  | teams CRUD done; device scoping picker blocked until channels (devices) domain exists |
| WD-WSP-023 | todo |  |  |
| WD-WSP-024 | todo |  |  |
| WD-WSP-025 | todo |  |  |
| WD-WSP-026 | todo |  |  |
| WD-WSP-027 | todo |  |  |
| WD-WSP-028 | todo |  |  |
| WD-WSP-029 | todo |  |  |
| WD-WSP-030 | todo |  |  |
| WD-WSP-031 | todo |  |  |
| WD-WSP-032 | todo |  |  |
| WD-WSP-033 | todo |  |  |
| WD-WSP-034 | wontfix |  | platform staff are platform_operators, outside tenant orgs |
| WD-WSP-035 | todo |  |  |
| WD-WSP-036 | todo |  |  |
| WD-WSP-037 | todo |  |  |
| WD-WSP-038 | todo |  |  |
| WD-WSP-039 | todo |  |  |
| WD-WSP-040 | todo |  |  |
| WD-WSP-041 | todo |  |  |
| WD-WSP-042 | todo |  |  |
| WD-WSP-043 | todo |  |  |
| WD-WSP-044 | todo |  |  |
| WD-WSP-045 | todo |  |  |
| WD-WSP-046 | frontend-done |  | members/teams slice: API + web, e2e + unit; see parity/workspaces-teams-tenancy.md |
| WD-WSP-047 | done |  | built by AUTH; members contract carries invitedAt/joinedAt |

## roles-permissions (rbac)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-RBAC-001 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-002 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-003 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-004 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| WD-RBAC-005 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-006 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-007 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-008 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-009 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-010 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-011 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-012 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-013 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-014 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-015 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-016 | wontfix |  | operator identity pool replaces role-name staff recognition (D-RBAC-04) |
| WD-RBAC-017 | wontfix |  | legacy users.role not ported (D-RBAC-04); plan/billing bypass is a PLAN/BILL flag |
| WD-RBAC-018 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-019 | blocked |  | guard + keys ready; waiting on platform inbox routes (ASHELL/SUPP) |
| WD-RBAC-020 | blocked |  | waiting on WD-WSP impersonation tokens |
| WD-RBAC-021 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-022 | frontend-done |  | API + console screen (/admin/roles, /admin/permissions, /admin/roles/staff), 54 e2e + web unit tests; browser-checked, not compared with a running WaDesk |
| WD-RBAC-023 | backend-done |  | platform layer API + tests; see parity/roles-permissions.md |
| WD-RBAC-024 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| WD-RBAC-025 | blocked |  | each domain adopts its own permission keys; see wiring map |
| WD-RBAC-026 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| WD-RBAC-027 | backend-done |  | org.member.invite / role_assign enforced on staff-user create and role change and on the WSP members screen (invite, resend, remove, reset, role change) |
| WD-RBAC-028 | blocked |  | keys registered with the WaDesk matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| WD-RBAC-029 | blocked |  | keys registered with the WaDesk matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| WD-RBAC-030 | blocked |  | keys registered with the WaDesk matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| WD-RBAC-031 | blocked |  | keys registered with the WaDesk matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| WD-RBAC-032 | blocked |  | keys registered with the WaDesk matrix; waiting on inbox domain (TIB1/TIB2) endpoints |
| WD-RBAC-033 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| WD-RBAC-034 | blocked |  | keys org.owner_settings.manage / org.delete registered; SET, TCHAT, CHK adopt them |
| WD-RBAC-035 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |
| WD-RBAC-036 | blocked |  | one guard for all actor kinds already; API-key scopes belong to the public API domain |
| WD-RBAC-037 | backend-done |  | workspace presets, grant rules, landing, key coverage test; see parity doc |

## admin-console-shell (ashell)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-ASHELL-001 | todo |  |  |
| WD-ASHELL-002 | todo |  |  |
| WD-ASHELL-003 | todo |  |  |
| WD-ASHELL-004 | todo |  |  |
| WD-ASHELL-005 | todo |  |  |
| WD-ASHELL-006 | todo |  |  |
| WD-ASHELL-007 | todo |  |  |
| WD-ASHELL-008 | todo |  |  |
| WD-ASHELL-009 | todo |  |  |
| WD-ASHELL-010 | todo |  |  |
| WD-ASHELL-011 | todo |  |  |
| WD-ASHELL-012 | todo |  |  |
| WD-ASHELL-013 | todo |  |  |
| WD-ASHELL-014 | todo |  |  |
| WD-ASHELL-015 | todo |  |  |
| WD-ASHELL-016 | todo |  |  |
| WD-ASHELL-017 | todo |  |  |
| WD-ASHELL-018 | todo |  |  |
| WD-ASHELL-019 | todo |  |  |
| WD-ASHELL-020 | todo |  |  |
| WD-ASHELL-021 | todo |  |  |
| WD-ASHELL-022 | todo |  |  |
| WD-ASHELL-023 | todo |  |  |
| WD-ASHELL-024 | todo |  |  |
| WD-ASHELL-025 | todo |  |  |
| WD-ASHELL-026 | todo |  |  |
| WD-ASHELL-027 | todo |  |  |
| WD-ASHELL-028 | todo |  |  |
| WD-ASHELL-029 | todo |  |  |
| WD-ASHELL-030 | todo |  |  |
| WD-ASHELL-031 | todo |  |  |
| WD-ASHELL-032 | todo |  |  |
| WD-ASHELL-033 | todo |  |  |
| WD-ASHELL-034 | todo |  |  |
| WD-ASHELL-035 | todo |  |  |
| WD-ASHELL-036 | todo |  |  |
| WD-ASHELL-037 | todo |  |  |
| WD-ASHELL-038 | todo |  |  |
| WD-ASHELL-039 | todo |  |  |
| WD-ASHELL-040 | todo |  |  |
| WD-ASHELL-041 | todo |  |  |
| WD-ASHELL-042 | todo |  |  |
| WD-ASHELL-043 | todo |  |  |
| WD-ASHELL-044 | todo |  |  |
| WD-ASHELL-045 | todo |  |  |
| WD-ASHELL-046 | todo |  |  |
| WD-ASHELL-047 | todo |  |  |

## platform-settings-branding-storage (set)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-SET-001 | todo |  |  |
| WD-SET-002 | todo |  |  |
| WD-SET-003 | todo |  |  |
| WD-SET-004 | todo |  |  |
| WD-SET-005 | todo |  |  |
| WD-SET-006 | todo |  |  |
| WD-SET-007 | todo |  |  |
| WD-SET-008 | todo |  |  |
| WD-SET-009 | todo |  |  |
| WD-SET-010 | todo |  |  |
| WD-SET-011 | todo |  |  |
| WD-SET-012 | todo |  |  |
| WD-SET-013 | todo |  |  |
| WD-SET-014 | todo |  |  |
| WD-SET-015 | todo |  |  |
| WD-SET-016 | todo |  |  |
| WD-SET-017 | todo |  |  |
| WD-SET-018 | todo |  |  |
| WD-SET-019 | todo |  |  |
| WD-SET-020 | todo |  |  |
| WD-SET-021 | todo |  |  |
| WD-SET-022 | todo |  |  |
| WD-SET-023 | todo |  |  |
| WD-SET-024 | todo |  |  |
| WD-SET-025 | todo |  |  |
| WD-SET-026 | todo |  |  |
| WD-SET-027 | todo |  |  |
| WD-SET-028 | todo |  |  |
| WD-SET-029 | todo |  |  |
| WD-SET-030 | todo |  |  |
| WD-SET-031 | todo |  |  |
| WD-SET-032 | todo |  |  |
| WD-SET-033 | todo |  |  |
| WD-SET-034 | todo |  |  |
| WD-SET-035 | todo |  |  |
| WD-SET-036 | todo |  |  |
| WD-SET-037 | todo |  |  |
| WD-SET-038 | todo |  |  |
| WD-SET-039 | todo |  |  |
| WD-SET-040 | todo |  |  |
| WD-SET-041 | todo |  |  |
| WD-SET-042 | todo |  |  |
| WD-SET-043 | todo |  |  |
| WD-SET-044 | todo |  |  |
| WD-SET-045 | todo |  |  |
| WD-SET-046 | todo |  |  |

## localization-translation (i18n)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-I18N-001 | todo |  |  |
| WD-I18N-002 | todo |  |  |
| WD-I18N-003 | todo |  |  |
| WD-I18N-004 | todo |  |  |
| WD-I18N-005 | todo |  |  |
| WD-I18N-006 | todo |  |  |
| WD-I18N-007 | todo |  |  |
| WD-I18N-008 | todo |  |  |
| WD-I18N-009 | todo |  |  |
| WD-I18N-010 | todo |  |  |
| WD-I18N-011 | todo |  |  |
| WD-I18N-012 | todo |  |  |
| WD-I18N-013 | todo |  |  |
| WD-I18N-014 | todo |  |  |
| WD-I18N-015 | todo |  |  |
| WD-I18N-016 | todo |  |  |
| WD-I18N-017 | todo |  |  |
| WD-I18N-018 | todo |  |  |
| WD-I18N-019 | todo |  |  |
| WD-I18N-020 | todo |  |  |
| WD-I18N-021 | todo |  |  |
| WD-I18N-022 | todo |  |  |
| WD-I18N-023 | todo |  |  |
| WD-I18N-024 | todo |  |  |
| WD-I18N-025 | todo |  |  |
| WD-I18N-026 | todo |  |  |
| WD-I18N-027 | todo |  |  |
| WD-I18N-028 | todo |  |  |
| WD-I18N-029 | todo |  |  |
| WD-I18N-030 | todo |  |  |
| WD-I18N-031 | todo |  |  |
| WD-I18N-032 | todo |  |  |
| WD-I18N-033 | todo |  |  |
| WD-I18N-034 | todo |  |  |
| WD-I18N-035 | todo |  |  |
| WD-I18N-036 | todo |  |  |
| WD-I18N-037 | todo |  |  |
| WD-I18N-038 | todo |  |  |
| WD-I18N-039 | todo |  |  |

## install-update-licensing (inst)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-INST-001 | todo |  |  |
| WD-INST-002 | todo |  |  |
| WD-INST-003 | todo |  |  |
| WD-INST-004 | todo |  |  |
| WD-INST-005 | todo |  |  |
| WD-INST-006 | todo |  |  |
| WD-INST-007 | todo |  |  |
| WD-INST-008 | todo |  |  |
| WD-INST-009 | todo |  |  |
| WD-INST-010 | todo |  |  |
| WD-INST-011 | todo |  |  |
| WD-INST-012 | todo |  |  |
| WD-INST-013 | todo |  |  |
| WD-INST-014 | todo |  |  |
| WD-INST-015 | todo |  |  |
| WD-INST-016 | todo |  |  |
| WD-INST-017 | todo |  |  |
| WD-INST-018 | todo |  |  |
| WD-INST-019 | todo |  |  |
| WD-INST-020 | todo |  |  |
| WD-INST-021 | todo |  |  |
| WD-INST-022 | todo |  |  |
| WD-INST-023 | todo |  |  |
| WD-INST-024 | todo |  |  |
| WD-INST-025 | todo |  |  |
| WD-INST-026 | todo |  |  |
| WD-INST-027 | todo |  |  |
| WD-INST-028 | todo |  |  |
| WD-INST-029 | todo |  |  |

## plans-subscriptions-trials (plan)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-PLAN-001 | in-progress |  | operator /admin/plans: KPI strip (total/active/free/paid), table + cards, in-use counts; no MRR/subscribers/analytics link |
| WD-PLAN-002 | in-progress |  | single modal with 4 grouped sections (identity, pricing, limits, features) instead of a 4-step wizard; no live review panel |
| WD-PLAN-003 | in-progress |  | create/update validation shared via @crm/contracts (checkPlanRules), slug rules, one default; slug immutable; audited |
| WD-PLAN-004 | in-progress |  | PATCH /v2/platform/plans/:id/active; refuses to deactivate the signup default |
| WD-PLAN-005 | in-progress |  | DELETE refuses any org on the plan (PLAN_IN_USE) and the signup default; single slug reference so nothing is missed |
| WD-PLAN-006 | in-progress |  | thin slice: 9 limit keys in a contracts registry (0 = unlimited, overrides, assertWithinLimit); no usage meters/ledger, nothing enforced yet |
| WD-PLAN-007 | in-progress |  | thin slice: 7 feature flags in a registry; only remove_branding is enforced (branding); no route middleware/paywall |
| WD-PLAN-008 | in-progress |  | 4-step default resolver + trial rule done and tested; registration default is a dropdown of active plans; billing_plan_scope not built |
| WD-PLAN-009 | todo |  |  |
| WD-PLAN-010 | todo |  |  |
| WD-PLAN-011 | in-progress |  | workspace picker built on /account/plans: validity banner, cards with server-decided upgrade/downgrade/switch, compare table, confirm dialog; owner rule: admins may downgrade online (intended deviation). Not built: yearly toggle, add-ons, FAQ (WD-PLAN-009/010 settings) |
| WD-PLAN-012 | blocked |  | needs PAYGW recurring subscriptions (no subscriptions table writer yet); no cancel button shown instead of a dead one |
| WD-PLAN-013 | done |  | trial/renewal bar from GET /v2/billing/status, mounted in the app shell; renewal bar has no Cancel auto-renew (WD-PLAN-012 blocked); renew link goes to plans (WaDesk quirk fixed deliberately: no broken route guard) |
| WD-PLAN-014 | done |  | GET /v2/billing/usage + /account/usage pane: 11 meters from the same counts enforcement uses, calendar-month reset, features unlocked; no wallet tiles (WALLET domain) |
| WD-PLAN-015 | done |  | global TrialGateGuard after auth: 402 PLAN_TRIAL_EXPIRED + web redirect; API keys gated too (WaDesk leak closed); fails open on internal error; allow-list by path segment + @AllowWhenTrialExpired |
| WD-PLAN-016 | done |  | planStateOf/validityOf + entitlement resolver uses state: lapsed paid plan falls back to the free plan's caps and flags; per-workspace org_plan_state; operator attach (PUT /v2/platform/workspace-plans/:id) and workspace change (POST /v2/billing/plan) are the writers beside PAYGW |
| WD-PLAN-017 | in-progress |  | guards unchanged; meters now show the same counts; quota ledger (WD-PLAN-018) still todo |
| WD-PLAN-018 | todo |  |  |
| WD-PLAN-019 | todo |  |  |
| WD-PLAN-020 | todo |  |  |
| WD-PLAN-021 | todo |  |  |
| WD-PLAN-022 | todo |  |  |
| WD-PLAN-023 | todo |  |  |
| WD-PLAN-024 | todo |  |  |
| WD-PLAN-025 | todo |  |  |
| WD-PLAN-026 | todo |  |  |
| WD-PLAN-027 | todo |  |  |
| WD-PLAN-028 | todo |  |  |

## wallet-message-billing (wallet)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-WALLET-001 | todo |  |  |
| WD-WALLET-002 | todo |  |  |
| WD-WALLET-003 | todo |  |  |
| WD-WALLET-004 | todo |  |  |
| WD-WALLET-005 | todo |  |  |
| WD-WALLET-006 | todo |  |  |
| WD-WALLET-007 | todo |  |  |
| WD-WALLET-008 | todo |  |  |
| WD-WALLET-009 | todo |  |  |
| WD-WALLET-010 | todo |  |  |
| WD-WALLET-011 | todo |  |  |
| WD-WALLET-012 | todo |  |  |
| WD-WALLET-013 | todo |  |  |
| WD-WALLET-014 | todo |  |  |
| WD-WALLET-015 | todo |  |  |
| WD-WALLET-016 | todo |  |  |
| WD-WALLET-017 | todo |  |  |
| WD-WALLET-018 | todo |  |  |
| WD-WALLET-019 | todo |  |  |
| WD-WALLET-020 | todo |  |  |
| WD-WALLET-021 | todo |  |  |
| WD-WALLET-022 | todo |  |  |
| WD-WALLET-023 | todo |  |  |
| WD-WALLET-024 | todo |  |  |
| WD-WALLET-025 | todo |  |  |
| WD-WALLET-026 | todo |  |  |
| WD-WALLET-027 | todo |  |  |
| WD-WALLET-028 | todo |  |  |
| WD-WALLET-029 | todo |  |  |
| WD-WALLET-030 | todo |  |  |
| WD-WALLET-031 | todo |  |  |
| WD-WALLET-032 | todo |  |  |
| WD-WALLET-033 | todo |  |  |

## notifications-activity-audit (notif)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-NOTIF-001 | todo |  |  |
| WD-NOTIF-002 | todo |  |  |
| WD-NOTIF-003 | todo |  |  |
| WD-NOTIF-004 | todo |  |  |
| WD-NOTIF-005 | todo |  |  |
| WD-NOTIF-006 | todo |  |  |
| WD-NOTIF-007 | todo |  |  |
| WD-NOTIF-008 | todo |  |  |
| WD-NOTIF-009 | todo |  |  |
| WD-NOTIF-010 | todo |  |  |
| WD-NOTIF-011 | todo |  |  |
| WD-NOTIF-012 | todo |  |  |
| WD-NOTIF-013 | todo |  |  |
| WD-NOTIF-014 | todo |  |  |
| WD-NOTIF-015 | todo |  |  |
| WD-NOTIF-016 | todo |  |  |
| WD-NOTIF-017 | todo |  |  |
| WD-NOTIF-018 | todo |  |  |
| WD-NOTIF-019 | todo |  |  |
| WD-NOTIF-020 | todo |  |  |
| WD-NOTIF-021 | todo |  |  |
| WD-NOTIF-022 | todo |  |  |
| WD-NOTIF-023 | todo |  |  |
| WD-NOTIF-024 | todo |  |  |
| WD-NOTIF-025 | todo |  |  |
| WD-NOTIF-026 | todo |  |  |
| WD-NOTIF-027 | todo |  |  |
| WD-NOTIF-028 | todo |  |  |
| WD-NOTIF-029 | todo |  |  |
| WD-NOTIF-030 | todo |  |  |
| WD-NOTIF-031 | todo |  |  |
| WD-NOTIF-032 | todo |  |  |
| WD-NOTIF-033 | todo |  |  |
| WD-NOTIF-034 | todo |  |  |
| WD-NOTIF-035 | todo |  |  |
| WD-NOTIF-036 | todo |  |  |
| WD-NOTIF-037 | todo |  |  |
| WD-NOTIF-038 | todo |  |  |
| WD-NOTIF-039 | todo |  |  |
| WD-NOTIF-040 | todo |  |  |
| WD-NOTIF-041 | todo |  |  |
| WD-NOTIF-042 | todo |  |  |
| WD-NOTIF-043 | todo |  |  |
| WD-NOTIF-044 | todo |  |  |
| WD-NOTIF-045 | todo |  |  |

## platform-payment-gateways (paygw)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-PAYGW-001 | todo |  |  |
| WD-PAYGW-002 | todo |  |  |
| WD-PAYGW-003 | todo |  |  |
| WD-PAYGW-004 | todo |  |  |
| WD-PAYGW-005 | todo |  |  |
| WD-PAYGW-006 | todo |  |  |
| WD-PAYGW-007 | todo |  |  |
| WD-PAYGW-008 | todo |  |  |
| WD-PAYGW-009 | todo |  |  |
| WD-PAYGW-010 | todo |  |  |
| WD-PAYGW-011 | todo |  |  |
| WD-PAYGW-012 | todo |  |  |
| WD-PAYGW-013 | todo |  |  |
| WD-PAYGW-014 | todo |  |  |
| WD-PAYGW-015 | todo |  |  |
| WD-PAYGW-016 | todo |  |  |
| WD-PAYGW-017 | todo |  |  |
| WD-PAYGW-018 | todo |  |  |
| WD-PAYGW-019 | todo |  |  |
| WD-PAYGW-020 | todo |  |  |
| WD-PAYGW-021 | todo |  |  |
| WD-PAYGW-022 | todo |  |  |
| WD-PAYGW-023 | todo |  |  |
| WD-PAYGW-024 | todo |  |  |
| WD-PAYGW-025 | todo |  |  |
| WD-PAYGW-026 | todo |  |  |
| WD-PAYGW-027 | todo |  |  |
| WD-PAYGW-028 | todo |  |  |
| WD-PAYGW-029 | todo |  |  |
| WD-PAYGW-030 | todo |  |  |
| WD-PAYGW-031 | todo |  |  |
| WD-PAYGW-032 | todo |  |  |
| WD-PAYGW-033 | todo |  |  |
| WD-PAYGW-034 | todo |  |  |
| WD-PAYGW-035 | todo |  |  |
| WD-PAYGW-036 | todo |  |  |
| WD-PAYGW-037 | todo |  |  |
| WD-PAYGW-038 | todo |  |  |
| WD-PAYGW-039 | todo |  |  |
| WD-PAYGW-040 | todo |  |  |
| WD-PAYGW-041 | todo |  |  |
| WD-PAYGW-042 | todo |  |  |
| WD-PAYGW-043 | todo |  |  |
| WD-PAYGW-044 | todo |  |  |
| WD-PAYGW-045 | todo |  |  |
| WD-PAYGW-046 | todo |  |  |
| WD-PAYGW-047 | todo |  |  |
| WD-PAYGW-048 | todo |  |  |

## coupons-credits-referral-currency (cpn)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-CPN-001 | todo |  |  |
| WD-CPN-002 | todo |  |  |
| WD-CPN-003 | todo |  |  |
| WD-CPN-004 | todo |  |  |
| WD-CPN-005 | todo |  |  |
| WD-CPN-006 | todo |  |  |
| WD-CPN-007 | todo |  |  |
| WD-CPN-008 | todo |  |  |
| WD-CPN-009 | todo |  |  |
| WD-CPN-010 | todo |  |  |
| WD-CPN-011 | todo |  |  |
| WD-CPN-012 | todo |  |  |
| WD-CPN-013 | todo |  |  |
| WD-CPN-014 | todo |  |  |
| WD-CPN-015 | todo |  |  |
| WD-CPN-016 | todo |  |  |
| WD-CPN-017 | todo |  |  |
| WD-CPN-018 | todo |  |  |
| WD-CPN-019 | todo |  |  |
| WD-CPN-020 | todo |  |  |
| WD-CPN-021 | todo |  |  |
| WD-CPN-022 | todo |  |  |
| WD-CPN-023 | todo |  |  |
| WD-CPN-024 | todo |  |  |
| WD-CPN-025 | todo |  |  |
| WD-CPN-026 | todo |  |  |
| WD-CPN-027 | todo |  |  |
| WD-CPN-028 | todo |  |  |
| WD-CPN-029 | todo |  |  |
| WD-CPN-030 | todo |  |  |
| WD-CPN-031 | todo |  |  |
| WD-CPN-032 | todo |  |  |
| WD-CPN-033 | todo |  |  |
| WD-CPN-034 | todo |  |  |
| WD-CPN-035 | todo |  |  |
| WD-CPN-036 | todo |  |  |
| WD-CPN-037 | todo |  |  |
| WD-CPN-038 | todo |  |  |

## addons-extension-registry (add)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-ADD-001 | todo |  |  |
| WD-ADD-002 | todo |  |  |
| WD-ADD-003 | todo |  |  |
| WD-ADD-004 | todo |  |  |
| WD-ADD-005 | todo |  |  |
| WD-ADD-006 | todo |  |  |
| WD-ADD-007 | todo |  |  |
| WD-ADD-008 | todo |  |  |
| WD-ADD-009 | todo |  |  |
| WD-ADD-010 | todo |  |  |
| WD-ADD-011 | todo |  |  |
| WD-ADD-012 | todo |  |  |
| WD-ADD-013 | todo |  |  |
| WD-ADD-014 | todo |  |  |
| WD-ADD-015 | todo |  |  |
| WD-ADD-016 | todo |  |  |
| WD-ADD-017 | todo |  |  |
| WD-ADD-018 | todo |  |  |
| WD-ADD-019 | todo |  |  |
| WD-ADD-020 | todo |  |  |
| WD-ADD-021 | todo |  |  |
| WD-ADD-022 | todo |  |  |
| WD-ADD-023 | todo |  |  |
| WD-ADD-024 | todo |  |  |
| WD-ADD-025 | todo |  |  |
| WD-ADD-026 | todo |  |  |
| WD-ADD-027 | todo |  |  |
| WD-ADD-028 | todo |  |  |
| WD-ADD-029 | todo |  |  |
| WD-ADD-030 | todo |  |  |
| WD-ADD-031 | todo |  |  |
| WD-ADD-032 | todo |  |  |
| WD-ADD-033 | todo |  |  |
| WD-ADD-034 | todo |  |  |
| WD-ADD-035 | todo |  |  |

## marketing-site-cms (cms)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-CMS-001 | todo |  |  |
| WD-CMS-002 | todo |  |  |
| WD-CMS-003 | todo |  |  |
| WD-CMS-004 | todo |  |  |
| WD-CMS-005 | todo |  |  |
| WD-CMS-006 | todo |  |  |
| WD-CMS-007 | todo |  |  |
| WD-CMS-008 | todo |  |  |
| WD-CMS-009 | todo |  |  |
| WD-CMS-010 | todo |  |  |
| WD-CMS-011 | todo |  |  |
| WD-CMS-012 | todo |  |  |
| WD-CMS-013 | todo |  |  |
| WD-CMS-014 | todo |  |  |
| WD-CMS-015 | todo |  |  |
| WD-CMS-016 | todo |  |  |
| WD-CMS-017 | todo |  |  |
| WD-CMS-018 | todo |  |  |
| WD-CMS-019 | todo |  |  |
| WD-CMS-020 | todo |  |  |
| WD-CMS-021 | todo |  |  |
| WD-CMS-022 | todo |  |  |
| WD-CMS-023 | todo |  |  |
| WD-CMS-024 | todo |  |  |
| WD-CMS-025 | todo |  |  |
| WD-CMS-026 | todo |  |  |
| WD-CMS-027 | todo |  |  |
| WD-CMS-028 | todo |  |  |
| WD-CMS-029 | todo |  |  |
| WD-CMS-030 | todo |  |  |
| WD-CMS-031 | todo |  |  |
| WD-CMS-032 | todo |  |  |
| WD-CMS-033 | todo |  |  |
| WD-CMS-034 | todo |  |  |
| WD-CMS-035 | todo |  |  |
| WD-CMS-036 | todo |  |  |
| WD-CMS-037 | todo |  |  |
| WD-CMS-038 | todo |  |  |
| WD-CMS-039 | todo |  |  |
| WD-CMS-040 | todo |  |  |
| WD-CMS-041 | todo |  |  |
| WD-CMS-042 | todo |  |  |
| WD-CMS-043 | todo |  |  |
| WD-CMS-044 | todo |  |  |
| WD-CMS-045 | todo |  |  |
| WD-CMS-046 | todo |  |  |
| WD-CMS-047 | todo |  |  |
| WD-CMS-048 | todo |  |  |
| WD-CMS-049 | todo |  |  |
| WD-CMS-050 | todo |  |  |
| WD-CMS-051 | todo |  |  |
| WD-CMS-052 | todo |  |  |
| WD-CMS-053 | todo |  |  |

## dashboards-analytics-charts (dash)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-DASH-001 | todo |  |  |
| WD-DASH-002 | todo |  |  |
| WD-DASH-003 | todo |  |  |
| WD-DASH-004 | todo |  |  |
| WD-DASH-005 | todo |  |  |
| WD-DASH-006 | todo |  |  |
| WD-DASH-007 | todo |  |  |
| WD-DASH-008 | todo |  |  |
| WD-DASH-009 | todo |  |  |
| WD-DASH-010 | todo |  |  |
| WD-DASH-011 | todo |  |  |
| WD-DASH-012 | todo |  |  |
| WD-DASH-013 | todo |  |  |
| WD-DASH-014 | todo |  |  |
| WD-DASH-015 | todo |  |  |
| WD-DASH-016 | todo |  |  |
| WD-DASH-017 | todo |  |  |
| WD-DASH-018 | todo |  |  |
| WD-DASH-019 | todo |  |  |
| WD-DASH-020 | todo |  |  |
| WD-DASH-021 | todo |  |  |
| WD-DASH-022 | todo |  |  |
| WD-DASH-023 | todo |  |  |
| WD-DASH-024 | todo |  |  |
| WD-DASH-025 | todo |  |  |
| WD-DASH-026 | todo |  |  |
| WD-DASH-027 | todo |  |  |
| WD-DASH-028 | todo |  |  |
| WD-DASH-029 | todo |  |  |
| WD-DASH-030 | todo |  |  |
| WD-DASH-031 | todo |  |  |
| WD-DASH-032 | todo |  |  |
| WD-DASH-033 | todo |  |  |
| WD-DASH-034 | todo |  |  |
| WD-DASH-035 | todo |  |  |
| WD-DASH-036 | todo |  |  |
| WD-DASH-037 | todo |  |  |
| WD-DASH-038 | todo |  |  |
| WD-DASH-039 | todo |  |  |
| WD-DASH-040 | todo |  |  |
| WD-DASH-041 | todo |  |  |
| WD-DASH-042 | todo |  |  |
| WD-DASH-043 | todo |  |  |
| WD-DASH-044 | todo |  |  |
| WD-DASH-045 | todo |  |  |
| WD-DASH-046 | todo |  |  |
| WD-DASH-047 | todo |  |  |
| WD-DASH-048 | todo |  |  |
| WD-DASH-049 | todo |  |  |
| WD-DASH-050 | todo |  |  |
| WD-DASH-051 | todo |  |  |
| WD-DASH-052 | todo |  |  |
| WD-DASH-053 | todo |  |  |
| WD-DASH-054 | todo |  |  |

## platform-support-desk (supp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-SUPP-001 | todo |  |  |
| WD-SUPP-002 | todo |  |  |
| WD-SUPP-003 | todo |  |  |
| WD-SUPP-004 | todo |  |  |
| WD-SUPP-005 | todo |  |  |
| WD-SUPP-006 | todo |  |  |
| WD-SUPP-007 | todo |  |  |
| WD-SUPP-008 | todo |  |  |
| WD-SUPP-009 | todo |  |  |
| WD-SUPP-010 | todo |  |  |
| WD-SUPP-011 | todo |  |  |
| WD-SUPP-012 | todo |  |  |
| WD-SUPP-013 | todo |  |  |
| WD-SUPP-014 | todo |  |  |
| WD-SUPP-015 | todo |  |  |
| WD-SUPP-016 | todo |  |  |
| WD-SUPP-017 | todo |  |  |
| WD-SUPP-018 | todo |  |  |
| WD-SUPP-019 | todo |  |  |
| WD-SUPP-020 | todo |  |  |
| WD-SUPP-021 | todo |  |  |
| WD-SUPP-022 | todo |  |  |
| WD-SUPP-023 | todo |  |  |
| WD-SUPP-024 | todo |  |  |
| WD-SUPP-025 | todo |  |  |
| WD-SUPP-026 | todo |  |  |
| WD-SUPP-027 | todo |  |  |
| WD-SUPP-028 | todo |  |  |
| WD-SUPP-029 | todo |  |  |
| WD-SUPP-030 | todo |  |  |
| WD-SUPP-031 | todo |  |  |
| WD-SUPP-032 | todo |  |  |
| WD-SUPP-033 | todo |  |  |
| WD-SUPP-034 | todo |  |  |
| WD-SUPP-035 | todo |  |  |
| WD-SUPP-036 | todo |  |  |
| WD-SUPP-037 | todo |  |  |
| WD-SUPP-038 | todo |  |  |
| WD-SUPP-039 | todo |  |  |
| WD-SUPP-040 | todo |  |  |
| WD-SUPP-041 | todo |  |  |
| WD-SUPP-042 | todo |  |  |
| WD-SUPP-043 | todo |  |  |
| WD-SUPP-044 | todo |  |  |
| WD-SUPP-045 | todo |  |  |
| WD-SUPP-046 | todo |  |  |

## bsp-billing-engine (bsp)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-BSP-001 | todo |  |  |
| WD-BSP-002 | todo |  |  |
| WD-BSP-003 | todo |  |  |
| WD-BSP-004 | todo |  |  |
| WD-BSP-005 | todo |  |  |
| WD-BSP-006 | todo |  |  |
| WD-BSP-007 | todo |  |  |
| WD-BSP-008 | todo |  |  |
| WD-BSP-009 | todo |  |  |
| WD-BSP-010 | todo |  |  |
| WD-BSP-011 | todo |  |  |
| WD-BSP-012 | todo |  |  |
| WD-BSP-013 | todo |  |  |
| WD-BSP-014 | todo |  |  |
| WD-BSP-015 | todo |  |  |
| WD-BSP-016 | todo |  |  |
| WD-BSP-017 | todo |  |  |
| WD-BSP-018 | todo |  |  |
| WD-BSP-019 | todo |  |  |
| WD-BSP-020 | todo |  |  |
| WD-BSP-021 | todo |  |  |

## ai-keys-usage-admin (aiadm)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-AIADM-001 | todo |  |  |
| WD-AIADM-002 | todo |  |  |
| WD-AIADM-003 | todo |  |  |
| WD-AIADM-004 | todo |  |  |
| WD-AIADM-005 | todo |  |  |
| WD-AIADM-006 | todo |  |  |
| WD-AIADM-007 | todo |  |  |
| WD-AIADM-008 | todo |  |  |
| WD-AIADM-009 | todo |  |  |
| WD-AIADM-010 | todo |  |  |
