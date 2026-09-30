# ADR-0018: Web app stack and browser session handling

- **Status:** proposed
- **Date:** 2026-09-30
- **Deciders:** Lakshya Tyagi (lead), Vedant, Punya. Pending their approval.

## Context

`apps/web` was an empty slot ("your existing Next.js app moves in here") and nothing in the repo fixed a frontend
stack. The Reference port needs a full staff app: two shells (customer workspace and platform-admin console), a menu
gated by role, plan feature and channel availability, 21 interface languages including right-to-left ones, and a
session model that works with this API's bearer-token pools (ADR-0007). Three developers will add screens in parallel,
so anything that requires editing a shared file per screen becomes a merge conflict.

## Decision

- **Next.js App Router, React 19, TypeScript, Tailwind CSS v4**, with shared tokens and primitives in a source-only
  workspace package `@crm/ui`. Data fetching uses TanStack Query; request/response types and Zod schemas come from
  `@crm/contracts` and are parsed at the boundary.
- **Session in httpOnly cookies behind a same-origin proxy.** The login route handler calls the API's staff login and
  stores the token pair in httpOnly, SameSite=Lax cookies. Browser code calls `/api/v2/*`; the proxy adds the bearer token,
  refreshes once on a 401, refuses `auth/*` paths (so raw tokens never reach page JavaScript) and refuses cross-origin
  writes. The browser never talks to the API host directly, so CORS is not involved.
- **next-intl with cookie-based locale, no locale in the URL.** Messages live in `messages/<locale>/<domain>.json`, one file
  per domain, merged at request time and falling back to English. Right-to-left is derived from the locale.
- **Navigation registry.** Each domain declares its menu entries in `features/<domain>/nav.ts`; a build script generates the
  registry (gitignored), so adding a domain never edits a shared file. Visibility follows Reference's rule: a missing
  permission or channel hides the item, a missing plan feature keeps it visible and locked.

## Consequences

### Positive

- XSS cannot exfiltrate tokens; no CORS surface; the API stays unchanged.
- Adding a domain touches only its own directories (route group, feature folder, messages file), which is what lets three
  people work without conflicts.
- Locale and theme are server-rendered from cookies, so there is no flash and `dir` is correct on first paint.

### Negative

- The proxy is an extra hop and its behaviour (refresh, header allow-list) is code we own.
- All domains' messages are sent to the client until per-route message splitting is added.
- Deep links are lost when only the access token has expired (the refresh redirect returns to the dashboard).
- Realtime (Socket.IO) needs a short-lived token endpoint, which does not exist yet.

### Neutral

- The Clerk staff login (`/auth/clerk/session`, migration 0009) is not used by this app.
- Menu gating currently runs with unknown capabilities (everything visible) until an app-init endpoint returns
  permissions, plan features and channels for the caller.

## Alternatives considered

### Tokens in localStorage, browser calls the API directly

Simplest, but any XSS steals a long-lived refresh token, and it forces a CORS allow-list per environment.

### Locale as a URL prefix (`/ar/...`)

Good for public SEO pages, but this is an authenticated app: it doubles every route, complicates redirects and adds a
middleware layer for no benefit. Revisit for the public marketing site.

### A component library dependency (shadcn/ui, MUI)

Faster on day one, but Reference has its own theming tokens and two shell modes; a small in-repo kit keeps that under our control.

## Revisit when

A public, SEO-relevant site is built in the same app, when realtime needs a token endpoint, or when the message bundle
becomes large enough to justify splitting per route.
