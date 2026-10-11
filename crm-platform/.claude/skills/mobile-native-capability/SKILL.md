---
name: mobile-native-capability
description: >-
  Add anything native to the mobile app (apps/mobile): an Expo or third-party library with native code, a device capability (camera,
  photos, files, contacts, location, microphone, biometrics, push notifications, deep/universal links, share sheet, background tasks), or a
  permission. Use before running `expo install`, before editing app.config.ts plugins, and when asked to "add push notifications",
  "use the camera", "scan a QR code", "pick a file", "add Face ID". Covers SDK-compatible install, config plugins, the development-build rebuild,
  iOS usage strings, Android permissions, store privacy answers, and the OTA/runtimeVersion consequence. Never edit ios/ or android/.
---

# Add a native capability

Native code changes what a binary can do, so it changes the release type (a store release, not an OTA update) and the store privacy answers. Decisions: ADR-0022, ADR-0026.

## Steps

1. **Is there an Expo module?** Prefer `expo-*` from the SDK (Expo docs: `https://docs.expo.dev/versions/v57.0.0/` and `https://docs.expo.dev/llms.txt`; do not rely on memory). A non-Expo library with native code needs a reason in the PR (no Expo module does it) and a check that it supports the New Architecture and the config-plugin workflow.
2. **Read the library before adding it:** maintainer, last release, open security issues, install scripts, what permissions and native dependencies it adds, size. Say what you found.
3. **Install SDK-pinned:** `cd apps/mobile && npx expo install <package>` (never plain `pnpm add`; it would pick a version the SDK does not support). Then `pnpm --filter @crm/mobile deps:check`.
4. **Configure native behaviour only through `app.config.ts`:** add the library's config plugin to `plugins`, with options (permission strings go here: `cameraPermission`, `NSFaceIDUsageDescription` through `ios.infoPlist`, etc.). `ios/` and `android/` are generated; never edit or create them.
5. **Permission strings** are shown to the person by the OS: write a specific reason ("To attach a photo to the conversation"), not "needed for the app". They are English unless localised; decide with the owner whether to localise them (Expo supports localised native strings through the `locales` field of the app config; read the current docs before using it).
6. **Ask for the permission at the moment of use**, handle "denied" and "denied permanently" (offer the system settings), and never block unrelated features on it. Put the explanatory text through `t()` (`mobile-i18n-sync`).
7. **Rebuild the development build** (`pnpm --filter @crm/mobile android`, or `eas build --profile development`) and tell the team: the old dev client lacks the module ("native module not found").
8. **Store consequences** (write them in the PR): a new permission or collected data type changes Apple's privacy nutrition labels and Google's Data safety form, and may need a privacy-policy update. List them for the owner; the release runbook checks them.
9. **Release consequence:** this is a new binary, so bump `version` in `app.config.ts` for the next store release; an OTA update cannot carry it (`runtimeVersion` = `version`).
10. **Test:** unit-test your wrapper with the module mocked in `jest.setup.ts` (the smallest honest fake); verify the real behaviour on a device, on both platforms, and say which you ran.

## Push notifications (needs API work first)

Expo Notifications plus FCM (Android) and APNs (iOS). Order: (1) API: a tenant-scoped device-token table with RLS, register/unregister endpoints, a worker job that sends (`add-migration`, `new-module`, `contracts-change`, `worker-job`, `provider-adapter` skills), (2) credentials: FCM service account and APNs key in EAS (`eas credentials`), (3) the app:
`expo-notifications` plugin, permission prompt at a sensible moment (not on first launch), register the token after sign-in and unregister on sign-out (`lib/auth/sign-out.ts`), handle a notification tap by opening the right screen through the deep-link rules (a notification never performs an action).
Background handling while the phone is locked cannot read the session from the token store (ADR-0023: unlocked-only keychain), so a notification handler must not depend on calling the API in the background; design for it.

## Never

Hand-edit `ios/` or `android/`; add a library with `pnpm add`; request a permission "just in case" at launch; ship a permission string you did not write for the actual use; skip the privacy-answers note.
