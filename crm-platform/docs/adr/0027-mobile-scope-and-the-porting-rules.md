# ADR-0027: How the WaDesk porting rules apply to the mobile app

- **Status:** proposed — **needs the project owner's decision** (see "Decisions needed")
- **Date:** 2026-10-10

## Context

`CLAUDE.md` and `docs/wadesk-port/PORTING_RULES.md` bind every session: no WaDesk feature is lost or changed, the same UI is rebuilt on our stack, wiring is real, the feature's wiring map
is read first, every feature gets a Playwright parity run against the running WaDesk reference, a Help guide, and translations in all 21 locales. Those rules were written for the web
product, whose reference is a Laravel web application. The mobile app has no WaDesk screens to copy, and nothing in the repository says which features the app must have.
Left open, the rules either block all mobile work (there is no "same UI" to match) or are silently dropped (which is how features get lost).

## Decision (proposed)

1. **Behaviour is the contract.** A mobile screen for a feature uses the same API endpoints, the same permissions (`session.permissions`), the same validation (contract schemas), the same
   statuses and the same copy meaning as the web screen that already passed parity. It never invents a rule the web does not have. If mobile needs something the API cannot do yet, the API
   change is ported first (its own parity run), then the screen.
2. **The UI is a mobile adaptation, not a copy.** Same information and the same flows, arranged for a phone: lists instead of tables, sheets instead of side panels, system pickers, native
   share and camera. A flow may be shortened for a phone; a capability is never removed without being recorded as `blocked` or `deferred` with its id.
3. **Scope is explicit.** Which features the mobile app includes, and in what order, is the backlog in `docs/mobile/backlog.md`, owned by the project owner. Every entry names its web feature id
   (`WD-…`), its wiring map, its API routes and its status (`ready`, `in-progress`, `blocked`, `not-planned`). A feature not listed is not silently dropped; it is `not-planned` until someone decides.
4. **Steps that apply unchanged:** read the wiring map first; real wiring only (no mocks, no dead buttons); contracts in `@crm/contracts`; all 21 locales in the same change (`mobile-i18n-sync`);
   the quality gates of ADR-0025; record anything not ported as `blocked`.
5. **Steps that need a mobile equivalent:**
   - _Parity run._ Playwright cannot drive a native app. The mobile equivalent is a Maestro flow per ported feature (`apps/mobile/.maestro/<feature>.yaml`) that performs the same scenario as the
     web parity run, plus a side-by-side check against the running web app and the reference for the data shown. The Stop hook of `wadesk-playwright-parity` does not watch `apps/mobile`; the
     `mobile-feature-port` skill asks for the Maestro flow and the manual comparison explicitly.
   - _Help guide._ The Help center is a web surface. A mobile screen links to the web guide (or gets a short in-app hint written in the same message files) once the owner decides how help is surfaced.
6. **Mobile never weakens a web rule:** tenant isolation, permission checks and audit are enforced by the API; the app only hides what the person cannot do.

## Decisions needed (owner)

- Is the mobile app a **full-parity** product or a **companion** (inbox, contacts, tasks, notifications first)? This sets the whole backlog. The foundation assumes a companion that grows.
- Is there a WaDesk mobile app (or a responsive web UI on phones) that should be treated as the reference? If so, the "same UI" rule applies to it and this ADR changes.
- Is the Help center expected in the app?

## Consequences

- Mobile work has a rule set it can actually satisfy, and nothing is lost by omission because everything unlisted is `not-planned` on the record.
- The mobile parity check is weaker than the web one (a scripted flow plus human comparison, not an automated twin run). That is stated so nobody assumes otherwise.

## Alternatives considered

- **Apply the web rules verbatim.** There is no mobile reference; the rules would block every screen or be ignored.
- **Exempt mobile entirely.** Reintroduces the exact failure the rules exist to prevent (features lost, behaviour that differs by client).
- **Extend `wadesk-playwright-parity` to mobile now.** Needs a decision on the reference and a device farm or emulator pipeline; premature before the first feature exists.

## Revisit when

- the first mobile feature is ported (check that the Maestro flow plus manual comparison is workable, or automate more of it);
- the owner answers the questions above.
