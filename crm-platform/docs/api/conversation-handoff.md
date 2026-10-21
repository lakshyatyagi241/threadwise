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

| Method and path                                  | Permission                       | What                                                                                                   |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /conversations?tab=waiting`                 | `inbox.conversation.read`        | the queue, in the caller's ordinary visibility; `GET /counts` carries `waiting`                        |
| `POST /conversations/:id/claim` `{ rowVersion }` | `inbox.conversation.assign_self` | take a conversation nobody holds; `409 CONFLICT` when somebody did first; `{ conversation, ownerSet }` |
| `POST /conversations/:id/handoff`                | `inbox.conversation.assign`      | send to a person, a team queue or the rules; same action a flow, an AI agent or a keyword uses         |
| `POST /conversations/:id/return-to-bot`          | `inbox.conversation.reply`       | unassign and unmute the bot                                                                            |
| `GET /conversations/:id/handoff`                 | `inbox.conversation.read`        | the latest handoff card: reason, summary, answers, destination, outcome, trace                         |
| `GET /handoff-settings`                          | `inbox.settings.read`            | settings with `available` per capability                                                               |
| `PUT /handoff-settings`                          | `inbox.routing.manage`           | change settings; `422 PLAN_FEATURE_LOCKED` names the locked fields                                     |

`POST .../handoff` body: `{ reason, reasonText?, summary?, destination, priority? }`, destination `{ kind: 'person', userId, teamId? } | { kind: 'team', teamId } | { kind: 'rules' }`.
It answers `{ outcome, handoffId, refused, conversation, handoff }`; `outcome` is `assigned`, `waiting` or `unavailable` (out of hours, or nobody could ever take it:
it still enters the queue). `refused` is set (and nothing is written) for an archived thread, spam or a personal mailbox.

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

## Owner alignment and the record assignment engine

The contact owner is only ever written by a **first touch**: `UPDATE contacts SET owner_id = ... WHERE owner_id IS NULL AND owner_changed_at IS NULL`, the exact guard of
the record engine, under the row lock. One of the two wins; the database trigger stamps `owner_changed_at`, so the engine reads a claimed owner as a person's decision and never
moves it. The audit row (`ownerSource`) and the `contact.updated` event (`source: chat_claim`) record where it came from. In mode `keep_in_sync`, a changed owner
(`contact.updated` from a person, a bulk edit, a reassign batch or its restore, or the engine) moves the contact's open conversations that an automatic source
assigned (`rule, owner, sticky, sync, system`) or nobody did, never one a person took; events with `source` `chat_claim` or `owner_sync` are ignored (no loop).

## Events

Outbox `conversation.handoff_requested` (`conversationId`, `handoffId`, `source`, `reason`, `outcome`, `toUserId`, `toTeamId`); timeline events `handoff_requested`, `handoff_returned`, then the
usual `assigned` / `reassigned` / `unassigned` (strategy may now be `handoff`, `owner`, `claim`). Assigning to a team still notifies the team (`conversation.assigned`).
