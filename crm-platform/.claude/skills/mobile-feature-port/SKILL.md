---
name: mobile-feature-port
description: >-
  The entry point for ANY unit of work in the mobile app (apps/mobile, the iOS and Android app): bringing a product feature to the app
  ("add the inbox to the app", "contacts screen on mobile", "port tasks to the app"), building an account-gate screen, or fixing a mobile
  bug. Use this whenever the request mentions the mobile app, iOS, Android, Expo, React Native, a phone screen, or apps/mobile. It makes
  you read the feature's web wiring map and the API first, decides whether the API already supports it, then chains mobile-new-screen,
  mobile-api-call, mobile-i18n-sync, mobile-test, mobile-quality-review and mobile-pre-pr in order so nothing is skipped. Do not start
  writing a mobile screen without it.
---

# Port a feature to the mobile app

The rules that apply are in `docs/adr/0027-mobile-scope-and-the-porting-rules.md` (behaviour is the contract; the UI is a mobile
adaptation; scope is the backlog) plus the repo-wide ones in `CLAUDE.md` (real wiring, 21 locales, nothing lost silently, nothing committed
unless asked). Read `apps/mobile/CLAUDE.md` for the rules the tooling enforces.

## 1. Find the feature in the backlog

Open `docs/mobile/backlog.md`. The feature is either listed (use its status) or it is not. **If it is not listed, add a row** (status `ready` only if the owner asked for it in this conversation, otherwise `not-planned`) and say so. Never build an unlisted feature silently.
Anything you cannot build now (missing API, owner decision, design) is recorded as `blocked` with the reason. Never drop it.

## 2. Dig before you build

1. The web feature: its contract folder in `packages/contracts/src/<area>/`, its web screens in `apps/web/src/features/<area>/`, its wiring map in `docs/wadesk-port/wiring/` (route, permission, tables, settings, feeders, every place it is used). Use the `wadesk-feature-lookup` skill for the feature id (`WD-…`).
2. The API: the controller(s), the permission keys (`session.permissions`), the error codes it can return (`ERROR_CODES` in `@crm/contracts`), pagination, `rowVersion` on updates, `Idempotency-Key` on sends.
3. What a person does on the web screen, step by step, including empty, error, permission-denied and plan-gated states. Those are the behaviours the app must have.
4. The account gates (`session.flags`) that can stop the person before they reach the feature.

## 3. Does the API already do it?

If the screen needs a route, a field or a permission that does not exist, stop and do that first with the existing skills (`contracts-change`, `new-module`, `add-migration`, `rbac-permission`, `outbox-event`, `worker-job`), with their own parity run
(`wadesk-playwright-parity`). Mobile never gets a private API rule the web does not have. If the work belongs to the owner's decision (ADR-0027 questions), ask before building.

## 4. Build, in this order (invoke each skill with the Skill tool)

1. `mobile-new-screen`: the route, the feature folder, the states.
2. `mobile-api-call`: the data hooks, parsed with contracts, errors by code.
3. `mobile-auth-session` only if the feature touches sign-in, tokens, gates or deep links.
4. `mobile-native-capability` only if it needs a permission, a native library, push, camera or files.
5. `mobile-i18n-sync`: every string, all 21 locales.
6. `mobile-test`: the tests, written with the code, not after. Add the Maestro flow `apps/mobile/.maestro/<feature>.yaml` for the main scenario.
7. Run it for real: on an emulator or device against the local API, and say which in your report. A passing test is not "it works". If you cannot run it (no emulator available), say so plainly.
8. Compare with the web screen for the same account: same data, same permissions, same states. State any intentional mobile difference and why.
9. `mobile-quality-review`, then `mobile-pre-pr`.

## 5. Report

List: what was ported (feature id, web reference), what the app now does, what is `blocked` or deferred and why (and the backlog row), how it was verified (tests, device, comparison), and anything the owner must decide. Update `docs/mobile/backlog.md` in the same change.

## Never

- Port a screen that calls an API route you did not read, or invent a validation rule the contracts do not have.
- Hide a capability to make the phone UI simpler without recording it.
- Mock the API in the app to make a screen "work".
- Add a dependency, permission or data collection without the `mobile-native-capability` checks (store privacy answers change).
