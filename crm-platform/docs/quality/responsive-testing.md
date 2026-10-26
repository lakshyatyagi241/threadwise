# Responsive testing (QA task 20)

Target: every page at 360, 390, 768, 1024, 1440 and 1920 px wide, with zero P0 and zero P1 layout defects.

## What was added

| Piece                                                                                                    | Where                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Route sweep: every static page at the six widths, loaded fresh at each width                             | `apps/web/e2e/responsive/layout.spec.ts`         |
| The checker that finds layout defects, and the settle step that waits for a page to stop changing        | `apps/web/e2e/responsive/layout-checks.ts`       |
| Self-check: 14 fixtures with a known defect that must be found, and lookalikes that must not be reported | `apps/web/e2e/responsive/layout-checks.spec.ts`  |
| Widths, routes allowed to fail (`known`, shrink-only), routes to skip                                    | `apps/web/e2e/responsive/responsive.config.json` |
| Command                                                                                                  | `pnpm qa:responsive`                             |

Routes are generated from `apps/web/src/app/**/page.tsx`, so a page added tomorrow is covered tomorrow. Dynamic pages (`[id]`, `[token]`) need real data and are not generated; the report counts them.

## What counts as a defect

| Severity | Defect                         | What it means                                                                                                             |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| P0       | `error-screen`                 | The page shows an error screen, or nothing at all                                                                         |
| P0       | `control-unreachable`          | A button, link or field is wholly outside the screen with no scrolling box around it                                      |
| P1       | `page-overflow-x`              | The page scrolls sideways                                                                                                 |
| P1       | `control-cut-by-edge`          | A control is cut by the screen edge                                                                                       |
| P1       | `control-covered`              | A control is under another element in the normal flow (a fixed or sticky overlay such as a cookie banner is not a defect) |
| P1       | `content-cut-off`              | Content is cut off by the screen edge with no way to scroll to it                                                         |
| P1       | `broken-image`                 | An image did not load                                                                                                     |
| P1       | `no-viewport-meta`             | A phone-width page has no viewport meta tag                                                                               |
| P2       | `text-clipped`, `tiny-targets` | Text clipped without an ellipsis; tap targets under 24 px on a phone or tablet (reported, never fails a route)            |

A P0 or P1 defect fails the route. A route that cannot be fixed yet goes in `known` with the reason; the list only shrinks.

## What the checker ignores on purpose

Things that look like defects in a measurement but are not: a marquee or carousel clipped by its own box, a table inside its own horizontal scroller, a closed drawer parked off screen (fixed or sticky), a control scrolled out of its own scroll container, a visually hidden (screen-reader only) control, the Next.js development overlay. Each has a fixture in the self-check, so the exclusions are tested too.

## Result (21 Oct 2026, production build, Chromium)

225 static pages (21 public, 204 signed in) at the six widths, 1,350 page loads. One real defect, no other P0 or P1:

| Finding                                                                                                                                                                                                                                                                                                                   | Severity | Status                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/more` shows the app's error screen at every width. The page throws `useShellData must be used inside the app shell` because commit `1f7894a4e` (5 Oct) removed the `<ShellDataProvider>` wrappers from `components/shell/app-shell.tsx`, so the More page (`admin-console-shell/more/more-page.tsx`) has no shell data. | P0       | Open. On the `known` list with owner and fix: provide the shell data from `AppShell`, or retire the page. Product code was not changed. |

The checker also gave false alarms on three more routes (`/catalog/collections`, `/message-history`, `/sla-policies`). They were inputs inside a closed `<details>` box, which keeps stale coordinates; the checker now treats a closed details box as hidden and the three routes pass.

Because the error-screen rule was widened after most of the sweep had run, every route was checked again at 1440px (and the first 42 also at 360px) with the final checker. The only P0/P1 was `/more` again.

Dynamic pages (`[id]`, `[token]`) are not generated and are not measured.

## Lessons from the first runs

- The page must be allowed to settle. A page measured while it was still rendering reported an overlap that was gone a second later. The settle step waits for spinners to go and for the document height and element count to stop changing.
- A closed `<details>` box keeps its children's coordinates, so a control inside it looks covered by whatever sits there. The checker treats its contents as hidden.
- Measure the production build (`next build` then `next start`), not the dev server: the dev server compiles each page on first visit (slow) and adds an overlay of its own.

## Run it

```bash
pnpm --filter @crm/web build && pnpm --filter @crm/web exec next start -p 3001 &   # production build
HEADLESS=1 WEB_URL=http://localhost:3001 pnpm --filter @crm/web exec playwright test e2e/responsive
```

`RESPONSIVE_FILTER=contacts` runs routes containing that text; `RESPONSIVE_ROUTES=/a,/b` runs exactly those; `RESPONSIVE_SCOPE=public|authed` splits by sign-in; `RESPONSIVE_OUT=file.jsonl` says where every finding is written, one JSON line each. `CHROMIUM_PATH` points at an installed Chromium if Playwright's expected revision is missing. Give each Playwright run its own `--output` folder when two run at once, or they delete each other's artifacts.

## Not covered (honest limits)

- Chromium only. Firefox and WebKit are covered by the cross-browser spec (QA task 19), not by this sweep.
- One signed-in account (the seeded workspace admin). A page that looks different for another role, plan or data set is not measured.
- Dynamic pages, and states that need a click (an open modal, a dropdown, a filled form), are not measured.
- Layout only: this does not judge whether a page looks good, only whether it is usable at that width.
