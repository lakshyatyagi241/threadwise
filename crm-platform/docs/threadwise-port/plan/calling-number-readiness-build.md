# Calling number readiness: audit, build and manual test

Walkthrough item 29: "Calling next week. Backend ready. Blocked on number onboarding." The product team starts using WhatsApp Business Calling
next week. The calling backend and screens existed ([wiring](../wiring/calling-voice.md), [parity](../parity/calling-voice.md)); what did not
exist was a path from "a WABA number is connected" to "calls can be placed and answered" that does not need a developer to touch Meta, and
a screen that tells the workspace admin when it is not ready and what to do. This file is the audit, what was built, the decisions, and the
checklist for the first real number.

Owner of the domain: Vedant (calling). Branch: `lakshya/calling/number-onboarding`. Runbook for operators:
[runbooks/enabling-whatsapp-calling.md](../../runbooks/enabling-whatsapp-calling.md).

## 1. Audit: how a number is onboarded today and what calling needs on top

### What the onboarding does (WABA domain, `apps/api/src/modules/whatsapp-cloud-api-waba`)

- **Connect.** `WabaConnectService.connectEmbedded` (Embedded Signup code exchange, token inspection, WABA discovery) and `connectManual`
  (a pasted token) store the number in `wa_provider_configs` (encrypted credentials, `meta_json` with `waba_id`, `phone_number_id`, `platform_type`,
  quality, tier), then **subscribe the WABA to the platform app** (`POST /{waba}/subscribed_apps`, with a per-WABA callback override on the
  direct and provider routes), register the number with a PIN when needed, and emit the outbox event **`whatsapp.connection.connected`**.
  Reconnect emits the same event with `reconnect: true`. Pinnacle and Interakt are routes of the same service (`provider` and `registry` on the
  connection), not a separate flow.
- **Webhook fields.** The `messages` field and the coexistence and Groups fields are managed at the **app** level by `WabaDiagnosticsService`
  (`WABA_PLATFORM_WEBHOOK_FIELDS`: `messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`, and the four `group_*` fields) with a
  super-admin check and subscribe on the console. **`calls` is not in that list.**
- **Health.** `WabaConnectService.health` reads the phone node, the WABA node, the token and the subscription for the health page; it has
  a coexistence check and an inbound check (`inboundCheck`, TW-WABA-015) but nothing about calling.

### What calling does on top (calling-voice domain)

- A per-number **switch** (`POST /v2/calling/numbers/:id/toggle`, TW-CALL-004): Meta's `POST /{phone_number_id}/settings`, flags changed only
  after Meta accepts; coexistence refused before Meta is asked; the prerequisite refusal told in one long English sentence recognised by
  the word "pre-requisite". The card is on `/calling` and on the health page. **Nothing turns it on by itself.**
- The `calls` webhook field arrives through the shared WABA callback (`WABA_CALLS_SINK`), the permission ledger, dial, accept, the call log
  and the recording rules are all wired to the number's workspace (tenant-safe, tested).
- TURN: `CALLING_ICE_SERVERS` is read by `GET /v2/calling/ice-servers`; documented only in `.env.example` and the parity file.

### Findings: what is missing or unreliable, in priority order

1. **The `calls` webhook field is not part of any subscription management.** Meta delivers calling events (an incoming call, a permission answer,
   the end of a call) only when the app is subscribed to the `calls` field. The platform's check and subscribe do not know the field, so a
   correctly connected number can have calling switched on and never ring, and nothing says why. (Blocker: no incoming call, no permission
   answer, so no outbound call either.)
2. **No readiness check at all.** There was nothing between "connected" and the toggle; a number that cannot take calls (messaging limit under
   2,000, a token without `whatsapp_business_messaging`, coexistence, a number Meta does not show as connected) was found out when Meta refused the
   toggle, in an English sentence. Nothing looked at Meta's own calling status, so the local switch could drift from Meta for good (a number turned
   off over there kept its Call button; one turned on over there had none).
3. **Calling is never switched on after onboarding.** Someone has to remember the toggle for every number, every reconnect.
4. **Meta's refusals are English text, recognised by wording.** The web showed the server's sentence in every language, and the dial path
   recognised a missing permission by the word "permission" in Meta's text. No stable reason reached the web.
5. **TURN is configuration nobody can see.** With no TURN a browser behind a strict NAT connects and hears nothing; no screen or check said
   whether the operator had set it, or whether the JSON in `CALLING_ICE_SERVERS` was even valid (a bad list silently became public STUN only).
6. **Token permissions are never checked** for calling (`whatsapp_business_management` to change the setting, `whatsapp_business_messaging` to
   call), and a token that expires in a few days looks fine today.
7. **No test call.** The only way to hear a call was to place one to a real customer, which needs the permission flow to have been answered.
8. **No operator documentation** of the Meta side (app, webhook fields, number prerequisites, TURN).

Checked and found fine (not changed): inbound routing (every person with `call.calls.use` sees the ringing call, the first to accept wins,
atomic claim), the missed-call bubble in the customer's thread, call logs and their record scope, recording consent, retention and legal
hold (BL-144), all tenant-scoped by `org_id` and the workspace's number; the e2e suite covers the toggle, permission, dial, answer, hang up,
recording and logs against a fake Meta. **Not built and not blocking:** routing a ringing call to a specific agent or team (it rings for all), a
voicemail or AI answer when nobody picks up (the AI half of calling, see the wiring map "Not built").

Not in this build, because Meta's side cannot be done from here: Meta's **calling hours**, **callback permission**, **SIP** settings and the call icon's
visibility are Meta settings of the number; the card only reads the icon (a hidden icon is a warning). Countries where business-initiated calls are
restricted change over time; the runbook says to check Meta's list, and a refusal for it shows as a reason.

### Overlap with parallel work (do not rework)

`git log origin/main -- apps/api/src/modules/whatsapp-cloud-api-waba` shows the Pinnacle partner onboarding (#98, #142, #197), the official-only
switch (#103), the group send guard (#113) and Groups. Open PRs at the time: #414 (WhatsApp Forms and Link Generator) and #415 (auth design); by their titles neither
is about the WABA onboarding (their file lists were not read). This build does **not** change `WabaConnectService` or the onboarding flow. It adds a clean seam:

- it **listens** to the existing `whatsapp.connection.connected` outbox event (and so also gets reconnects and provider moves);
- it adds **one additive method** to `WabaDiagnosticsService` (`ensureFields`, read-only unless the worker asks to write) and exports that service from the WABA barrel, so the calling
  domain can read and extend the platform app's webhook fields without a second copy of the callback and verify-token logic;
- it reads the number through `WabaConnectService.resolveConnection` and the `WABA_ADMIN` port, as the calling code already did.

Anyone changing the connect flow keeps working as long as the connected event keeps `connectionId`; if the event is renamed, the consumer
(`CallingConnectConsumer`) is the one place to change. The coexistence-refusal rule (`COEXISTENCE_MESSAGE`) is reused, not copied.

### Reference

`reference/app` has the toggle only (`WaCallingController@toggle`, `WaCallingService::enable`, the card in `waba-health.blade.php`): calling is switched
on by hand per number, with a coexistence check and Meta's refusal translated in two cases. It has no readiness check, no `calls` field
handling (it documents the field as a prerequisite in the refusal text), no scheduled check and no TURN check. Everything below the first section
of this file is therefore an extension (EXT-CALL-007 to 011).

## 2. What was built

| Part      | What                                                                                                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts | `packages/contracts/src/calling-voice/readiness.ts`: checklist keys, states, codes, status, source, the workspace setting, Meta's refusal reasons                                                                                                                                                                                 |
| Database  | migration `20261206090000_calling_readiness.sql`: `wa_calling_readiness` (one row per number: checklist as codes, Meta's status, when and why, when next) and `wa_calling_settings` (one row per workspace: automatic switch-on, off by default); RLS enabled and forced, composite FKs, touch trigger; Drizzle mirror            |
| Rules     | `calling-readiness.rules.ts` (pure: facts in, one row per prerequisite out, status, schedule) and `calling-meta-errors.ts` (Meta error code to stable reason)                                                                                                                                                                     |
| Service   | `CallingReadinessService`: reads Meta (phone, token, subscribed apps, calling settings), the workspace (plan, people who may call, recording rules) and the platform (TURN); in the worker only, repairs the `calls` field; keeps the result; brings the switch in line with Meta (audited); the opt-in switch-on after a connect |
| API       | `GET /v2/calling/readiness`, `GET /numbers/:id/readiness`, `POST /numbers/:id/readiness/check`, `GET/PUT /settings` (see [the API doc](../../api/calling-voice.md)); `CALL_META_REFUSED` now carries a `reason`                                                                                                                   |
| Worker    | queue `calling-readiness`; `CallingConnectConsumer` (outbox `whatsapp.connection.connected`, 20 s delay, plan-gated), `CallingReadinessProcessor`, `CallingReadinessScheduler` (every minute, due numbers claimed for 30 minutes, job id carries the window)                                                                      |
| Meta port | `CALLING_GRAPH.getSettings` (`GET /{phone_number_id}/settings`); `WabaDiagnosticsService.ensureFields`                                                                                                                                                                                                                            |
| Web       | `ReadinessCard` in each number's card on `/calling` and on the number's health page, the automatic switch above the numbers, `TestCallButton`, error text by reason (`use-error-text.ts`), 125 new strings in 21 languages                                                                                                        |
| Docs      | the runbook, the help guide (`calling-overview.md`), wiring, parity, product extensions, inventory, tracker rows, API doc, `.env.example`                                                                                                                                                                                         |
| Tests     | see section 5                                                                                                                                                                                                                                                                                                                     |

### How the pieces answer the brief

- **After connect, automatically.** The connect event queues a check about 20 seconds later (Meta needs a moment). The worker's check adds `calls`
  where required, reads Meta's calling settings, stores the result, and **if the workspace has the plan feature `waba_calling` and an admin turned on
  "Turn calling on automatically after a number is connected"**, switches calling on when no other row blocks it. Reconnects are the same event.
- **On demand, on a schedule, and when the health screen runs.** `Check again`; the card checks by itself when its result is older than 15
  minutes and the person may change calling (opening the health page opens the card); the worker looks at due numbers every minute (30 minutes
  after a blocked one, 3 hours after one needing attention, 6 hours after a ready one).
- **Never silently.** No check switches calling on except the one after a connect, for an opted-in workspace with the plan feature and no blocker, and
  that is in the audit log with a system actor. A plan without calling is not asked about at all (no Meta request), and the setting cannot be saved.
- **Each prerequisite is a row** with state ok, warn or fail, what was found and what to do (see the runbook table). `calling_off` is the one fail that
  is the point of the page, not a blocker.
- **Meta's errors** are stable reasons on the problem (`errors: [{ path: 'reason', message }]`), mapped by Meta's code, and by wording only for the
  prerequisite and missing-permission refusals together with code 100, on the server. The web never reads a message.
- **Test call.** A button on the card (calling on, number not blocked) that uses the existing dial path with a number the admin types. WhatsApp's permission rule
  applies; the card explains it. The existing dialler already placed calls from a conversation; this adds the same path without one.

## 3. Decisions (made without asking; the owner can reverse any of them)

1. **Automatic switch-on is opt-in and off by default**, per workspace (`wa_calling_settings.auto_enable_on_connect`). A calling switch changes
   what customers see in their chat (a call icon), so no workspace gets it without an admin saying so.
2. **A check never switches calling on** except to finish a pending automatic switch-on (R1), which only a connect starts and only an opted-in workspace has. A scheduled check that finds a
   number off leaves it off (an admin may have turned it off at Meta on purpose).
3. **Meta is the source of truth for the switch.** A check brings the local flag in line with what Meta reports, in both directions, audited.
   Reference changed the flag only by the toggle. Not doing this was the cause of finding 2.
4. **The `calls` field is repaired by the platform's worker, additively, only on the platform's own Meta app (the number's token must provably belong to it),
   only when that app already has a callback, and under a Redis lock.** It never sets a first callback, never removes a field, and does nothing for a
   customer's own app, a provider or a token that could not be inspected (a warning on the card). A request, including a workspace admin's **Check
   again**, only reads the subscription: an independent review pointed out that letting a tenant rewrite a Meta app shared by every workspace is a
   privilege problem, and that Meta replaces the whole field list on a write (two writers drop each other's field). The consequence: right after a
   connect the card may say the field is missing for the time it takes the worker's check to run (about 20 seconds), and on a platform whose app
   has no callback the first subscription is the operator's.
5. **Reuse the existing permissions.** Reading the checklist and the setting is `call.calls.use`; checking and saving the setting is
   `call.calling.manage`; no new permission key (so no migration to the permission registry). The test call needs only `call.calls.use` because it
   is the same dial the inbox's Call button does.
6. **The read routes work without the plan feature.** They answer with a `plan_missing` checklist and ask Meta nothing, instead of 422, so the
   health page can say why. The write of the setting needs the plan feature.
7. **Codes, not sentences, cross the network.** One code per outcome of a row; the web holds the words. This is why there are 125 new strings and
   why a code and its words are tested against each other (`readiness-messages.test.ts`).
8. **TURN is a warning, not a block**, because a first test on an open network works without it. A TURN server listed with no username or credential and
   an unparseable list are their own findings.
9. **Scheduled checks only for numbers that matter**: calling on, or already checked once. A connected number nobody prepared costs nothing.
10. **The tracker rows are `EXT-CALL-007` to `011`** (the existing numbering for work that is not in Reference), appended to Vedant's tracker, the
    owner of calling, as the brief asked.
11. **No change to the connect flow or to `WABA_PLATFORM_WEBHOOK_FIELDS`**: adding `calls` there would have made the platform's coexistence and
    Groups status report "not ok" for everyone until an operator subscribed it, and changed other people's tests and screens.

## 4. Manual test with a real number

Nothing here has been done; this is the list for the first real number. Do it on a **test number** first (it is exempt from the messaging limit),
then on the real one. Write what you saw next to each step.

**Meta side, before anything**

1. Meta app: WhatsApp product added, live mode, business verified. Console, WhatsApp page: app id, app secret, config id, verify token saved.
2. App dashboard, WhatsApp, Configuration, Webhook: callback URL and verify token match the console; fields `messages` and **`calls`** shown. If `calls` is
   not ticked, leave it: the worker's check in step 6 should add it. (If you tick it yourself, it should say it was already there.) The
   app must already have its callback, or the platform will not add anything.
3. A system user token with `whatsapp_business_management` and `whatsapp_business_messaging`, or an Embedded Signup connection.
4. A phone you control with WhatsApp installed (to be called, and to call in), on a recent version, not in a country Meta restricts for calling
   (check Meta's current list). A second device with a browser and a microphone, on another network if you can (to test TURN).
5. TURN: a coturn (or any TURN) reachable from the browser; `CALLING_ICE_SERVERS` set on the API and the worker; restart both.

**In the app**

6. Connect the number (Channels, WhatsApp). Wait about 30 seconds. Open Settings, Calling.
   Expect: the number's card has **Ready for calls?** with a badge. Rows for plan, connected, Cloud API only, registered, messaging limit,
   token permissions, subscribed, calls webhook, calling switched on (red until step 8), TURN, teammates, recording. In the database,
   `wa_calling_readiness` has a row with `source = 'connect'`. If the `calls` field was added by the platform the row says so.
7. Break something on purpose and check: use a token without `whatsapp_business_messaging` (or a number below the limit). Expect the matching row
   to say **Fix this** with its instruction, the badge **Not ready**, and the Enable button's hint. Put it right, **Check again**, expect it green.
8. Select **Enable calling**. Expect the toast, the badge **Ready**, "Calling switched on at WhatsApp" green. In Meta's tools the number's calling status is `ENABLED`.
9. Turn it off at Meta (not in the app), then **Check again**. Expect the card to say calling is off and the Call button to disappear from the
   number's chats. Turn it on at Meta, check again, expect it back.
10. Turn **Turn calling on automatically** on. Disconnect and reconnect the number (or connect another test number). Expect calling on after about
    30 seconds with no click, and an audit row (actor `system`). Turn the setting off again and repeat: expect it left off.
11. Remove the plan feature `waba_calling` from the workspace (override): expect the card to say the plan lacks it and **no** request to Meta in the API
    log; restore it.

**A real call**

12. **Test call.** On the card, **Place a test call**, your phone's number with the country code. First time: expect a permission request on the phone
    (a WhatsApp message with Allow and Don't allow) and a toast saying so, no call. Tap **Allow**. Press **Call me** again: the phone rings; answer;
    speak both ways (audio both directions confirms the relay if the browser is behind NAT and TURN is set).
13. **Inbound.** From the phone, open the chat with the business number and tap the call icon. Expect the incoming-call popup in the inbox for
    everyone who may call; accept in one browser; the second browser's popup goes away; audio both ways; hang up; a call bubble in the customer's
    thread; the call in Call logs.
14. **Declined and missed.** Decline a call on the phone, let one ring out, and decline an incoming one in the app: the bubble and the log say
    declined, no answer and missed respectively.
15. **Recording** (only if wanted): turn it on with a notice, record a call with consent, play it, delete it.
16. **TURN.** From a network that blocks UDP, place the test call: expect audio. Set `CALLING_ICE_SERVERS` to empty and look at the card: the TURN
    row warns.

**What to send back if something differs:** the card's JSON (`GET /v2/calling/numbers/:id/readiness`), the problem body of any refusal (its
`reason` and `message`), and the Meta error code in the API log. A code that shows "WhatsApp refused the request" with no reason is one to add
to `calling-meta-errors.ts`.

## 5. Tests

- **Unit** (`apps/api/test/unit/calling-voice/`): `calling-readiness-rules.spec.ts` (every outcome of every row, the status, the schedule, TURN),
  `calling-meta-errors.spec.ts` (the code and wording mapping, the problem detail).
- **End to end** (`apps/api/test/e2e/calling-voice/calling-readiness.e2e.spec.ts`, deleted with WhatsApp calling, migration `20270324090000`): real API, worker side and Postgres (restricted role) and Redis; Meta is
  a fake behind the one HTTP client. Covers: a ready number and the stored result; calling off at Meta; each failing row; coexistence (local and from Meta);
  a disconnected number (no Meta request); a rejected token and a failed read as rows, not errors; the `calls` field: a request only reads it, the worker adds
  it keeping the others, the lock between workers, no callback, a customer's own app, a token that cannot be tied to the platform app; a page-open check
  shared within a minute; the conditional switch write; TURN states; people who can call and the recording rules; no plan (no Meta request, no switch-on, the setting
  refused); the switch following Meta with its audit row; the automatic switch-on (not opted in, opted in, blocked, Meta reads that failed, refused by Meta with its reason);
  the connect event queued once per event and run by the worker; the plan gating the queue; the schedule (due numbers only, never switches on);
  permissions (403 for who may not), another workspace (404, nothing written); a stale or first save of the setting (409), and turning the setting off without the plan; Meta's refusals as reasons
  on toggle and dial; the toggle's audit row.
- **Web** (`apps/web/src/features/calling-voice/`): `lib/readiness.test.ts`, `components/readiness.render.test.tsx` (the card for every status, read-only,
  the refusal reason, the test call gate, every code and reason in all 21 languages), `components/readiness.dom.test.tsx` (the card checks by itself once,
  not without permission, and Check again), `readiness-messages.test.ts` (words for every code and reason), and the existing `messages.test.ts`.
- **Playwright** (`apps/web/e2e/calling-voice/readiness.spec.ts`): the card on `/calling` and the health page, Check again, the setting. Skips without
  `CALL_E2E_EMAIL` and `CALL_E2E_PASSWORD` and a connected number. **Not run here** (no stack was running).
- What is simulated: **every Meta answer**. No real Meta app, number, token, webhook or phone was used.

## 6. Review

A second reader (a separate agent given only the code, not these conclusions) went through the change and found nine defects; all nine were fixed
and have a test. The ones worth knowing: a workspace's **Check again** could rewrite the Meta app shared by every workspace (now read-only for a
request; the worker adds `calls` under a lock, and only for a token proven to belong to the platform's app); a check could switch the Call button back
after a person changed it (the write is conditional, and the check after a person's own switch does not sync); a row that could not be read
counted as a pass for the automatic switch-on (it now needs every row read); a test call could be cut when the card refreshed (the calling provider now
belongs to the screen); the scheduler could take the same stuck numbers every window (it now claims them for 30 minutes in one statement); turning the
setting off needed the plan (it no longer does).

## 7. Review round 2 (decisions R1 to R9)

A code review of the staged change found nine more defects; all fixed, each with a test. They change the decisions above as follows.

- **R1. The automatic switch-on is pending, not one-shot.** A connect sets `wa_calling_readiness.auto_enable_pending` (same, still-unmerged migration:
  `auto_enable_pending`, `auto_enable_attempts`). Every later check, the schedule's and a person's **Check again**, tries while it is pending. It ends when calling is on,
  when the plan or the workspace setting no longer allow it, or when a person turns calling off (the toggle). A check that cannot read Meta while pending looks again
  after 1, 5 and 15 minutes, then at the normal rhythm; the scheduler therefore wakes every minute. A blocker or Meta's refusal leaves it pending (decision 2 above now reads: a
  check never switches on **except** to finish a pending automatic switch-on). Not bounded in time: it waits for the blocker to be fixed or the admin to withdraw it.
- **R2. A check never fails for Meta or Redis.** The `calls` field step is wrapped (a failure is "could not be verified"), the settings refresh is inside the guarded read, and
  the lock is released with a compare-and-delete on a random token, so a worker whose lock expired cannot delete another's.
- **R3. Stale reads.** The Meta-to-local sync only writes if the number is unchanged since the check began (database clock, `updated_at`) and still reads what the check read;
  `save` is an ordered upsert (a result older than the stored one is dropped, and its audit row is not written).
- **R4. The card's automatic look is a `health` check** (the server shares one look per minute); only the button is `manual`. A check refreshes only the readiness list, and the
  numbers list when the local switch moved, not every calling query.
- **R5. Error mapping by code.** The wording rules apply only together with Meta's code 100; the messaging-limit and region wording rules were removed (and their two reasons, strings and
  tests): there is no known Meta code for them. The web shows the reason's words and Meta's own sentence in brackets, and only for switch-on, dial and permission request, not for accept, decline or hang up.
- **R6. No status in Meta's answer is not a pass.** It is `meta_unreadable` (warn), never "ready", and the local flag no longer stands in for it.
- **R7. `resolveConnection` runs in its own transaction and is not caught**: a registry or database fault is retried by the queue, not stored as "no credentials".
- **R8. The schedule's claim re-checks `next_check_at`** in the update, so a row another worker already claimed is not claimed twice.
- **R9. Queueing is `addBulk`; if it fails the claimed numbers are given back** (their `next_check_at` set to now) and the error is raised.
