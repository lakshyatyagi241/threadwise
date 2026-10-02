# apps/web: staff CRM (Next.js App Router)

`@crm/web`. Next.js 16, React 19, Tailwind CSS 4, next-intl, TanStack Query. Shared tokens and primitives live in `packages/ui`
(`@crm/ui`).

## Run it

```bash
pnpm dev            # API on :3000 (from the repo root)
pnpm dev:web        # this app on :3001
```

Sign in with the seeded staff user printed by `setup` (organization slug, email, password). Commands in this package:
`pnpm --filter @crm/web` then `typecheck`, `lint`, `test`, `build`. All four run in CI and in the repo gate.

## Environment

```
API_URL=http://localhost:3000                       # server-side only; the browser never calls the API host
NEXT_PUBLIC_REALTIME_URL=http://localhost:3000/realtime      # the socket address; REALTIME_URL overrides it at runtime
```

## How it is put together

| Path                                          | What                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/app/(auth)/login`                        | sign-in form                                                                                                        |
| `src/app/(app)/`                              | customer shell layout (guards the session) and one route group per domain, `(<domain>)/<routeBase>/`                |
| `src/app/(admin)/`                            | platform-admin shell (placeholder until the super-admin actor exists)                                               |
| `src/app/api/auth/*`                          | login, logout, refresh route handlers; tokens go into httpOnly cookies                                              |
| `src/app/api/v2/[...path]`                    | same-origin proxy to the API: adds the bearer token, refreshes once on 401, blocks `auth/*` and cross-origin writes |
| `src/features/<domain>/`                      | a domain's screens' code and its `nav.ts` menu entries                                                              |
| `src/features/_registry/`                     | nav types and gating rules; `nav.generated.ts` is built from every `nav.ts` (gitignored)                            |
| `src/components/shell/`                       | the app shell (sidebar, header, theme and language switchers)                                                       |
| `src/lib/api`, `src/lib/auth`                 | API client, error mapping, cursor-list hook; cookie and session helpers                                             |
| `src/i18n`, `messages/<locale>/<domain>.json` | locale list (21, three RTL), message loader with English fallback; one messages file per domain                     |

## Add a screen for your domain (no shared file is edited)

1. `src/app/(app)/(<domain>)/<routeBase>/page.tsx`
2. `src/features/<domain>/nav.ts` exporting `nav: NavItem[]` (group, label key, href, optional gates)
3. `messages/en/<domain>.json` with the top-level key `<domain>`; reference keys as `<domain>.<screen>.<key>`
4. Fetch through `apiFetch` / `useCursorList` with a schema from `@crm/contracts`
5. `pnpm --filter @crm/web typecheck lint test` (the registry regenerates by itself)

See the `threadwise-frontend-port` skill for the rules that apply to every screen.

## API rules this app follows

| Rule                                  | Why                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| Identifiers are uuids                 | The API never emits internal bigint ids                      |
| Lists paginate by cursor              | `?limit=50&cursor=...`; there is no page number and no total |
| Errors are `application/problem+json` | Switch on `code`, never on `title`; show `requestId`         |
| `Idempotency-Key` on mutations        | `apiFetch` adds one automatically; pass your own to replay   |
| `X-Request-Id` on every call          | Comes back on the response and is in every server log line   |
| Send `rowVersion` on updates          | A 409 `ROW_VERSION_CONFLICT` means reload, never auto-retry  |

## Known limits

- The menu shows every item until an app-init endpoint returns the caller's permissions, plan features and channels.
- Only English messages exist; the loader falls back to English for the other 20 locales.
- All domains' messages are sent to the client (fine now, split per route later).
- When only the access token has expired, the refresh redirect returns to `/dashboard`, not the page you were on.
- Realtime is connected (one socket per session, `src/lib/realtime`) but no screen listens yet: the polling features still poll.
