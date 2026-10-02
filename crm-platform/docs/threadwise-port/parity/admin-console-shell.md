# Parity evidence: admin console and app shell

Reference 1.7.0 vs this working tree (not committed). Scope so far: the platform-console rail, TW-ASHELL-003 (layout), 004 (grouped
navigation with live counts) and 005 (collapse, group toggles, phone drawer). The customer shell, header controls, settings hub
and the rest of the domain are not built yet, and are not covered here.

## Evidence

| What                                             | Where                                                                                      | Result                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Navigation logic and count formatting (unit)     | `apps/web/src/features/admin-console-shell/*.test.ts`                                      | 32 tests pass (nav 23, sidebar state 9); the web package is green |
| Rail behaviour in a real browser (our app alone) | `apps/web/e2e/admin-console-shell/shell.spec.ts`, `pnpm --filter @crm/web test:e2e`        | 18 of 18 pass (desktop, phone, RTL, keyboard, guest, gated admin) |
| Twin run, same scenarios on Reference and on ours   | `apps/web/e2e/admin-console-shell/parity/TW-ASHELL-005.twin.mjs`, depth quick, 3 scenarios | PASS: 11 observations the same, 0 defects, 0 review items         |
| Typecheck, lint                                  | `pnpm --filter @crm/web typecheck lint`                                                    | clean                                                             |

## Rows (twin run)

| #   | Criterion / UX item                                                           | Reference observed                             | Ours observed                                          | Result |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ | ------ |
| 1   | A guest opening the console is sent to a sign-in page, and sees no console UI | redirected; no console toggle on the page   | redirected; no console toggle on the page              | same   |
| 2   | The rail collapses to icons, remembers it in a cookie, survives a reload      | collapses to about 76 px; cookie set; stays | collapses to 64 px; cookie set; stays; server-rendered | same   |
| 3   | Expanding again restores the full width                                       | restores                                    | restores                                               | same   |
| 4   | On a phone the rail is off-screen and its collapse button is not on screen    | off-canvas at x = -260                      | hidden; collapse button not rendered                   | same   |
| 5   | The page does not scroll sideways on a phone                                  | no overflow                                 | no overflow                                            | same   |

## Intended differences

| #   | Area            | Reference                              | Here                                                  | Why                                                                                                       |
| --- | --------------- | ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Count format    | Inventory said 12,500 reads `12.5k` | Reads `13k`                                           | Verified on the running Reference: no decimals from 10,000. The inventory example was wrong and is corrected |
| 2   | Collapsed width | about 76 px                         | 64 px                                                 | Design-system spacing step; behaviour is the same                                                         |
| 3   | Menu contents   | About 40 entries, all fixed in code | Only pages that exist today; each domain adds its own | Linking to unbuilt pages would 404; entries arrive through the nav data                                   |
| 4   | Icons           | Per-item icons                      | First-letter tiles                                    | No icon set in the design system yet                                                                      |

## Not done yet (honest list)

- **Counts:** Reference shows badges for users, roles, permissions, devices, workspaces, coupons and more. Ours shows only the plan count, because that is the only source behind the operator API today. Cross-tenant counts need a sanctioned platform read (a decision for the kernel steward), so none was added.
- **Header controls (TW-ASHELL-006):** health pill, notification bell, account menu with role and email. The theme and language switchers exist; the rest does not.
- **Toasts (TW-ASHELL-007):** the existing toast supports success and error; the warning variant of Reference's inline banner is not added.
- **IP allowlist on the console (TW-ASHELL-002):** already enforced by AUTH's `OperatorGuard` on every operator API call; no separate console check was added.
- **Customer shell, quick access, tour, workspace switcher, settings hub (008 to 047):** not started.
- **Twin run depth:** only `quick`, three custom scenarios. The harness's page probes (accessibility, keyboard, degraded states, performance) were not run on the console because its default login is the staff login, not the operator login. Our own Playwright spec covers keyboard and phone behaviour.
- **Environment:** Reference ran from a Windows bind mount in Docker, with cold pages taking several seconds; the twin spec uses long timeouts for it.
- **Tracker and stamp:** the tracker rows were not changed (these domains are listed under another owner in `ownership.json`, which needs the team's approval to change).
