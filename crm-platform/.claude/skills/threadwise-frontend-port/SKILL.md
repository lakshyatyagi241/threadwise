---
name: threadwise-frontend-port
description: >-
  Rebuild a Reference screen in the new Next.js staff app (apps/web) from its
  inventory entry, inside the owning domain's zone only. Use this whenever
  someone says "port the Reference screen", "build the UI for TW-XXX", "recreate
  the inbox page", "convert this blade view", "add the settings page for X",
  "frontend for my domain", "list page with filters like threadwise", or is about
  to write any apps/web code for a Reference feature. Covers structure, data
  access, pagination, forms, permissions, realtime, i18n/RTL and states. Reference
  Blade/JS/CSS is reference only and is never copied.
---

# Port a Reference screen

**Precondition.** The web foundation (skeleton Part B, K4 steward: app shell, `@crm/ui` design system, auth,
API client, nav registry, i18n loader) must be merged. If `apps/web` has no `package.json` yet, stop: do not build a private
shell or a second design system; mark the feature `blocked` on the web-foundation feature and work on the API side first.
This skill fixes structure and rules; the framework specifics (Next version, i18n library, UI kit) are decided in that
foundation and documented in `apps/web/README.md`; read it first.

## Where files go (all inside your domain's zone; anything else is a kernel change)

| What         | Path                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Routes       | `apps/web/src/app/(app)/(<domain>)/<routeBase>/...` (admin-console screens: `(admin)/(<domain>)/`)          |
| Feature code | `apps/web/src/features/<domain>/` (components, hooks, api functions, `nav.ts`, `index.ts` = public surface) |
| Messages     | `apps/web/messages/<lang>/<domain>.json`, keys `<domain>.<screen>.<key>`                                    |
| Browser e2e  | `apps/web/e2e/<domain>/`                                                                                    |

Nav entries come from your `features/<domain>/nav.ts` through the generated registry; never edit the shell files.

## From inventory entry to screen

1. Read **UX & screens** of the entry: each screen/modal/tab, fields, validation, conditional visibility (role, plan, channel
   state), empty/loading/error/limit states, bulk actions, filters/sort/search, realtime, toasts. Each item becomes a component or
   a test id. Layout intent comes from the entry and its wiring map.
2. Build with `@crm/ui` components and tokens, matching the reference screen's layout, flow and behavior
   ([PORTING_RULES.md](../../../docs/threadwise-port/PORTING_RULES.md) section 3: same UI, rewritten in our stack). No Reference markup, CSS, JS, icons or images; short
   functional labels match the reference, longer copy is written fresh, in English
   in your `messages/en/<domain>.json` (translations for the other 19 languages come through the localization domain).
3. Data only through the typed API client from the foundation (see `frontend-api-call`): import types from `@crm/contracts`,
   parse responses at the boundary, uuids only, `Idempotency-Key` on mutations, `rowVersion` on updates (409 → "reload", never auto-retry),
   errors branch on problem+json `code` and show `requestId`.
4. **Lists:** Reference grids use page numbers and totals; ours are cursor "load more" with server-side filters and no totals.
   Per-column sorting needs a keyset per sort; if the inventory requires a sort the API lacks, add it to the API in your zone first.
   Show counts only if the API returns them.
5. **Forms:** Zod schemas from contracts drive validation; server errors map field-by-field from `errors[{path,message}]`.
6. **Permissions/plan gates:** hide or disable exactly what the entry says, using the permission/plan payload from the app-init
   endpoint; the server stays the authority, the UI never assumes.
7. **Realtime:** subscribe to your `<code>` rooms through the foundation's socket client; reconcile on reconnect (refetch, do not trust missed events).
8. **RTL and languages:** Reference ships Arabic, Hebrew and Urdu. Use logical CSS properties, no hard-coded left/right, test one RTL locale.
9. **States:** every async region has loading, empty, error and stale states; every destructive action confirms; long lists virtualize.
10. Accessibility baseline: labelled controls, keyboard operable, focus management in modals, contrast from tokens.

## Verify

Browser e2e for each acceptance criterion that has a UI (`threadwise-e2e-tests`), then check states, validation, keyboard, responsive and a11y against the entry.
Type-check and lint the web workspace with the commands in `apps/web/README.md`, then the repo gate.
