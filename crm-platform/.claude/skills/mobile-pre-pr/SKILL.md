---
name: mobile-pre-pr
description: >-
  Run the mobile gate before opening a PR for anything in apps/mobile (or a contract change the app consumes): format, TypeScript, ESLint with the
  mobile architecture rules, dependency-cruiser layers, tests with coverage floors, 21-locale completeness, public-env secret scan, and (with --full)
  Expo SDK compatibility, expo-doctor and a real iOS+Android Metro bundle. Use when asked "is the mobile change ready", "run the mobile checks",
  "open a PR for the app", or after finishing any mobile work. Same checks as the Mobile CI workflow, so a green gate means a green PR.
---

# Mobile pre-PR gate

```bash
bash .claude/skills/mobile-pre-pr/scripts/gate.sh           # everyday: format, types, lint, layers, tests+coverage, translations, env
bash .claude/skills/mobile-pre-pr/scripts/gate.sh --full    # before a release or an SDK/native change: + SDK versions, expo-doctor, iOS+Android bundle
```

The repo-wide `pre-pr` gate calls this script with `--extras` when `apps/mobile`, `packages/contracts` or `packages/tax` changed, so for a mixed PR run `bash .claude/skills/pre-pr/scripts/gate.sh`.

## What each failure means

| Failure                      | Meaning and fix                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| build shared packages        | `@crm/tax` / `@crm/contracts` did not compile; fix the contract change first                                                                   |
| format                       | `pnpm exec prettier --write apps/mobile`                                                                                                       |
| typecheck                    | usually a contract changed under you, a missing translation key in a `t()` call (keys are typed from `en.json`), or a route typo               |
| lint                         | the message names the replacement and the ADR; do not add a disable comment, change the code (or propose an ADR change if the rule is wrong)   |
| layers                       | a feature imported another feature, `lib` imported up, or a cycle: move the shared code down a layer                                           |
| tests and coverage floors    | a failing test, or coverage under the floor (global 85/75/80/85, `src/lib` 90/80/85/90). Add tests; never lower the floor to merge             |
| translations                 | `i18n:check` lists the locale and key; use the `mobile-i18n-sync` skill                                                                        |
| no secrets in EXPO_PUBLIC_*  | rename or remove; secrets belong to the server or EAS secrets                                                                                  |
| Expo SDK-compatible versions | `cd apps/mobile && npx expo install --fix` (and read what changed)                                                                             |
| expo-doctor                  | read its message; common causes are a missing `.gitignore` entry or a duplicate native module                                                  |
| bundle                       | Metro cannot resolve/compile: often an import of a web-only or Node-only package, or `@crm/contracts` using something the Hermes runtime lacks |

## After it passes

State plainly in the PR: what ran (default or `--full`), whether the change was run on an emulator/device (which), and anything not verified. Do not commit or push unless the owner asked (repository rule). For a branch that changes the API or contracts too, the repo-wide gate still applies.
