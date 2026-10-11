---
name: mobile-test
description: >-
  Write or fix tests for the mobile app (apps/mobile): unit tests, React Native Testing Library component and screen tests, API-layer tests
  with the scripted fetch, and Maestro end-to-end flows. Use whenever mobile code is added or changed ("add tests", "test this screen",
  "why does this test fail", "write the e2e flow", "coverage dropped"), and as a step of every mobile feature. Tests are written with the code,
  find controls by role and name, assert what is on screen and what was sent, and never use snapshots.
---

# Test the mobile app

How and why: `docs/mobile/testing.md`, ADR-0025. Models to copy: `src/features/auth/sign-in-screen.test.tsx` (screen), `src/lib/api/client.test.ts` and `src/lib/auth/session-manager.test.ts` (API and tokens), `src/features/session/home-screen.test.tsx` (query-backed screen).

## What to write for each kind of change

| Change                        | Tests                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A screen                      | render it in its providers; happy path; validation; each error code it handles; loading, error, empty and permission-denied states; sign-out clears its data if it caches any |
| A hook / `api.ts`             | script `fetch`, assert the request (method, path, query, body, `Idempotency-Key`) and the parsed result; the contract-mismatch case; offline                                  |
| `src/lib/auth`, `src/lib/api` | every branch: concurrency, offline, 4xx vs 5xx, ended-while-in-flight. These carry the security-relevant logic and the 90% coverage floor                                     |
| A pure helper                 | plain unit test with edge cases                                                                                                                                               |
| A new user flow               | a Maestro flow in `apps/mobile/.maestro/<feature>.yaml` with the same scenario as the web parity run (ADR-0027)                                                               |

## How

1. File next to the code: `foo.ts` → `foo.test.ts(x)`. Import with the `@/` alias.
2. Render with the providers the screen needs: `I18nextProvider i18n={i18n}` after `await initI18n('en')` in `beforeAll`; `QueryClientProvider` with `new QueryClient({ defaultOptions: { queries: { retry: false } } })` for query-backed screens.
3. Find by role and name (`screen.getByRole('button', { name: 'Sign in' })`) or label (`getByLabelText('Email')`); fall back to text, and to `testID` only for something with no accessible name. If you cannot find a control by role/name, the control is missing its accessibility props: fix the control.
4. Act: `fireEvent.changeText`, `fireEvent.press`. Assert with `await screen.findBy…` / `waitFor`. Assert on the **English strings** from `en.json`.
5. Fakes: feature `./api` module with `jest.mock('./api')` + `jest.mocked(fn).mockResolvedValue(...)`, or `mockFetch(jsonResponse(200, {...}), new TypeError('Network request failed'))` from `@/test/fetch-mock` to also run the API client. Native modules are already faked in `jest.setup.ts`; add a fake there (smallest honest one) for a new native module.
6. Reset between tests: `resetSessionForTests()` and `jest.resetAllMocks()` in `beforeEach` where the test touches the session or module mocks.
7. Run: `pnpm --filter @crm/mobile test` (one file: `pnpm --filter @crm/mobile test -- src/features/x`), coverage floors: `test:coverage`. Never skip or `.only` into the PR; a flaky test is fixed or deleted with a note.

## Maestro

`apps/mobile/.maestro/*.yaml`, run with `maestro test apps/mobile/.maestro -e APP_ID=… -e E2E_EMAIL=… -e E2E_PASSWORD=…` against a development build on an emulator and the local seeded API. Credentials only from `-e`. Select by visible text, label or `id` (testID), never by coordinates. These flows are a pre-release
gate, not per-PR (ADR-0025). If you changed a flow's screen, run the flow and say so; if you could not run it, say that.

## Done when

New and changed behaviour is covered, `test:coverage` passes, no console noise from your tests, and the tests would fail if the behaviour broke (mentally revert the change once to check). Then `mobile-quality-review`.
