# ADR-0025: Mobile quality gates — what must pass before a mobile change merges or ships

- **Status:** proposed (implemented in the foundation)
- **Date:** 2026-10-10

## Context

A mobile release cannot be taken back the way a web deploy can: the store review delays a fix by hours to days, and old versions stay installed for months. A junior developer will
own the app. Quality therefore has to be enforced by commands that fail, not by memory. The repo already has a gate (`bash .claude/skills/pre-pr/scripts/gate.sh`) that mirrors CI.

## Decision

Every mobile change passes all of the following. Locally they are one command (`bash .claude/skills/mobile-pre-pr/scripts/gate.sh`, called by `pre-pr` when `apps/mobile` changed); in CI they
are the `Mobile` workflow (`.github/workflows/mobile-ci.yml`), path-filtered.

| Gate                     | Command (`pnpm --filter @crm/mobile …`)                         | What it protects                                                                      |
| ------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Format                   | `prettier --check apps/mobile`                                  | one style, no review noise                                                            |
| Types                    | `typecheck` (TypeScript strict, typed `t()` keys, typed routes) | contract drift, missing translations keys                                             |
| Lint                     | `lint` (root ESLint + `eslint.mobile.config.mjs`)               | the architecture rules of ADR-0021, 0023, 0024                                        |
| Layers                   | `arch` (dependency-cruiser)                                     | feature isolation, no cycles                                                          |
| Unit and component tests | `test` (jest-expo, React Native Testing Library)                | behaviour; controls found by role and name                                            |
| Coverage floor           | `test:coverage` (global 85/75/80/85, `src/lib` 90/80/85/90)     | the security-relevant logic stays tested                                              |
| Translations             | `i18n:check`                                                    | all 21 locales complete, no English left, placeholders intact                         |
| Public env               | `env:check`                                                     | no secret in an `EXPO_PUBLIC_*` variable                                              |
| SDK compatibility        | `deps:check` (`expo install --check`) and `expo-doctor`         | library versions match the Expo SDK                                                   |
| Bundle                   | `bundle:check` (`expo export` for iOS and Android)              | Metro resolves the monorepo and `@crm/contracts`; the app compiles to Hermes bytecode |

Rules of the road:

1. **No `eslint-disable`, `@ts-ignore` or `@ts-expect-error` without a comment that names the reason**, and never to get around a rule from ADR-0023 or ADR-0024 (those need an ADR change).
2. **Behaviour tests, not snapshots.** A test renders the screen, acts like a person (find by role and name, type, press) and asserts what is on screen and what was sent. Snapshot tests are not used.
3. **Fakes at the edge only.** Native modules and `fetch` are faked (`jest.setup.ts`, `src/test/fetch-mock.ts`); the API client, session manager and contract parsing run for real in tests.
4. **End-to-end flows (Maestro)** live in `apps/mobile/.maestro/` and are run against a development build and a seeded local API before each store release (`docs/mobile/testing.md`).
   They are not a per-PR gate: they need a simulator or emulator and a seeded backend. The smoke flow (sign in, see the home screen, sign out) is the minimum.
5. **Accessibility** is checked in review with the `mobile-quality-review` skill (tap targets, roles, names, font scaling, contrast against the tokens, screen-reader order) and on a real device with the screen reader before a release.
6. **Performance** is checked in review (lists, re-renders, image sizes, startup work) and the production bundle size is recorded by `bundle:check`; a PR that grows it by more than 10% says why.
7. **Dependencies:** installed with `npx expo install` (SDK-pinned) or, outside the Expo set, with the reason in the PR. Weekly Dependabot PRs are grouped; Expo-pinned packages are not bumped independently (they are ignored in `dependabot.yml` and moved by an SDK upgrade).

## Consequences

- A new contributor gets an immediate, specific failure instead of a review comment three days later.
- The gate takes a few minutes locally. The expensive parts (`bundle:check`, `expo-doctor`) run in CI on every PR and locally on request (`--full`).
- Coverage floors are floors: a PR that lowers them fails. Raise them as the codebase grows; never lower them to merge.

## Alternatives considered

- **Detox / Maestro on every PR.** Needs an emulator and a seeded API per run; slow and flaky for the value at this stage. Kept as a pre-release gate.
- **Snapshot tests.** Break on every style tweak and are approved without being read. Rejected.
- **Only CI, no local gate.** Slower feedback and more broken PRs for a junior developer. The local gate and CI run the same commands.

## Revisit when

- end-to-end flows become stable and fast enough to run per PR on EAS Workflows or a hosted emulator;
- a gate produces false failures often enough that people route around it (fix the gate, do not skip it).
