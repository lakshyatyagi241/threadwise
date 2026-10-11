# ADR-0024: Mobile app architecture — layers, server state, routing, styling, text

- **Status:** proposed (implemented and enforced by tooling in the foundation)
- **Date:** 2026-10-10

## Context

A junior developer takes over this app. The conventions have to be few, mechanical and checked by tooling, or each screen will invent its own.
The web app already settled most of the questions that are not specific to a phone: contracts parsed at the boundary, problem+json errors branched on
`code`, cursor pagination, `Idempotency-Key` on mutations, `X-Request-Id`, 21 locales, no literal text in components (`docs/runbooks`, `frontend-api-call` skill).

## Decision

**Layers** (checked by `pnpm --filter @crm/mobile arch`, dependency-cruiser):

```
src/app         routes: thin files that compose a screen from a feature        -> features, components, lib
src/features    one folder per product area (auth, session, inbox, ...)         -> components, lib, config   (never another feature)
src/components  shared presentational UI (ui/Button, ui/Text, ...)              -> lib, config
src/lib         api, auth, query, i18n, theme, observability                    -> lib, config
src/config      validated environment                                           -> nothing of ours
```

A feature that needs something another feature has moves it down into `components/` or `lib/`. Circular imports fail the build.

**Server state** is TanStack Query and nothing else. Screens use `useQuery`, `useInfiniteQuery` (cursor lists: `?limit=&cursor=`, `page.nextCursor`) and `useMutation`; they never copy
server data into a store. Query keys are arrays starting with the resource (`['session']`, `['contacts', filters]`). Signing out clears the cache. The query client is wired to the phone:
online/offline from NetInfo, focus from the app state.

**Client state** is React state and context. No global store library is installed. When the first piece of state outlives a screen and is not server data, add Zustand in the same PR
and amend this ADR; do not reach for it earlier.

**API access** goes through `apiFetch` only (the global `fetch` is an ESLint error outside `lib/api` and the token rotation). Every response is parsed with the schema from
`@crm/contracts`; a response that does not match becomes `CLIENT_CONTRACT_MISMATCH`, shown as "update the app". Errors are `ApiError` and are branched on `code`, never on message text.
Mutations send an `Idempotency-Key`; a retry of the same user action reuses it.

**Routing** is Expo Router: files in `src/app`, groups `(auth)` and `(app)`, typed routes, access decided by `Stack.Protected` from the session state. Route files only re-export a screen.

**Styling** is React Native `StyleSheet` with design tokens (`lib/theme/tokens.ts`) read through `useTheme()`; light and dark follow the phone. A screen never writes a hex colour (ESLint).
Text is the shared `Text` (type scale, font scaling honoured); inputs are the shared `TextField`; both are the only way to import their React Native counterparts (ESLint).

**Text** is i18next with the same 21 locales as the web app (`src/messages/<locale>.json`), typed keys from the English file, `{{placeholders}}`. JSX text literals and literal
`label`/`placeholder`/`accessibilityLabel` props are ESLint errors. `pnpm i18n:check` fails when a locale lacks a key, keeps the English text, or changes a placeholder. The
language follows the phone's preferred languages; right-to-left layout follows the phone's direction.

**Accessibility** is part of the component, not the screen: tap targets of at least 48, a role and a name on every control, errors announced as alerts, nothing that disables font scaling.
Tests find controls by role and name, which doubles as a check that they have them.

**Lists** that can grow use `FlatList` now and `@shopify/flash-list` when the first long list (inbox, contacts) is built; never `ScrollView` + `map` for server data.

**Offline** is read-through caching only in v1: the app is online-first and shows a clear offline state; there are no queued writes. Persisting the query cache to disk would store customer data on the phone,
so it needs encryption and its own ADR first.

**Realtime** (inbox, notifications) reuses the web protocol (Socket.IO with the short-lived ticket; `apps/web/src/lib/realtime`). Not part of the foundation; it arrives with the inbox.

## Consequences

- The structure of a new screen is the same every time, so review is about behaviour, not layout. The `mobile-new-screen` skill encodes it.
- Some "obvious" shortcuts are blocked on purpose (`fetch`, `Text`, `process.env`, hex colours, literal text). The error message names the right replacement and the ADR.
- Two styling systems never coexist: there is no NativeWind or Tailwind in the app.

## Alternatives considered

- **NativeWind (Tailwind for React Native).** Familiar to web developers, but a second styling system next to the tokens, with its own build step and Metro and Babel configuration to maintain. Revisit if the team prefers it after the first ten screens.
- **Redux / Zustand from day one.** There is no client state yet; the first real need will show what shape it has.
- **React Navigation directly.** Expo Router is built on it and adds file-based routes, typed links and deep links with no extra code.
- **A generated OpenAPI client.** The contracts package already is the typed client contract and is shared with web and API.

## Revisit when

- client state outlives a screen (add Zustand);
- a screen needs offline writes (design the queue, the conflict rule with `rowVersion`, and encrypted persistence together);
- the lint rules block legitimate work more than they prevent mistakes.
