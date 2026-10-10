# Mobile app (iOS and Android)

`apps/mobile` (`@crm/mobile`): an Expo / React Native app that uses the same API and the same `@crm/contracts` as the web app.
Decisions: [ADR-0021](../adr/0021-mobile-app-lives-in-the-monorepo.md) to [ADR-0027](../adr/0027-mobile-scope-and-the-porting-rules.md).

## Start here

| If you want to…                            | Read                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| take over the project                      | [handover.md](handover.md): state, decisions still open, first tasks |
| run the app on a phone or emulator         | [local-development](../runbooks/mobile-local-development.md)         |
| know what to build next                    | [backlog.md](backlog.md)                                             |
| add a screen or a feature                  | the `mobile-feature-port` and `mobile-new-screen` skills (below)     |
| understand how sign-in and tokens work     | [security.md](security.md) and ADR-0023                              |
| add or change text                         | [i18n.md](i18n.md)                                                   |
| write or run tests                         | [testing.md](testing.md)                                             |
| ship a build                               | [mobile-release runbook](../runbooks/mobile-release.md)              |
| set up the Apple, Google and Expo accounts | [mobile-store-setup runbook](../runbooks/mobile-store-setup.md)      |

## How the app is organised

```
apps/mobile/
  app.config.ts        the app's identity and native config (one codebase, three variants)
  eas.json             build profiles: development, preview, production
  eslint.mobile.config.mjs   the architecture rules, enforced as lint errors
  .dependency-cruiser.cjs    the layering rules (app -> features -> components -> lib -> config)
  .maestro/            end-to-end flows
  scripts/             i18n and public-env checks
  src/
    app/               routes (thin: a file re-exports a screen)
    features/<area>/   screens, hooks and API calls of one product area
    components/ui/     shared UI: Text, TextField, Button, Screen
    lib/               api client, auth/session, query client, i18n, theme, observability
    config/env.ts      the only place that reads the environment
    messages/          21 locale files
    test/              test helpers (scripted fetch)
```

The layers may only import downwards, and one feature never imports another. The tooling enforces it, so a mistake fails `lint` or `arch`, not code review.

## Daily commands

Run from `crm-platform/`. `pnpm --filter @crm/mobile <script>` is the same as running `pnpm <script>` inside `apps/mobile`.

| Command                                             | What it does                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm --filter @crm/mobile start`                   | Metro dev server for a development build                                 |
| `pnpm --filter @crm/mobile android` / `ios`         | build and run a development build locally (needs Android Studio / a Mac) |
| `pnpm --filter @crm/mobile typecheck`               | TypeScript strict                                                        |
| `pnpm --filter @crm/mobile lint`                    | ESLint with the mobile architecture rules                                |
| `pnpm --filter @crm/mobile arch`                    | layering check                                                           |
| `pnpm --filter @crm/mobile test`                    | unit and component tests (`test:coverage` adds the coverage floors)      |
| `pnpm --filter @crm/mobile i18n:check`              | all 21 locales complete                                                  |
| `pnpm --filter @crm/mobile bundle:check`            | compile the app for iOS and Android (what the stores will get)           |
| `bash .claude/skills/mobile-pre-pr/scripts/gate.sh` | all of the above, the same as CI                                         |

`@crm/contracts` must be built before the app can typecheck or test (`pnpm --filter @crm/contracts build`); Turborepo does this for you in `pnpm typecheck` / `pnpm test` from the root.

## Working with Claude Code in this app

Open Claude Code in `crm-platform/` (or `apps/mobile/`: its `CLAUDE.md` loads too). The mobile skills in `.claude/skills/` cover each recurring task and call each other:

| Skill                      | Use it when                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `mobile-setup`             | first time on the app: toolchain, `.env`, first development build           |
| `mobile-feature-port`      | bringing a product feature to the app (the entry point; it chains the rest) |
| `mobile-new-screen`        | adding a route and screen                                                   |
| `mobile-api-call`          | fetching or sending data                                                    |
| `mobile-auth-session`      | anything touching sign-in, tokens, sign-out, account gates, deep links      |
| `mobile-i18n-sync`         | after any text change                                                       |
| `mobile-native-capability` | camera, push, files, biometrics, a permission, a native library             |
| `mobile-test`              | writing unit, component or end-to-end tests                                 |
| `mobile-quality-review`    | before a PR: accessibility, performance, security, store policy             |
| `mobile-pre-pr`            | the gate, before opening a PR                                               |
| `mobile-release`           | building, submitting and updating through EAS                               |

The subagent `mobile-reviewer` (`.claude/agents/`) reviews a mobile diff against these rules with fresh eyes.
