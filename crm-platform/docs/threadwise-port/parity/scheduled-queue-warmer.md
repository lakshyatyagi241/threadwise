# Parity: scheduled messages and the number warmer (SCHED)

Evidence is automated against fakes at the edge: `apps/api/test/e2e/scheduled-queue-warmer/scheduled-api.e2e.spec.ts` (16, real Postgres and
Redis), `scheduler.e2e.spec.ts` (the engine), and unit specs `warmer-rules`, `schedule-helpers`, `schedule-time`. **Nothing ran against a real
WhatsApp number**, and the Playwright twin run against the running Reference (`threadwise-playwright-parity`) was **not** done. The engine's own parity
(runs, receipts, retries, pacing) is in [node-bridge-runtime.md](node-bridge-runtime.md) because it is NODE's (TW-NODE-022, 030 to 036).

## Intended differences from Reference

| Where                     | Reference                                                                                       | Here                                                                                                                                       | Reason                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Opted-out contacts        | still messaged on a single-sender group, tag or queue schedule                               | never messaged, whichever audience names them; typed numbers of opted-out contacts too; the composer's preview says how many were left out | compliance (TW-SCHED-004 rule 6: "the port must fix")       |
| Audience copies           | a person in two chosen groups could appear twice; tag audiences with two senders ended empty | one copy per person across groups, tags and broadcasts; tag audiences split like any other                                                 | TW-SCHED-004, 005 quirks                                    |
| Empty plain message       | accepted; every recipient then failed                                                        | refused when saving (`Write the message to send.`)                                                                                         | TW-SCHED-003 quirk 5                                        |
| Warmer reservation        | made at create time and never given back                                                     | recorded on the schedule and given back (the unsent part) when it is cancelled, deleted or fails                                           | TW-SCHED-008 quirk 4                                        |
| Warmer on scheduled sends | only the day budget at create time                                                           | also active hours (a run outside them waits 30 minutes), the number's own gap and spintax at send time                                     | the reference docs promise it and the port notes ask for it |
| Warmer page gate          | `access_whatsapp_warmer` never closed                                                        | plan flag `whatsapp_warmer` and permission `sched.warmer.manage`                                                                           | TW-SCHED-041                                                |
| Retry                     | reset every recipient to pending, re-sending to people already messaged                      | only failed recipients go back to pending                                                                                                  | TW-SCHED-017 rule 4 sends duplicates                        |
| Edit                      | no lead time, no zone check, response carried the whole row                                  | 2-minute lead time and zone check when the time changes, version check, answers the detail                                                 | TW-SCHED-016                                                |
| Run now                   | allowed from waiting, running, paused, failed; failure fields kept                           | same statuses; failure fields cleared                                                                                                      | the schedule is armed again                                 |
| Delete                    | soft delete                                                                                  | hard delete (the project convention); the recipient rows go with it                                                                        | conventions                                                 |
| Typed numbers             | remembered as contacts                                                                       | not turned into contacts (the plan's contact quota and flows are not touched by scheduling)                                                | contacts are the CRM's                                      |
| Test message              | to the person's own phone                                                                    | to a number typed in the composer                                                                                                          | users have no phone number here                             |
| Warmer days               | the owner's timezone                                                                         | UTC dates                                                                                                                                  | the platform has no per-person zone yet                     |
| Producers                 | rows with an out-of-enum type; appointment reminders only in the bridge's memory             | ordinary schedules with `source` and `external_key`; a key replaces its old schedule                                                       | TW-SCHED-030                                                |

## Not built, with the reason

- File upload for a schedule's media (006): the send port takes a link, not bytes, until the unofficial-engine inbox branch lands (it adds file bytes
  to the command); until then media is an https link.
- Cloud API (waba) sender with a template schedule (006): the Cloud API needs the template pipeline from the message-templates domain; a template
  schedule sends the template's text on the unofficial engine and Twilio only.
- Re-resolving group and tag audiences when the schedule fires (004 rule 7): recipients are fixed when it is saved, as Reference's were in practice.
- 028 REST API v1: needs the customer API domain (`public-api` is a lead-intake skeleton); `ScheduleCreateService` is the use case to call.
- 029, 031 to 035 mobile app and message queues: the mobile domain.
- 045 read surfaces in other pages (dashboards, contact timeline): those pages' domains.
- 044 UI-only controls: not ported (they did nothing in Reference).

## Screens: what differs from the reference (not opened in a browser, not compared side by side)

- List: the workspace-wide sent and delivery totals are computed from the schedules on the page shown (the list API has no totals); a row shows the sender
  under the name, not a message snippet (the summary carries no message).
- Composer: no "after N occurrences" end (the contract has an end date only); the template picker has search but no Marketing, Utility or Auth chips and no variable
  mapping (the options give a name and language); media is an https link, not a file drop; no place-name field on a location; no cost estimate (the API has none);
  the time zone defaults to the browser's (the workspace zone is not exposed to the web app).
- Detail: bars and counts for the delivery funnel and status mix, no engagement curve or donut chart (no chart library here); the bridge's schedule id is not shown (it
  does not exist here); no edit screen (the reference detail has none; the PATCH endpoint exists).
- Warmer: "Connect a number" links to `/channels/whatsapp`, not checked as the right target for unofficial-API numbers.

## Intended difference: unofficial engine off by default (owner decision 2026-10-05)

A scheduled message and warmer profile that names a personal-number (`baileys`) sender is refused with 422 `WA_UNOFFICIAL_DISABLED` unless a platform super admin turned the unofficial engine on; a blank sender or default engine resolves to `waba`; existing rows on that engine are kept, not sent, and resume when it is turned on. Reference always allowed it. Details and the full list of surfaces: [node-bridge-runtime.md](node-bridge-runtime.md#intended-difference-the-unofficial-engine-is-off-behind-a-platform-switch-owner-decision-2026-10-05).
