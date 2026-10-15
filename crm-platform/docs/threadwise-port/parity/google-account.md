# Parity evidence: Google account (TW-GACC)

Reference 1.7.0 vs branch `lakshya/google/calendar-sheets-flows`. Wiring: [wiring/google-account.md](../wiring/google-account.md). Plan and manual test:
[plan/google-workspace-build.md](../plan/google-workspace-build.md). **Not verified against a live Google account**: every Google answer in the tests is a stand-in written from Google's
documentation. The Playwright twin run against the running Reference was **not done** (it needs a real Google account on both sides).

## Same as Reference

- One Google account per workspace, shared by Calendar, Meet, Sheets, Docs and Forms; the page lists status, the account, the calendar and the permissions; Connect, Reconnect and Disconnect;
  disconnect revokes at Google first and carries on if Google is unreachable; the page returns the browser to where Connect was pressed.
- The flow nodes' behaviour, as Reference: the apology to the customer for Docs, Meet and Form on a failure; Sheets header matching places values under
  the sheet's own headers and keeps unmatched labels after the last column; Docs fills `{{key}}` and `{key}` and shares by link; the Docs copy survives a failed fill or share.
- The master switch of the platform operator stops everything (the pickers answer 503 `FLB_INTEGRATION_DISABLED`).

## Intended differences

| Reference                                                                               | Here                                                                                                                                                           | Why                                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| One consent for calendar, spreadsheets, documents, full drive and forms                 | per capability, `include_granted_scopes`; narrower scopes (`calendar.events` etc., not `calendar`); Docs and Drive and the Drive file list unticked by default | the restricted `drive` scopes need Google's security assessment; an admin should not grant them by default               |
| Page needs a workspace admin; no key in the plan registry                               | permissions `google.account.read` and `.manage` (admin presets)                                                                                                | the repo's RBAC; no plan key exists                                                                                      |
| Grant in the workspace's encrypted JSON, whole blob rewritten on each refresh           | sealed columns on `appointment_calendar_connections`; `needs_reconnect` state; last problem and last use shown                                                 | (already recorded for the calendar)                                                                                      |
| `USER_ENTERED` rows written as typed                                                    | a cell that Sheets would run as a formula is written as text                                                                                                   | security hardening (a customer controls profile names and answers)                                                       |
| Sheets append and Docs copy retried by nobody                                           | repeated only after a 429; everything else safe to repeat is retried with jitter; Meet event id derived from the flow step                                     | resilience without a duplicate row, copy or meeting                                                                      |
| Free-text Google errors in logs                                                         | stable `GOOGLE_*` codes; Google's wording and tokens never leave                                                                                               | hardening                                                                                                                |
| Sheets lookup `!==` on the raw value                                                    | case-insensitive and trimmed match (the first port's decision, TW-FLR-044)                                                                                     | recorded already in the flow-runtime parity file                                                                         |
| A flow whose Google step cannot run says "No Google account connected" and nothing else | the run log says `[GOOGLE_*]` and what to do; the flow editor warns before the run                                                                             | the step now FAILS (owner decision): the run stops there and the run log and run view show the code and "Connect Google" |

| Connecting stores the grant when Google redirects back | the grant is stored only after the same signed-in admin confirms "Connect <email> to <workspace> for <permissions>?" (a forwarded link cannot be completed by someone else) |
| No read-back of a moved or deleted event | an hourly bounded reconcile flags "Calendar out of sync" and offers push or accept; the appointment is never changed on its own |
| A second concurrent post of one person created two contacts | `ContactsService.create` serialises on the person's email and phone (advisory lock) |

## Not verified, not done

- Consent screen, refresh-token behaviour of an app in Testing or Production, Google's real error bodies, quota behaviour: the manual checklist, section 6 of the plan.
- The Docs `drive` scope for copying a user-owned template is what Reference used; whether a narrower scope suffices was not established and is not assumed.
- Inbox Meet composer, sheet-row trigger, real-time calendar watch channels: not built.
