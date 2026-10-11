# ADR-0026: Mobile release, versioning and minimum supported version

- **Status:** proposed (the build profiles are in the repo; the store identities and accounts are decisions for the owner — see `docs/mobile/handover.md`)
- **Date:** 2026-10-10

## Context

Web deploys replace every user at once. A mobile release does not: it goes through Apple and Google review, users update when they like, and old versions keep calling the API for
months. The API therefore serves several app versions at once, and the project needs a way to ship urgent JavaScript fixes without waiting for review, a way to retire versions that
can no longer work, and a way to keep a development build, a tester build and the store app on one phone without confusing them.

## Decision

**Three installable variants** from one codebase, chosen by `APP_VARIANT` in `app.config.ts` and the EAS build profile of the same name:

| Variant     | Bundle id / package | Name            | Scheme        | Distribution                         | Update channel |
| ----------- | ------------------- | --------------- | ------------- | ------------------------------------ | -------------- |
| development | `<base>.dev`        | "CRM (Dev)"     | `crm-dev`     | dev client, internal                 | `development`  |
| preview     | `<base>.preview`    | "CRM (Preview)" | `crm-preview` | internal (TestFlight / internal APK) | `preview`      |
| production  | `<base>`            | "CRM"           | `crm`         | App Store, Google Play               | `production`   |

`<base>` is a placeholder (`ai.geta.crm`, overridable with `APP_BUNDLE_ID`) until the owner picks the store identity. **It cannot change after the first store upload.**

**Configuration per environment** (the API URL above all) is an EAS environment variable per profile (`eas env:set`), never a file in git. `app.config.ts` fails the build if a
preview or production build has no `EXPO_PUBLIC_API_URL`, or a production one that is not `https://`. Development builds alone may use cleartext HTTP to a local API.

**Versions.** `version` in `app.config.ts` is the marketing version (semver). Build numbers (`versionCode`, `buildNumber`) are assigned by EAS (`appVersionSource: remote`, `autoIncrement` on production).
Bump `version` for every store submission. A change that needs a new native module or a new permission is a new `version` (a store release); the `runtimeVersion` policy `appVersion` makes
an over-the-air update reach only binaries built from the same `version`, so an update can never land on a binary that lacks the native code it expects.

**Over-the-air updates (EAS Update)** carry JavaScript and assets only. Use them for fixes and copy changes between store releases. Rules: published to `preview` first, to `production`
only from `main`, never to bypass store review for a change in what the app does with permissions or user data (that is a policy matter with Apple and Google, not only a technical one).
Roll back with `eas update:republish` of the previous update (or `eas update:rollback`); a bad store release is stopped by halting the phased rollout in the store console.

**Releases to the stores** go through the `mobile-release` skill and the manual `Mobile release` workflow (`workflow_dispatch`): quality gate, then `eas build --profile production`,
then `eas submit` for TestFlight and the Play internal track, then a smoke test on a real device of each platform, then promote with a **phased rollout** (iOS automatic phased release;
Android staged rollout starting at 10%). The first submission of each store is done by hand to complete the listing, privacy nutrition labels (Apple) and Data safety form (Google).

**Minimum supported version.** Every request carries `X-App-Platform`, `X-App-Version` and `X-App-Build` (ADR-0023). The API compares `X-App-Version` with a configured minimum per platform
and answers an app that is too old with HTTP 426 and a problem+json code `APP_UPDATE_REQUIRED` carrying the store URL. The app shows a blocking "update required" screen. Support window
(proposal): the API supports the last **two minor versions or 90 days**, whichever is longer, and an API change that would break a supported version ships in two steps (add, then remove after the window). _Needs API work and a new error code in `@crm/contracts`; until then the contract-mismatch screen is the safety net._

**Secrets and accounts.** `EXPO_TOKEN` (a robot user's access token) is a GitHub Actions secret; Apple and Google signing credentials live in EAS (managed credentials), not in the repo, a developer
laptop or a chat. Anything credential-shaped is already gitignored (`*.p8`, `*.p12`, `*.jks`, `*.keystore`, `*.mobileprovision`).

## Consequences

- A developer can install a dev build, a preview build and the store app side by side.
- The first store release takes calendar time (accounts, review, listing) that no code can shorten; start the accounts early (`docs/runbooks/mobile-store-setup.md`).
- The API gets a standing compatibility obligation (the support window) and a small new feature (minimum-version check).
- OTA updates add power and risk; the rules above keep them to fixes.

## Alternatives considered

- **Store release for every change.** Safest and slowest; a one-word fix would take days.
- **`runtimeVersion` as a manually bumped string.** Easy to forget; the `appVersion` policy cannot be forgotten.
- **Fingerprint runtime version.** Computes the runtime from the native project automatically and is attractive once the team trusts it; revisit after the first few releases.
- **One variant only.** A tester could not keep the store app and a pre-release build, and a dev build could talk to production data by mistake.

## Revisit when

- releases become frequent enough to want EAS Workflows or a staged channel promotion process;
- the support window proves too long or too short;
- the owner chooses the store identity and accounts (update the table and the runbook).
