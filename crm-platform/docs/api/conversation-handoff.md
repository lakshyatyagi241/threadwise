# API: conversation handoff and the waiting queue

BL-396 to BL-404. One action says "a person must take this conversation"; the waiting queue, claim, return to bot, the handoff card and the
workspace settings. Design: [specs/conversation-handoff-and-assignment.md](../specs/conversation-handoff-and-assignment.md). Code map:
[wiring/conversation-handoff.md](../threadwise-port/wiring/conversation-handoff.md). Base path `/v2/inbox`; errors are `application/problem+json`
with a stable `code`. None of these routes is behind a plan feature: the queue works on every plan. What a plan adds is decided inside the
service and reported as `available` in the settings.

## The handling state

`conversations.handling` (expand-only column, `null` = not tracked, behaves as before). The list and detail carry it as `handling`
(`with_bot | waiting | with_person | null`) with `handlingSince`. `status` and every existing filter are untouched.

| Value         | Meaning                                                    | Bot       |
| ------------- | ---------------------------------------------------------- | --------- |
| `waiting`     | in a queue (a team's, or the workspace's); nobody holds it | muted     |
| `with_person` | a person holds it                                          | muted     |
| `with_bot`    | a person gave it back                                      | answers   |
| `null`        | no handoff ever touched it, or it was resolved             | as before |

Resolving, closing or marking spam clears it. A person assigning a `waiting` or `with_bot` thread makes it `with_person`; unassigning a `with_person`
thread puts it back in the queue.

## Routes

| Method and path                                  | Permission                       | What                                                                                                         |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /conversations?tab=waiting`                 | `inbox.conversation.read`        | the queue, in the caller's ordinary visibility; `GET /counts` carries `waiting`                              |
| `POST /conversations/:id/claim` `{ rowVersion }` | `inbox.conversation.assign_self` | take a conversation nobody holds; `409 CONFLICT` when somebody did first; `{ conversation, ownerSet }`       |
| `POST /conversations/:id/handoff`                | `inbox.conversation.assign`      | send to a person, a team queue or the rules; same action a flow, an AI agent or a keyword uses               |
| `POST /conversations/:id/return-to-bot`          | `inbox.conversation.reply`       | unassign and unmute the bot; answers `{ conversation, resumed, nextMessageBy, why, alreadyWithBot }` (below) |
| `GET /conversations/:id/handoff`                 | `inbox.conversation.read`        | the latest handoff card: reason, summary, answers, destination, outcome, trace                               |
| `GET /handoff-settings`                          | `inbox.settings.read`            | settings with `available` per capability                                                                     |
| `PUT /handoff-settings`                          | `inbox.routing.manage`           | change settings; `422 PLAN_FEATURE_LOCKED` names the locked fields                                           |

`POST .../handoff` body: `{ reason, reasonText?, summary?, destination, priority? }`, destination `{ kind: 'person', userId, teamId? } | { kind: 'team', teamId } | { kind: 'rules' }`.
It answers `{ outcome, handoffId, refused, conversation, handoff }`; `outcome` is `assigned`, `waiting` or `unavailable` (out of hours, or nobody could ever take it:
it still enters the queue). `refused` is set (and nothing is written) for an archived thread, spam or a personal mailbox.

## Return to bot (BL-410)

`POST .../return-to-bot` is idempotent and always says what the bot will do (`resumed`):

- `flow`: the handoff came from a flow's Human handoff node whose optional `returned` exit (builder handle `returned`, runtime port 4,
  `HANDOFF_RETURNED_PORT`) leads to a step that still exists, in a flow that is published and on. In the same transaction the API writes the timeline
  event `handoff_returned` and the outbox event `handoff.returned_to_bot`; the worker (`HandoffReturnConsumer`) then sends the node's optional
  `returnMessage` (rendered with the contact and the run's variables, deterministic client id, normal outbound path so the 24 hour window and consent
  are enforced; a refusal is reported, never thrown) and starts the flow at the exit's target (run source `handoff`, `trigger_ref` `return:<handoff>`,
  carrying the paused run's variables) under the conversation's row lock, so a person who claimed the chat again wins. A redelivered event finds the
  run and does nothing.
- `next_message`: nothing is sent now. `why` is `no_flow_handoff` (a person, the AI marker or a keyword made the handoff), `no_returned_exit`,
  `run_gone`, `flow_gone`, `flow_not_live` or `node_gone`; `nextMessageBy` is `live_flow` (a run is parked for this customer) or `default_flow` (the
  next message starts the default-route flow if the workspace has one, else nobody answers).
- `alreadyWithBot: true` on a second press: nothing changed, nothing was sent.

Staff-only lines: a `system` message with `meta.event = 'bot_returned'` (`botStage: 'pressed'` at once, `'result'` when the worker is done, with
`botResult`: `continued | claimed_again | flow_not_live | start_failed` and `botCustomer`: `sent | window_closed | no_consent | failed | channel_unavailable`)
appears in the thread in real time; the timeline gets `handoff_returned`, then `bot_resumed` or `bot_resume_skipped`.

## Who is found (every step is in `trace`)

1. a named person (leave and delegate honoured; availability and hours are not asked);
2. the owner, then the last handler, per the workspace mode and plan;
3. the destination team's own method (`round_robin`, `least_loaded`; needs `inbox_routing` and the switch), then the team's default assignee;
4. the workspace rules for destination `rules` (needs `inbox_routing` and the switch; a rule that starts a flow, answers, marks spam or escalates is skipped at handoff);
5. the queue (the team's, else the workspace's). Always works.

A team whose business hours are closed gets no person picked: the conversation waits in its queue with outcome `unavailable`.

## Settings

| Field                   | Default       | Needs                                                                                                           |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `autoAssign`            | `true`        | `inbox_routing`. Off stops rules and team methods at handoff AND at arrival. Default on keeps today's behaviour |
| `claimSetsOwner`        | `false`       | nothing: a claim makes the claimer the contact owner when nobody ever decided it                                |
| `ownerMode`             | `independent` | `owner_first` / `keep_in_sync` need `inbox_routing` and `inbox_assignment_sticky`                               |
| `continuityDays`        | `null`        | same; limits the "last handler" sticky to N days                                                                |
| `promptOwnerOnReassign` | `false`       | same (stored; the prompt is a follow-up)                                                                        |
| `notifyQueue`           | `true`        | nothing                                                                                                         |

`inbox_assignment_sticky` is a plan feature (default on for plan rows that predate it, effective only with `inbox_routing`): the owner moves it between plans in plan management.

## Waiting queue timers, away rules and the claim limit (Smart routing; claim limit is base)

Settings (`GET/PUT /inbox/handoff-settings`) gain `queueTimers` (`remindMinutes`, `overflowMinutes` + `overflowTeamId`, `unclaimedMinutes` + `unclaimedAction` `keep|message|bot` +
`unclaimedMessage`) and `away` (`returnUnanswered`, `autoOfflineMinutes`). Both need `inbox_routing` (`available.queueTimers`, `available.away`): a save that switches something on without
it is 422 `PLAN_FEATURE_LOCKED`; stored values are kept and read as off. An incomplete step is 422 `VALIDATION_FAILED` with the field (`queueTimers.overflowTeamId`, `queueTimers.unclaimedMessage`).
The handoff card carries `timers` (`remindedAt`, `offeredAt`, `offeredFrom`, `finalAt`, `finalAction`); handoff `source` has a new value `arrival` (a new chat nobody could take; it does not mute the bot).

- `QueueTimersService` (worker, every 30 s): only workspaces that configured a timer and have the feature are looked at; each step is claimed by a conditional UPDATE (`reminded_at IS NULL` ...) under the chat's row lock,
  so it runs once; the chat must still be open, `handling = waiting`, unassigned, with a `waiting` card (a claim, resolve, archive or Return to bot cancels by changing that state). Minutes count only while the chat's team is open (`waitedOpenMinutes`).
  Remind emits `conversation.queue_reminder` (bell + push to the team's members, or the leads when there is no team). Offer reassigns the chat to the overflow team once (timeline `queue_offered`). Final `message` sends the text with a deterministic client id
  (`{{name}}`, `{{first_name}}`), final `bot` is `giveBackInTx` with a system actor.
- `AwayService`: on `member.availability_changed` (status offline) and `member.leave.started`, returns the person's open chats with `waiting_since` set (not groups, not personal mailboxes) to the team's queue with a card and trace line `returned_offline|returned_leave|returned_inactive`.
  A stale event does nothing when the person is back online. A 1-minute sweep sets Available people Offline after `autoOfflineMinutes` without session activity (the latest of `auth_sessions.last_used_at` and the Redis activity key); nobody is set Available by the system.
- Claim: `POST /inbox/conversations/:id/claim` is 422 `INBOX_CLAIM_OVER_LIMIT` (`errors[]` `open`, `limit`) when the claimer already holds their `chat_limit` of open chats; resend with `acknowledgeLimit: true` to take it anyway. Base feature, every plan.
- Migrations `20270324090000_waiting_queue_timers` (+ `_validate`) and `20270326090000_away_rules`: expand-only, defaults off.

## Owner alignment and the record assignment engine

The contact owner is only ever written by a **first touch**: `UPDATE contacts SET owner_id = ... WHERE owner_id IS NULL AND owner_changed_at IS NULL`, the exact guard of
the record engine, under the row lock. One of the two wins; the database trigger stamps `owner_changed_at`, so the engine reads a claimed owner as a person's decision and never
moves it. The audit row (`ownerSource`) and the `contact.updated` event (`source: chat_claim`) record where it came from. In mode `keep_in_sync`, a changed owner
(`contact.updated` from a person, a bulk edit, a reassign batch or its restore, or the engine) moves the contact's open conversations that an automatic source
assigned (`rule, owner, sticky, sync, system`) or nobody did, never one a person took; events with `source` `chat_claim` or `owner_sync` are ignored (no loop).

## Events

Outbox `conversation.handoff_requested` (`conversationId`, `handoffId`, `source`, `reason`, `outcome`, `toUserId`, `toTeamId`); timeline events `handoff_requested`, `handoff_returned`, then the
usual `assigned` / `reassigned` / `unassigned` (strategy may now be `handoff`, `owner`, `claim`). Assigning to a team still notifies the team (`conversation.assigned`).
