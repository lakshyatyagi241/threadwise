# ADR-0021: The mobile app lives in the monorepo as `apps/mobile`

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The product needs an iOS and an Android app that use the same backend as the staff web app. `crm-platform` is already a pnpm +
Turborepo workspace (`apps/api`, `apps/web`, `apps/partner`, `packages/contracts`, `packages/db`, `packages/ui`, `packages/tax`, `packages/config`).
Every request and response shape the API validates with lives in `@crm/contracts` as a Zod schema; the web app imports the same
schemas, so a renamed field breaks the web **build** instead of surfacing as `undefined` in a browser. The API already authenticates
with `Authorization: Bearer` and a JSON-body refresh (`POST /v2/auth/refresh`), so a native client needs no new door and no web proxy.
Three people work in parallel on the port, and one PR can already change a migration, a controller, a contract and a screen together.

## Decision

1. The app is the workspace package `@crm/mobile` in `apps/mobile`. It is not a separate repository.
2. It may depend on **`@crm/contracts` only** (which brings `@crm/tax` along). It never imports `@crm/ui` (DOM and Tailwind),
   `@crm/db`, `apps/api` or `apps/web`. ESLint (`apps/mobile/eslint.mobile.config.mjs`) fails the build on each of those.
3. `@crm/contracts` stays free of anything that cannot run in a React Native (Hermes) runtime: no Node built-ins, no DOM. Its only
   runtime dependencies are `zod` and `@crm/tax`. The mobile CI job bundles the app with Metro on every PR (`bundle:check`),
   which is what notices a violation.
4. The mobile app is built, tested and released by its **own CI job**, path-filtered to `apps/mobile/**`, `packages/contracts/**`
   and `packages/tax/**`. A web or API PR does not wait for an iOS build; a contract PR does get the mobile typecheck and tests.
5. Mobile ships on its own release train (ADR-0026). The API never assumes the newest app is the only app in the field.
6. Conventional-commit scope `mobile`. Mobile-specific docs live in `docs/mobile/`; ADRs stay in `docs/adr/`.

## Consequences

- A contract change that breaks the app is caught in the same PR (`pnpm typecheck` runs every workspace through Turborepo).
- The mobile app pins React and React Native to the Expo SDK (`react 19.2.3`), while the web app tracks `react ^19.3`. pnpm keeps them
  in separate dependency trees; code is never shared between the two UI layers, only contracts.
- `pnpm install` for the whole repo now pulls the React Native toolchain. CI caches the pnpm store for this reason.
- Native build output (`ios/`, `android/`) is generated, never committed (ADR-0022), so the repo does not grow Xcode and Gradle noise.
- Because the store builds are slow and gated by Apple and Google, an API change must stay backward compatible for as long as the
  oldest supported app version is in the field (ADR-0026). That is a new constraint on API work, not only on mobile work.

## Alternatives considered

- **A separate `crm-mobile` repository.** Rejected: contracts would have to be published and versioned, or copied. Both drift. Every
  feature would need two PRs in two repos with a manual ordering between them. The only gain (isolated CI) is available with path filters.
- **A separate repository with a published `@crm/contracts` package.** Rejected for now: it adds a registry, a release process and a
  version-skew problem to solve something Turborepo already solves.
- **Sharing UI with the web app (React Native Web, or a shared component package).** Rejected: `@crm/ui` is built on the DOM and
  Tailwind; a phone UI is a different set of components and interactions. Sharing logic through contracts is the part that pays.

## Revisit when

- mobile gets a dedicated team that needs different permissions, review rules or a different release cadence than the platform;
- the contracts package needs independent versioning because several client versions must be served for a long time;
- repository install or CI time becomes a measurable drag (move to remote caching first, split second).
