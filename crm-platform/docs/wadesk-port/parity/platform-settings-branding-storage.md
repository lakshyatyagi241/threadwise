# Parity evidence: platform settings, branding, storage (SET)

WaDesk 1.7.0 vs this tree. Round 2.

## What was compared, and how

- WaDesk side: real pages opened once each on the running reference (hub, General, Appearance, Mail, SEO, Privacy,
  Analytics, Custom code, PWA, Storage, Real-time, Site info), full-page screenshots plus Blade view and controller read.
- Our side: the screen specs in `apps/web/src/features/platform-settings-branding-storage/fields.ts` and the message
  catalogue, built from the same Blade views (sections, field order, eyebrows, quick-guide aside, sticky save bar,
  numbered hub tiles, KPI strip, header actions).
- Our running screens were captured later with a support operator without MFA (full-page, 1440 wide, General, Appearance,
  Mail in `_work`-side shots `v/ours-*.png` next to `v/wadesk-*.png`). General matches in section order, field order,
  eyebrows, quick-guide aside, brand-asset cards, toggle cards. Remaining visible differences are the intended ones below
  (single maintenance toggle, registration link instead of inline signup fields) and our read-only banner for non-super-admin roles.

## Rows compared from source and WaDesk screenshots

| #   | Screen          | WaDesk                                                                                           | Ours                                                                        | Result    |
| --- | --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------- |
| 1   | General         | Sections: Application identity, Brand assets, Platform toggles, Signups and free trial; guide    | Same four sections, same field order (name, footer, URL/email pairs, ...) | same      |
| 2   | General         | Sticky "Changes apply only after you save" bar with Cancel and Save                              | Sticky save bar                                                             | same      |
| 3   | Hub             | KPI strip (saved, healthy, needs test, secret fields, last updated) and numbered tiles           | Same strip and numbered tiles for our groups                                | same      |
| 4   | Appearance      | Colour tokens in Brand, Surfaces, Text, Accents; live preview; reset                             | Same groups, preview, reset; blank shows the shipped colour                 | same      |
| 5   | Mail            | Driver, host, port, encryption, sender, test card                                                | Same; test send in its own card                                             | same      |

## Intended differences

| #   | Area                    | WaDesk                                                  | Here                                                                 | Why                                                                 |
| --- | ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | General toggles         | Preloader, Maintenance, Public registration, Auto-verify | Maintenance only; signup policy links to the AUTH registration screen | Preloader is dead code (WD-SET-009); registration policy is AUTH's (WD-SET-007) |
| 2   | Settings store          | One row per key, mixed encryption                       | One versioned JSON document per group, AES-GCM secrets               | Optimistic locking, one scheme                                      |
| 3   | Malformed colours       | Saved as empty                                          | Refused with an error                                                | Deliberate fix (WD-SET-013)                                         |
| 4   | Pusher runtime          | Pusher-HTTP broadcaster, Echo in the browser            | Settings and test only; live updates use the existing Socket.IO gateway | Engine swap, tenant-scoped rooms (WD-SET-042); the public config still exposes enabled/key/cluster |
| 5   | Real-time test failure  | HTTP 422                                                | HTTP 200 with `ok: false`                                            | Probe result is data, not a request error                           |
| 6   | Custom CSS/JS           | Always injected                                         | Withheld until the master switch is on                               | Safer default                                                       |

## Not ported on purpose

- WD-SET-009 preloader toggle: stored, never read by WaDesk.
- WD-SET-021 classic auth-pages form endpoint: dead code, replaced by the inline API.
- WD-SET-031 compliance flags and WD-SET-037 PWA install prompt fields: stored only in WaDesk; stored only here.

## Built by another domain (not counted here)

- WD-SET-007 signup policy: AUTH (registration policy). `billing_plan_scope` is not ported.
- WD-SET-016 menu order: ASHELL (`admin/settings/menu-order`).
- WD-SET-018, 019, 020 auth pages editor: AUTH (`admin/settings/auth-pages`).
- WD-SET-043 premium plans dashboard: PLAN as WD-PLAN-027 (needs subscription read models; not built).

## WD-SET-017 (partial)

`activeTheme(cookie, preference)` resolves the theme as WaDesk does (cookie, then preference, never doodle from the
database, else paper); logos per theme already come from the public site config. The user-profile preference column and
the four-theme switcher live in the customer shell and AUTH profile, which are other domains' files.

## Evidence

| What                                                   | Result                                                  |
| ------------------------------------------------------ | ------------------------------------------------------- |
| API e2e `test/e2e/platform-settings-branding-storage`  | 49 passed                                               |
| API unit suite (whole)                                 | 1511 passed, 2 failed (WD-DASH-048 health probes, not SET) |
| Web feature tests                                      | 45 passed                                               |
| `pnpm arch:check`, `pnpm db:verify-schema`             | 0 errors                                                |

## Tiers

tier P0 done: WD-SET-001, 002, 005, 024 (7 is AUTH's). tier P1 done: 003, 006, 008, 010-015, 017, 022, 023, 025-030, 032, 033, 035, 036, 038-041, 044-046.
tier P2 done: 004, 014, 015, 034. Not ported on purpose: 009, 021, 031 and 037 (stored only), 042 (Socket.IO gateway replaces Pusher).
Owned by other domains: 007, 016, 018-020 (AUTH/ASHELL), 043 (PLAN).

Round 2 re-check: the tree already holds the whole domain. Postgres was not reachable in the re-check session (localhost:5432 refused, Docker engine down), so migrate, API e2e and integration were not re-run; unit suites re-run green (API 86, web 45).
