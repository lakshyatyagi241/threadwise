# Mobile app handover

Written when the foundation was finished (2026-10-10). Read this first, then [README.md](README.md).

## What exists

A working, tested skeleton, not a product:

- Sign-in against the real API: password, the authenticator-code step, and the workspace pick; sign-out; the signed-in "home" screen that loads `GET /v2/auth/session`.
- Secure token storage (OS keychain), one shared token rotation, offline-safe behaviour (tests in `src/lib`).
- API client with contract parsing, problem+json errors, `Idempotency-Key`, `X-Request-Id`, request timeout, transient retry.
- All text through i18next in the web app's 21 locales, with typed keys and a completeness check.
- Light and dark theme from design tokens; accessible shared components (`Text`, `TextField`, `Button`, `Screen`).
- Three installable variants (development, preview, production), EAS build profiles, OTA update configuration.
- Quality gates (ADR-0025): lint rules that encode the architecture, layer checks, 74 tests with coverage floors, i18n and env checks, a Metro bundle check, a CI workflow.
- Seven ADRs (0021-0027), runbooks, and eleven project skills plus a reviewer subagent.

Verified in the session that built it: typecheck, lint, layer check, 74 tests (91% statement coverage), i18n check, and a production-mode Metro export of both iOS and Android (Hermes bytecode).
**Not verified** (no device, no accounts available): running the app on a phone or emulator, an EAS build, a store submission, an OTA update, Sentry reporting, the Maestro flows. Do these first; see "First week".

## Decisions needed before the first store build

These are the owner's, and several block store submission. Nothing in the code can answer them.

| #   | Decision                                                                                           | Why it blocks                                                              | Where it lands                                          |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **Store identity**: bundle id / package name (placeholder `ai.geta.crm`), app name, publisher name | cannot change after the first upload                                       | `app.config.ts` (`APP_BUNDLE_ID`, `APP_NAME`), ADR-0026 |
| 2   | **Accounts**: Apple Developer Program, Google Play Console, Expo (EAS) organisation                | builds and submissions need them; Apple and Google verification takes days | [mobile-store-setup](../runbooks/mobile-store-setup.md) |
| 3   | **Scope**: full parity or companion app, first features in order                                   | sets the backlog                                                           | ADR-0027, [backlog.md](backlog.md)                      |
| 4   | **CAPTCHA at sign-in**: how the app gets past it (or an exemption)                                 | a workspace with CAPTCHA on cannot sign in from the app                    | ADR-0023 (needs API work)                               |
| 5   | **Social sign-in** on mobile                                                                       | Google/Apple/etc. flows are browser redirects today                        | ADR-0023 (needs API work)                               |
| 6   | **Minimum-version check** and support window                                                       | the only way to retire old app versions                                    | ADR-0026 (needs API work + contract code)               |
| 7   | **Branding**: real icon, adaptive icon, splash, colours                                            | the current assets are Expo placeholders, the palette is a placeholder     | `assets/images/`, `src/lib/theme/tokens.ts`             |
| 8   | **Error reporting**: a Sentry project (or another tool)                                            | reporting is off until `EXPO_PUBLIC_SENTRY_DSN` is set                     | `.env`, EAS environment variables                       |
| 9   | **Privacy**: privacy policy URL, Apple privacy labels, Google Data safety answers                  | required by both stores                                                    | store consoles                                          |
| 10  | **Push notifications**: which events, and the API for device tokens                                | needs a table with RLS, a worker job, and FCM/APNs credentials             | `mobile-native-capability` skill                        |

## Known gaps in the foundation (all intentional, all on the backlog)

- No screens for the account gates the API enforces after sign-in: forced password change, MFA enrolment, unverified email, onboarding, suspended workspace. A gated account signs in and then sees errors. **Do these before any other feature.**
- No sign-up, forgot-password, social sign-in or passkey sign-in (the API supports them; the web has them).
- A refresh response lost on a bad connection can force a sign-in after 30 s (ADR-0023, open item).
- No push, realtime, offline cache, deep-link handling beyond the scheme, or biometric lock.
- Brand assets and palette are placeholders. `bundle id` is a placeholder.
- The Maestro flow is written but has never been run.

## First week

1. Read ADR-0021 to 0027 (about an hour). Skim `docs/threadwise-port/PORTING_RULES.md`.
2. Follow [local development](../runbooks/mobile-local-development.md) until you can sign in on an emulator against your local API. Fix the runbook where it is wrong; it was written without a device.
3. Run `bash .claude/skills/mobile-pre-pr/scripts/gate.sh --full`. Everything should pass. If not, fix that first.
4. Create the Expo organisation and project (`eas init`), set `EAS_PROJECT_ID`, run a `development` build for Android through EAS, install it, and sign in. Then do iOS.
5. Build the account-gate screens with the `mobile-feature-port` skill. They exercise the whole stack and unblock real accounts.
6. Ask the owner the questions in the table above; record each answer in the matching ADR.

## How to work

- Every task starts with a skill. Say what you want in plain words ("add the inbox list screen", "text changes", "build a preview release") and Claude Code picks it up; or name it: `/mobile-feature-port`.
- Do not fight a lint error. Its message names the right replacement and the ADR. If a rule is wrong, change the rule in an ADR PR, not with a disable comment.
- Never edit `ios/` or `android/`. They do not exist in git; they are generated.
- Never put a secret in `.env` under an `EXPO_PUBLIC_` name, in `eas.json`, or in chat. Secrets live in EAS and GitHub secrets.
- Nothing is committed or pushed unless the owner asks (repository rule).
