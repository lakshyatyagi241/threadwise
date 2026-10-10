# Testing the mobile app

Gates and reasons: [ADR-0025](../adr/0025-mobile-quality-gates.md). This page is how.

## The three layers

| Layer              | Tool                                                       | Lives in                               | Runs                                               |
| ------------------ | ---------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Unit and component | jest-expo, React Native Testing Library                    | `src/**/*.test.ts(x)` next to the code | every PR (`pnpm --filter @crm/mobile test`)        |
| Compile / bundle   | `expo export`                                              | —                                      | every PR (`bundle:check`)                          |
| End to end         | Maestro against a development build and a seeded local API | `apps/mobile/.maestro/*.yaml`          | before each store release, and when a flow changes |

## Writing a component or screen test

- Render the real screen inside the providers it needs (`I18nextProvider` after `initI18n('en')`; `QueryClientProvider` with `retry: false` if it fetches).
- Act like a person: `screen.getByLabelText('Email')`, `getByRole('button', { name: 'Sign in' })`, `fireEvent.changeText`, `fireEvent.press`; then assert what is **on screen** with `findBy…`/`waitFor`.
- Fake only the edge: mock the feature's `./api` module (`jest.mock('./api')`) for a screen test, or script `fetch` with `src/test/fetch-mock.ts` to also exercise the API client and contract parsing.
- Use real English text from the message file in assertions; a test that breaks when copy changes is doing its job.
- Cover: the happy path, validation, each error code the screen handles, the loading and error states, and the empty state. For a list: pagination (`hasMore`) and pull-to-refresh.
- Do not use snapshots, `testID` when a role or label exists, or arbitrary `setTimeout`/sleep.

```tsx
const { findByText } = render(
  <Providers>
    <InboxScreen />
  </Providers>,
);
expect(await findByText('Acme Ltd')).toBeTruthy();
```

## Testing the API layer

`src/lib/api/client.test.ts` and `src/lib/auth/session-manager.test.ts` are the model: queue responses with `mockFetch(jsonResponse(…), new TypeError('Network request failed'))`, call the real code, assert the
requests that went out (`calls[n].headers`, `.body`) and the state after. Anything touching tokens, rotation or sign-out needs a test of the offline case and the "ended while in flight" case.

## End-to-end flows (Maestro)

Install Maestro (https://maestro.dev), start a development build on an emulator or simulator and the local stack (`pnpm infra:up`, `pnpm dev`, `pnpm db:seed`), then:

```bash
maestro test apps/mobile/.maestro -e APP_ID=ai.geta.crm.dev -e E2E_EMAIL=<seeded email> -e E2E_PASSWORD=<seeded password>
```

The seeded logins are in `docs/runbooks/local-development.md`. Never commit credentials into a flow; pass them with `-e`. A new feature adds `apps/mobile/.maestro/<feature>.yaml` with the same scenario as its web parity run (ADR-0027).
Select elements by visible text or accessibility label, never by coordinates.

## Manual checks before a release

On one real iPhone and one real Android phone, with the production-like `preview` build: sign in and out, kill the app and reopen (still signed in), airplane mode during a request and after, a large system font, dark mode, an
RTL language, VoiceOver/TalkBack through the main flow, rotate (if enabled), a slow connection. The release runbook has the checklist.

## Flaky tests

A flaky test is a bug in the test or in the code. Fix it or delete it with a note; never retry it into silence.
