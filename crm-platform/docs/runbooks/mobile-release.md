# Mobile: releasing

Design: [ADR-0026](../adr/0026-mobile-release-and-versioning.md). Accounts and first submission: [mobile-store-setup](mobile-store-setup.md). The `mobile-release` skill walks Claude Code through this page.

## Which kind of release?

| The change                                                                                                                | Release                     | Review wait             |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------- |
| Text, layout, logic, a fix in JavaScript only; no new native module, plugin, permission or `app.config.ts` native setting | **OTA update** (EAS Update) | none                    |
| Anything native, an Expo SDK upgrade, a new permission, a new `version`                                                   | **Store release**           | hours to days per store |

If unsure, it is a store release. An OTA update that needs native code that the installed binary lacks cannot happen: `runtimeVersion` is the app `version`, so updates only reach binaries of the same version.

## Before either

1. `bash .claude/skills/mobile-pre-pr/scripts/gate.sh --full` is green on `main`.
2. Contracts and API are deployed and **backward compatible with every supported app version** (ADR-0026). An API change that breaks the released app ships in two steps.
3. Nobody is mid-change on `main` in `apps/mobile`.

## OTA update

```bash
cd apps/mobile
npx eas-cli update --channel preview --message "<what and why>"        # test it on a preview build first
npx eas-cli update --channel production --message "<what and why>"     # only from main, after the preview check
```

Verify on a real device (force-close and reopen twice: the first launch downloads, the second runs it). Roll back: `npx eas-cli update:republish` of the previous update, or `eas update:rollback`. Record the update in the release log.

## Store release

1. Bump `version` in `app.config.ts` (semver; patch for fixes, minor for features). Commit through a PR like any change.
2. Run the manual `Mobile release` workflow (Actions → Mobile release → `production`, `build`) or locally: `npx eas-cli build --profile production --platform all`. Build numbers increment automatically.
3. Install the build through TestFlight / the Play internal track and run the **manual checks**:
   - sign in (password; also an MFA account and a multi-workspace account), kill and reopen (still signed in), sign out;
   - airplane mode during a request and while idle; the error and the recovery;
   - large system font, dark mode, one right-to-left language, VoiceOver and TalkBack through the main flow;
   - the features changed in this release, on both platforms;
   - the privacy answers still match what the app collects.
4. Submit: `npx eas-cli submit --profile production --platform all` (or the workflow's `submit` step). Answer the export-compliance and content questions as in the previous release.
5. When approved, **phased rollout**: iOS "phased release for automatic updates" (7 days); Android staged rollout 10% → 50% → 100%, watching crash reports and sign-in success between steps.
6. Tag the release (`mobile-v<version>`) after the first step reaches users, and note anything unusual in the release log.

## When it goes wrong

| Problem                                | Do                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad OTA update                         | republish the previous update (above); fix forward                                                                                                                           |
| Bad store release, still rolling out   | halt the phased release / staged rollout in the console; submit a fixed build; use an OTA update for a JavaScript-only fix once the fixed binary is the base                 |
| Everyone signed out / cannot sign in   | check the API and the auth endpoints first (this is rarely the app); `AUTH_*` codes in Sentry; ADR-0023 open items (CAPTCHA enforced, refresh grace)                         |
| Old versions break after an API change | the API change was not backward compatible: restore the old behaviour, then ship in two steps                                                                                |
| Rejected by review                     | read the rejection, fix, resubmit; the usual causes are the demo account, privacy answers, a missing "Sign in with Apple" next to other social logins, and crashes on launch |
