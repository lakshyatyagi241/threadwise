# Working in `apps/mobile`

Read automatically when you work in this folder. The repo-wide rules in `../../CLAUDE.md` and `../../CONTRIBUTING.md` still apply (porting rules, the pre-pr gate, nothing committed unless asked). This app is translated into the web's 21 languages plus Marathi (`src/lib/i18n/locales.ts`, 22 files in `src/messages/`).
Why the app is built this way: `../../docs/adr/0021` to `0027`. Start with `../../docs/mobile/README.md`.

## Expo changes fast: do not trust memory

This is Expo SDK 57 / React Native 0.86. Before writing code that touches an Expo, EAS or React Native API: read the `expo` major in `package.json`, then fetch the matching docs
(`https://docs.expo.dev/versions/v57.0.0/`) or the index at `https://docs.expo.dev/llms.txt`. Never answer an Expo API question from memory.

- Add libraries with `npx expo install <package>` (SDK-pinned versions), then run the `mobile-native-capability` skill if the library has native code.
- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them; configure native behaviour in `app.config.ts` or a config plugin.
- Expo Go cannot run this app. Use a development build.

## Use the mobile skills

| Task                                                            | Skill                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| bring a product feature to the app                              | `mobile-feature-port` (entry point; chains the others)                      |
| add a route/screen                                              | `mobile-new-screen`                                                         |
| fetch or send data                                              | `mobile-api-call`                                                           |
| sign-in, tokens, sign-out, account gates, deep links            | `mobile-auth-session`                                                       |
| any text change                                                 | `mobile-i18n-sync`                                                          |
| camera, push, files, biometrics, a permission, a native library | `mobile-native-capability`                                                  |
| tests                                                           | `mobile-test`                                                               |
| before a PR: accessibility, performance, security, store policy | `mobile-quality-review`                                                     |
| the gate                                                        | `mobile-pre-pr` (`bash ../../.claude/skills/mobile-pre-pr/scripts/gate.sh`) |
| EAS build, submit, OTA update                                   | `mobile-release`                                                            |
| first time here                                                 | `mobile-setup`                                                              |

When a skill says "invoke the X skill", do it with the Skill tool.

## Rules the tooling enforces (do not work around them)

Each of these fails `pnpm lint`, `pnpm arch` or a test, and the error names the replacement.

- Layers: `app` → `features` → `components` → `lib` → `config`, downwards only; a feature never imports another feature; no cycles. Use the `@/` alias, never `../`.
- API: only `apiFetch` (`@/lib/api`); global `fetch` is an error. Parse with the `@crm/contracts` schema. Branch on `ApiError.code`, never on message text. Mutations carry an `Idempotency-Key`.
- Credentials: only `lib/auth/token-store` (keychain). No AsyncStorage / MMKV. Never log, store, or put in a URL a token, password, code or message body.
- Text: `Text`/`TextField` from `@/components/ui`, never the React Native ones. No literals in JSX or in `label`/`placeholder`/`accessibilityLabel`; use `t()`; all 22 languages in the same change (`mobile-i18n-sync`).
- Style: theme tokens only (`useTheme()`, `@/lib/theme/tokens`); no hex colours; tap targets ≥ 48; every control has a role and a name.
- Config: `@/config/env` only; no `process.env` elsewhere. No secret in an `EXPO_PUBLIC_*` variable.
- Imports: no `next`, `react-dom`, `@crm/ui`, `@crm/db`, `@crm/api`.
- No `console.*`; use `log` from `@/lib/observability/logger`.

## Done means

`bash ../../.claude/skills/mobile-pre-pr/scripts/gate.sh` passes (add `--full` before a release), tests were written with the code, text is translated into all 22 languages, and the screen was run on an emulator or device (state in your
report which, or say it was not run). Do not claim a screen works from a passing test alone.
