# ADR-0022: React Native with Expo (managed workflow, Continuous Native Generation)

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The mobile app must run on iOS and Android and talk to the existing API. The team writes TypeScript and React daily (Next.js web
app, Zod contracts). The app is mostly lists, forms, chat-style conversation views, notifications and settings; it does not need
a custom rendering engine, games, or heavy platform-specific UI. The team has no dedicated mobile engineer and a junior developer
will take over day-to-day work.

## Decision

1. **React Native + Expo**, current SDK at the time of writing: Expo SDK 57, React Native 0.86, React 19.2, TypeScript strict. The New
   Architecture and the Hermes engine are the only supported runtime (Expo SDK 57 has no switch for either).
2. **Continuous Native Generation (CNG).** `ios/` and `android/` are generated from `app.config.ts` and config plugins and are
   never committed or hand-edited (they are in `.gitignore`). Native behaviour is configured in `app.config.ts` or a config plugin.
3. **Development builds, not Expo Go.** The app uses native modules Expo Go does not contain (`expo-secure-store` with a keychain
   accessibility option, `expo-updates`, Sentry). Day-to-day work uses `expo-dev-client` builds produced locally or by EAS Build.
4. **Expo Router** for navigation (file-based routes in `src/app`, typed routes on).
5. **EAS** (Expo Application Services) builds, signs, submits and updates the app (ADR-0026). No Xcode or Android Studio is required
   to ship; one is needed only to run a simulator or emulator locally.
6. **Libraries are chosen from Expo's SDK-pinned set first** and installed with `npx expo install` so versions match the SDK. A library
   outside that set needs a sentence in the PR saying why no Expo module does the job.
7. **SDK upgrades** follow Expo's cadence (about three a year). The app stays within one SDK of the latest. An upgrade is its own PR:
   `npx expo install --fix`, `npx expo-doctor`, the full mobile gate, and a real-device smoke test on both platforms.
8. The React Compiler is enabled (`experiments.reactCompiler`). Code must follow the Rules of React; `eslint-plugin-react-hooks`
   (already in the repo's ESLint config) enforces the parts that can be checked.

## Consequences

- One TypeScript codebase for two platforms, with the same language, tests, linting and contracts as the rest of the repo.
- A new native module means a new development build for everyone (the JS bundle alone is not enough). The `mobile-native-capability`
  skill spells out the steps and the store-policy consequences (permission strings, privacy labels).
- Upgrades are a recurring cost (a few days, three times a year). Skipping them makes the next one much harder; the policy above caps the gap.
- iOS builds need Apple's toolchain, which EAS provides in the cloud; a Windows developer can do everything except run the iOS simulator.

## Alternatives considered

- **Flutter.** Strong rendering and animation story, but Dart: no sharing of `@crm/contracts` (an OpenAPI-generated client would have to
  be kept in sync), a second language and toolchain for a three-person team, and no reuse of the TypeScript review and testing habits.
  Its main advantages (pixel-identical custom UI, heavy animation) are not what this app needs.
- **Bare React Native (no Expo).** Rejected: gives up CNG, EAS Update and the SDK-pinned module set, and puts native project upkeep on
  a team that has no native engineer.
- **Two native apps (Swift + Kotlin).** Rejected: two codebases, two skill sets, twice the feature work for a team of three.
- **Wrapping the web app (Capacitor, a PWA, a WebView shell).** Rejected: the web app is a server-rendered Next.js app behind a cookie
  proxy, and the product needs real push notifications, secure token storage and native-feeling lists. Store review also treats thin
  web wrappers harshly.

## Revisit when

- a feature needs native code that Expo modules and config plugins cannot express (consider a local Expo module before leaving Expo);
- Expo's upgrade cadence stops fitting the release train;
- the app's UI becomes dominated by custom rendering rather than standard lists and forms.
