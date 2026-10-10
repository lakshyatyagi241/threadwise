---
name: mobile-release
description: >-
  Build, sign, submit and update the mobile app with EAS: a development/preview/production build, a TestFlight or Play internal release, an OTA update
  (eas update), a store submission, a phased rollout, a rollback, bumping the app version, or setting EAS environment variables. Use when asked to "ship the
  app", "release", "publish to the store", "push an update", "build a preview for testers", "roll back the app", or "set the API URL for production". Decides OTA
  vs store release, runs the gate first, and never publishes, submits or changes store/EAS state without the owner saying so in this conversation.
---

# Release the mobile app

Design: `docs/adr/0026-mobile-release-and-versioning.md`. Procedure and checklists: `docs/runbooks/mobile-release.md`. Accounts and first submission: `docs/runbooks/mobile-store-setup.md`.
Building, submitting and publishing change shared external state (EAS, TestFlight, the stores, devices in the field). **Do none of it unless the owner asked for that specific action in this conversation**; prepare, check and explain otherwise.

## 1. What kind of release is this?

OTA update only if the change is JavaScript/assets only: no new native module, config plugin, permission, `app.config.ts` native setting, Expo SDK change or `version` bump. Otherwise a store release. If unsure, store release. Look at the diff since the last release tag (`git diff mobile-v<last>...HEAD -- apps/mobile`).

## 2. Always first

```bash
bash .claude/skills/mobile-pre-pr/scripts/gate.sh --full
```

Also confirm: the API/contracts the app needs are deployed and backward compatible with every supported app version (ADR-0026); the privacy answers still match (if a permission or data type was added: `mobile-native-capability`); the release notes are written.

## 3. Configure (once, then rarely)

`cd apps/mobile && npx eas-cli login`; `npx eas-cli init` (project id → `EAS_PROJECT_ID`); environment variables per environment with `npx eas-cli env:set --environment <development|preview|production> --name <NAME> --value <value> --visibility plaintext`
(`EXPO_PUBLIC_API_URL` is required for preview and production; `APP_BUNDLE_ID`; `EXPO_PUBLIC_SENTRY_DSN`). Check `eas.json` profiles against ADR-0026. Never put a secret in a plaintext variable or in git.

## 4a. OTA update

```bash
cd apps/mobile
npx eas-cli update --channel preview --message "<what and why>"       # verify on a preview build
npx eas-cli update --channel production --message "<what and why>"    # only from main
```

Verify on a real device (open twice). Rollback: `npx eas-cli update:rollback` (or `update:republish` of the previous group).

## 4b. Store release

1. Bump `version` in `app.config.ts` (PR).
2. `npx eas-cli build --profile production --platform all` (or the `Mobile release` workflow).
3. Install the build (TestFlight / Play internal) and run the manual checks in the release runbook.
4. `npx eas-cli submit --profile production --platform all`.
5. After approval, phased rollout (iOS phased release; Android staged 10% → 50% → 100%); watch crashes and sign-in success between steps.
6. Tag `mobile-v<version>`.

## 5. Report

What was released (profile, version, build numbers, update group id, channel), what was checked and on which devices, and what was not. Nothing is pushed or tagged unless the owner asked.
