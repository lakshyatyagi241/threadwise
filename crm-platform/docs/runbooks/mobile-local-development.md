# Mobile app: local development

> Written without a physical device or an emulator at hand. If a step is wrong on your machine, fix this page in the same PR as your fix.

## What you need

| Tool                                                   | Why                                    | Notes                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Node 22 and pnpm 9.15.4                                | the whole repo                         | `.nvmrc` says 22; `corepack enable` provides pnpm                                                                               |
| The backend running locally                            | the app signs in against a real API    | [local-development.md](local-development.md): `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev` (API on port 3000) |
| **Android**: Android Studio (SDK, an emulator), JDK 17 | run on Android locally                 | set `ANDROID_HOME`; create a Pixel emulator with a recent API level                                                             |
| **iOS**: a Mac with Xcode                              | the iOS simulator only exists on macOS | no Mac? build iOS with EAS in the cloud and install through TestFlight / an internal build (see "No Mac" below)                 |
| An Expo account                                        | EAS cloud builds                       | free tier is enough to start; `npx eas-cli login`                                                                               |

**Windows and OneDrive.** This repository sits under `OneDrive\Desktop`. Gradle and Metro create very many small files and long paths there: sync stalls, locked files and `path too long` errors follow. Move the checkout to a short local path
(for example `C:\src\wadesk-port`) or exclude the folder from OneDrive sync, and enable Windows long paths (`git config --system core.longpaths true`, and the `LongPathsEnabled` registry setting).

## First run

```bash
# once, from crm-platform/
corepack enable
pnpm install
pnpm --filter @crm/tax build && pnpm --filter @crm/contracts build   # the app imports the built contracts
cp apps/mobile/.env.example apps/mobile/.env                          # then edit EXPO_PUBLIC_API_URL (below)
```

`EXPO_PUBLIC_API_URL` is how **the phone** reaches your API, not how your computer does:

| Where the app runs            | Value                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Android emulator              | `http://10.0.2.2:3000`                                                        |
| iOS simulator                 | `http://localhost:3000`                                                       |
| A real phone on the same wifi | `http://<your computer's LAN IP>:3000` (allow port 3000 through the firewall) |

Then build and start a **development build** (Expo Go cannot run this app, ADR-0022):

```bash
# Option A, Android locally (Android Studio installed): builds, installs on the running emulator, starts Metro
pnpm --filter @crm/mobile android

# Option B, any platform through EAS in the cloud (no local toolchain):
cd apps/mobile
npx eas-cli build --profile development --platform android      # or ios; download and install the result
pnpm --filter @crm/mobile start                                  # then open the installed "CRM (Dev)" app
```

The first build takes 10 to 20 minutes; later JavaScript changes reload instantly. Rebuild only when a native module, a plugin or `app.config.ts` native settings change (`mobile-native-capability` skill).

Sign in with a seeded account (the seeded logins are listed in [local-development.md](local-development.md)). After sign-in you should see "Hello, <name>" and the workspace name; if you do, token storage, the API client and contract parsing all work.

## No Mac

Everything except the iOS simulator works on Windows or Linux. For iOS: `npx eas-cli build --profile development --platform ios` produces a simulator build for a Mac, or `--profile preview --platform ios` an internal
build installable through TestFlight on a registered device (needs the Apple Developer account, see [mobile-store-setup](mobile-store-setup.md)). Until then, develop and test on Android, and ask someone with a Mac or an iPhone to check iOS-specific behaviour.

## The loop

1. `pnpm --filter @crm/mobile start`, edit, the app reloads.
2. Before a PR: `bash .claude/skills/mobile-pre-pr/scripts/gate.sh` (add `--full` for the bundle and SDK checks).

## When something is wrong

| Symptom                                                                | Cause and fix                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Metro: `Unable to resolve "@crm/contracts"`                            | the package is not built: `pnpm --filter @crm/tax build && pnpm --filter @crm/contracts build`; restart with `npx expo start -c`            |
| "Can't reach the server" on sign-in                                    | wrong `EXPO_PUBLIC_API_URL` for where the app runs (table above), API not running, or firewall; open the URL in the phone's browser to test |
| Works on emulator, not on phone                                        | `localhost` and `10.0.2.2` mean the phone itself or the emulator's host; use the LAN IP                                                     |
| Changed `.env` and nothing happened                                    | `EXPO_PUBLIC_*` is inlined at bundle time: `npx expo start -c`                                                                              |
| `Invariant Violation` / native module not found after adding a library | the dev build predates it: rebuild the development build                                                                                    |
| Strange native build errors after changing plugins                     | `npx expo prebuild --clean` (regenerates `ios/` and `android/`, which are not in git)                                                       |
| iOS: cleartext http blocked                                            | only the development variant may use http; check `APP_VARIANT` is `development`                                                             |
| Sign-in says CAPTCHA/challenge                                         | the workspace enforces CAPTCHA; ADR-0023 open item. Use a workspace without it                                                              |
| Tests fail with "Cannot find module '@crm/contracts'"                  | build contracts (first line of this table)                                                                                                  |
