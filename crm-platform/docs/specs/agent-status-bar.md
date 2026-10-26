# Agent status bar and automatic Away from working hours

Status: built in PR "Agent status bar and automatic Away" (branch `lakshya/next/agent-status-bar`). Owner-confirmed feature; the interaction is modelled on the
status menu of a well-known inbox product, in our own words and our own stack. **Nothing here was verified in a browser**: see section 10.

Related: [packaging-teams-and-smart-routing.md](packaging-teams-and-smart-routing.md) (how a feature is flagged), [api/smart-routing-packaging.md](../api/smart-routing-packaging.md)
(operator how-to, section 7 is this feature), [addons-marketplace-unification.md](addons-marketplace-unification.md), [contact-owner-leave-and-delegation.md](contact-owner-leave-and-delegation.md)
(leave), [conversation-handoff-and-assignment.md](conversation-handoff-and-assignment.md), team test guide
[wadesk-port/agent-status-test-guide.md](../wadesk-port/agent-status-test-guide.md).

## 1. What it is

A personal availability status that is reachable from everywhere and can be automated by working hours.

1. **Status control.** A pill with a dot (Available green / Away muted / On leave until `<date>` / Away outside working hours) in the global top bar (next to the
   bell and the avatar) and mirrored at the top of the Inbox list. Its menu: the person's name; **Update status** (Set as away / Set as available); **Automate status**
   (Manage working hours and out of office, which opens the personal Working hours dialog and the existing Time off dialog). The account menu's Availability row
   stays and shows the same state. The Inbox says "Outside of working hours" under the pill when the person is Away because of the schedule.
2. **Automate status.** Per person: a weekly schedule (several ranges a day, days off, overnight ranges), an IANA time zone (prefilled from the workspace) and an
   "Automate my status" switch. Outside the hours the person is Away by themselves.
3. **One effective-status rule**, used by every consumer (section 2).
4. **Assignment** reads the effective status: people outside their hours are skipped with the trace reason `outside_working_hours`.
5. **Rename**: "Offline" becomes "Away" in every user-visible string for availability, in 21 locales. The stored value stays `offline` (section 3).
6. **Two plan features**: `agent_status_bar` and `agent_status_automation` (section 6).

## 2. The rule

One pure function, `effectiveAgentStatus` in `apps/api/src/common/agent-status.ts`, and one batch loader, `loadAgentStatuses` (three queries for any number of
people: status rows, workspace calendar, leaves covering today). Nothing else decides.

```
manual choice  >  leave (out of office)  >  working hours (automation on AND plan has agent_status_automation)  >  Available
```

| Input                                                               | Result                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| stored `busy`                                                       | Away, reason `manual`, still not routable (kept for routing, not offered in the new menu) |
| stored `offline` and the choice has not ended                       | Away, reason `manual`                                                                     |
| stored `online` with a manual record `online` that has not ended    | Available, reason `manual`; beats leave and the schedule                                  |
| the same, but set on a day BEFORE the leave began                   | does not apply: a click made weeks ago must not defeat an out-of-office. Leave decides    |
| on leave today (workspace calendar), no manual choice               | Away, reason `leave`, `leaveUntil` = last day (null = open ended)                         |
| automation active and the instant is outside the person's own hours | Away, reason `schedule`, `changesAt` = next boundary                                      |
| anything else, including a member with no status row                | Available, reason `default`                                                               |

**How long a manual choice lasts.** While the person automates (switch on, plan has the feature, at least one open day) a manual choice lasts until the next schedule
boundary (`manual.until`, written when the choice is made), so Away is not forgotten for ever. Otherwise it lasts until the person changes it. `until` is only honoured
while automation is active: if the plan feature goes away or the person turns Automate off, the choice is "until changed" again (the stored data is kept).

**Empty schedule** (Automate on, no open day): the person is **always Available** by schedule and the dialog shows a warning. Decided so that an unfinished form
cannot silently make somebody unreachable.

**Boundaries.** `nextScheduleChange` lists the opening and closing instants of every range of the days around now in the person's zone and returns the first one
whose inside/outside state differs from now (back-to-back ranges are not a boundary). Instants come from the zone's own rules, so a daylight saving change moves
the instant in real time, not the clock. A wall time that does not exist (the skipped hour) is read with the offset in force before the change.

## 3. Data model: no migration

| Where                                | What                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent_statuses.status`              | unchanged: `online`, `offline` (= Away), `busy`. API enum unchanged (`online` / `offline`); an `away` alias was **not** added                          |
| `agent_statuses.preferences` (jsonb) | key `availability`: `{ manual?: { status: 'online' \| 'offline', setAt, until }, hours?: { automate, timezone, days } }`. Other keys are never touched |

`days` is the same shape and the same Zod schema as the workspace and team schedules (`businessHoursDaysSchema`: seven days, each `enabled`, `from`, `to`, up to two
`extra` ranges; `to` before `from` is overnight; `24:00` is the end of the day). Malformed stored data reads as "not set".

`agent_statuses` already has `org_id` with forced row level security (`tenant_isolation`, `USING` and `WITH CHECK`, migration `20261001102700`); the preferences
column lives under the same policy. Every read and write goes through `DatabaseService.tx`, with the caller's tenant.

## 4. API

| Route                                         | Permission                                        | Plan feature                                          | Notes                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/workspace/members/me/availability`   | any member (own row)                              | none                                                  | `status` keeps the old two words and now carries the **effective** state; plus `state`, `reason`, `manual`, `changesAt`, `leaveUntil`, `hours`, `features` |
| `PUT /v2/workspace/members/me/availability`   | any member (own row)                              | none                                                  | body unchanged (`online` / `offline`); a manual choice; audit `member.availability_changed` and the outbox event as before                                 |
| `GET /v2/workspace/members/me/working-hours`  | any member (own row)                              | none (reading is always allowed)                      | without a saved schedule: Mon-Fri 09:00-18:00 suggestion and the workspace zone                                                                            |
| `PUT /v2/workspace/members/me/working-hours`  | `team.leave.manage` (scope `own` is enough)       | `agent_status_automation` (422 `PLAN_FEATURE_LOCKED`) | audit `member.working_hours_changed`                                                                                                                       |
| `GET /v2/workspace/members/:id/working-hours` | `team.leave.read`                                 | none                                                  | `canEdit` tells the UI whether the caller may change it                                                                                                    |
| `PUT /v2/workspace/members/:id/working-hours` | `team.leave.manage` at a scope that reaches `:id` | `agent_status_automation`                             | `own` = yourself, `team` / `team_and_below` = teammates, `all` = anyone (the Time off rule, `mayManage`); other workspace 404                              |

Saving hours recomputes the person's manual choice: a choice that already ended under the old schedule is cleaned up (not revived); an Away set before any schedule
existed (or by the inactivity sweep) gets a record so it can end at a boundary; the new `until` follows the new schedule.

## 5. Who reads the effective status

| Consumer                                                                               | Change                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing rules, round robin, least busy: `RoutingRulesRepository.available()`           | takes the statuses loaded once for the whole candidate set; skip reason `outside_working_hours`, otherwise the old `offline_busy_or_at_capacity`                                                         |
| Leave handling inside the routing engine (named person away -> delegate)               | reads leave through the same rule: somebody who chose Available during their leave counts as present                                                                                                     |
| Handoff to rules, Try it, escalation timers                                            | the same engine (`Calendar` now carries `now` and the automation flag)                                                                                                                                   |
| Assignee picker (`GET /inbox/assignees`), Send to queue, assign menu, bulk assign      | `availability`: `online` Available, `offline` Away (chosen or on leave), `away` Away outside working hours, `busy`; a member with no row is Available (it said offline before while routing said online) |
| Team members list and team members (presence dots), team performance table             | the effective word instead of the stored one                                                                                                                                                             |
| Away rules (return unanswered chats when somebody goes away; set inactive people Away) | "still away" is the effective status; the inactivity sweep only touches people who are Available now and writes a manual Away that ends at the next boundary when they automate                          |
| CRM record owner rules ("Skip people who are away")                                    | skips Away by choice and Away outside working hours; leave stays its own rule there                                                                                                                      |
| **Named-person handoff / manual assignment**                                           | **unchanged on purpose**: the person is chosen by a human, so their status does not block it (it did not before either). Owner-first and sticky agent never checked availability and still do not        |

Not covered (recorded, not hidden): going Away **by schedule** does not return the person's unanswered chats to the queue (the away rules fire on an explicit status
event, and a schedule produces none; they react to a manual Away, a leave and the inactivity sweep as before). Another browser tab learns of a change when it regains focus
or within a minute (no realtime push of the status).

## 6. Plan features, gates and downgrade

Owner rule: every new feature has its own plan feature. Both default `false`, are in `NEW_PLAN_FEATURES_OFF` (a new plan starts without them), and the seeded sample plans say it
explicitly (Starter off, Growth and Scale on). Neither is pack-grantable and neither is part of the Smart routing add-on.

| Plan feature              | Label                                                             | Unlocks                                                                                                                              | Off                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_status_bar`        | Status bar: Available / Away control in the top bar and the Inbox | the menu of the pill (Set as away / available, Automate status, the Time off link)                                                   | the pill still shows the state; its menu is a locked note naming a higher plan, with a link to Plans (never hidden)                                                          |
| `agent_status_automation` | Automate status: personal working hours and automatic Away        | saving a schedule, Away outside it, the Outside of working hours notice, the routing skip, the effective status in lists and pickers | `PUT .../working-hours` is 422 `PLAN_FEATURE_LOCKED`; the dialog is read only with the lock note and a link to Plans; the stored schedule is **kept and ignored** everywhere |

The account menu's Available / Away switch is **not** gated: it exists today and stays for every plan, and a manual Away / Available works with both flags off.
**Downgrade mid-day**: automation stops at the next evaluation (every consumer asks the plan on each use), the manual choice is kept, the schedule is kept. Turning the flag
back on restores the schedule; a manual choice whose `until` passed meanwhile has ended.

The two flags are independent: with the bar off and automation on, hours can still be set from Settings > Team members and are still enforced.

## 7. Permission matrix

Presets: Owner and Admin hold every key; **Manager** `team.leave.manage` scope `all`; **Agent** and **Viewer** `team.leave.manage` scope `own`; every preset holds
`team.leave.read`. A custom role has what it is given. No new permission key, so **no locked-role migration**.

| Control                        | Flag                                               | Permission                                | Scope                             | Where                                | Role presets                                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- | --------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| See the pill and its state     | none (state); `agent_status_bar` (the menu)        | any member                                | own                               | top bar, Inbox list                  | everyone                                                       |
| Set as away / available        | `agent_status_bar` (menu); none (account menu row) | any member                                | own                               | pill menu; account menu              | everyone                                                       |
| Time off from the pill menu    | `agent_status_bar`                                 | `team.leave.manage`                       | own (all for managers)            | pill menu                            | all presets; a custom role without it sees no row              |
| Open my working hours          | `agent_status_bar` (menu)                          | none to read; `team.leave.manage` to save | own                               | pill menu; works without Team access | everyone reads; all presets save                               |
| Save my working hours          | `agent_status_automation`                          | `team.leave.manage`                       | own                               | the dialog                           | all presets                                                    |
| Read someone's working hours   | none                                               | `team.leave.read`                         | workspace                         | Settings > Team members (clock icon) | all presets                                                    |
| Change someone's working hours | `agent_status_automation`                          | `team.leave.manage`                       | `all` / `team` / `team_and_below` | Settings > Team members (clock icon) | Manager, Admin, Owner (anyone); Agent / Viewer only themselves |
| Presence dots and picker text  | none                                               | whatever the screen already needs         | n/a                               | Team members, pickers                | n/a                                                            |

## 8. Impact analysis and edge cases

Each row is a test. U = `test/unit/workspaces-teams-tenancy/agent-status.spec.ts`, E = `test/e2e/workspaces-teams-tenancy/agent-status.e2e.spec.ts`,
R = `test/e2e/team-inbox-routing-sla/routing-working-hours.e2e.spec.ts`, W = web `agent-status.test.ts` / `agent-status-menu.render.test.tsx`.

| Case                                                                                      | Behaviour                                                                                                                                                                                            | Test                                                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Every precedence combination (manual x leave x hours x row missing x busy)                | as the table in section 2                                                                                                                                                                            | U                                                                       |
| Manual until the boundary; automation off; plan flag off mid-day                          | lasts to the boundary; then until changed; then kept                                                                                                                                                 | U, E                                                                    |
| Daylight saving (spring forward, fall back), the skipped hour                             | boundary follows the zone's rules; the skipped wall time is read before the change                                                                                                                   | U                                                                       |
| Overnight 22:00-06:00; a range spanning midnight into a day off                           | open through midnight, ends at its own closing time, even when the next day is off                                                                                                                   | U                                                                       |
| Several ranges a day; back-to-back ranges; `24:00`                                        | a gap is a boundary, back-to-back is not; `24:00` ends at the next midnight                                                                                                                          | U                                                                       |
| Time zone changed by the person                                                           | same instant, other verdict                                                                                                                                                                          | U                                                                       |
| Empty schedule with Automate on                                                           | always Available, `emptySchedule` true, dialog warns                                                                                                                                                 | U, E                                                                    |
| Leave overlapping hours; manual Available during leave; manual Available set before leave | leave away even inside hours; manual beats it only when set on or after the leave's first day                                                                                                        | U, E                                                                    |
| Flag turned off mid-day                                                                   | automation stops, schedule kept, manual kept; saving 422; reading works                                                                                                                              | U, E, R                                                                 |
| Person at the chat limit                                                                  | still skipped by `available()` (capacity is not part of the status)                                                                                                                                  | existing `routing-chat-limit`                                           |
| Person on delegate cover                                                                  | a delegate is chosen only if effectively available; a delegate's own schedule counts                                                                                                                 | R (rule), existing `routing-leave`                                      |
| Try it explanations                                                                       | `outside_working_hours` ("outside their working hours") next to the old reasons                                                                                                                      | R                                                                       |
| Existing auto-offline-after-idle away rule                                                | **precedence kept and documented**: it only touches Available people; its result is a manual Away; with automation it ends at the next boundary, without it stays until they switch back (as before) | existing `queue-timers.e2e.spec.ts`, rerun after the change (17 passed) |
| Multiple tabs                                                                             | the query refetches on focus and each minute, and a timer fires at `changesAt`; no realtime push                                                                                                     | W (hook), not browser-tested                                            |
| Viewer, Agent, custom role; role without Team access                                      | own hours and Time off through the pill; a custom role without `team.leave.manage` reads but cannot save                                                                                             | E                                                                       |
| Plan without the flags                                                                    | locked notes with a link to Plans; account menu switch unaffected                                                                                                                                    | E, W                                                                    |
| Workspace default time zone missing                                                       | the dialog prefill falls back to UTC (`resolveTimezone`)                                                                                                                                             | existing calendar tests                                                 |
| An agent whose status row does not exist yet                                              | Available everywhere (picker, lists, routing, endpoints)                                                                                                                                             | U, E                                                                    |
| Performance                                                                               | one `loadAgentStatuses` per candidate set (3 queries), the picker and lists load their ids in one call; no SQL time zone arithmetic                                                                  | by construction                                                         |
| Tenant isolation                                                                          | RLS on `agent_statuses` as before; another workspace reading or saving a member's hours gets 404                                                                                                     | E                                                                       |
| Pending (invited, not joined) members in a team's member list                             | **known gap**: the team member rows cannot tell them apart and show Available; the Team members list shows them offline                                                                              | not fixed                                                               |

## 9. Rename: Offline becomes Away

Every availability string in `apps/web/messages` (21 locales) and the help guides now says Available / Away (and "Away, outside working hours" for the schedule case). The
stored value stays `offline`; the API enum is unchanged and an `away` alias was not added. Places that keep the word Offline because it means something else: team chat
presence, device and connection health, payment gateways.

## 10. Verified and not verified

Nothing was opened in a browser (no dev server by instruction). Verified by tests: the rule (unit), the endpoints, gates, scopes and isolation (e2e with real Postgres and
Redis, no Docker), the routing engine through the real worker (e2e), pure web helpers and server-rendered markup of the pill. Not verified: any real screen, the dialog's
interaction, the popover, mobile widths, right-to-left layout, the 21-locale texts read by a native speaker, the inactivity sweep with a schedule, a real WhatsApp
conversation routed outside hours. The team checks these on the deployed site with [the test guide](../wadesk-port/agent-status-test-guide.md).
