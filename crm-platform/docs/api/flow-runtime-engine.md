# API: flow-runtime-engine (FLR)

Base `/v2/flow-runtime`, cookie or bearer session; ids are uuids. Reads need `flr.runs.read`, changes `flr.runs.manage` (Owner and Admin by
default). The contract types are in `@crm/contracts` (`flow-runtime-engine`).

| Method and path                          | What                                                                    | Notes                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /runs`                              | runs, newest first                                                      | filters `flowId`, `contactId`, `status`, `source`; `limit` (25), `cursor`                  |
| `GET /runs/:id`                          | one run: state, variables, step log                                     |                                                                                            |
| `POST /runs/:id/cancel`                  | end a live run                                                          | 204; 409 `FLR_RUN_STATE_CONFLICT` when it is over                                          |
| `POST /flows/:flowId/enroll`             | enrol `contactIds[]` or a `groupId`                                     | up to 500; 422 `FLR_FLOW_INACTIVE`; a contact already in the flow is counted, not launched |
| `GET /flows/:flowId/subscribers`         | who is in the flow                                                      | `status`, `cursor`; `counts` cover every subscriber                                        |
| `POST /flows/:flowId/retry-failed`       | retry every failed subscriber                                           | up to 500                                                                                  |
| `POST /subscribers/:id/pause` / `resume` | keep or release a run's place                                           | 409 when the status does not allow it                                                      |
| `POST /subscribers/:id/retry`            | new run for a failed subscriber                                         | 409 `FLR_NOT_RETRYABLE`                                                                    |
| `GET /analytics`                         | totals, completion rate, trend, failure reasons, by source, leaderboard | `days` (30), `flowId`                                                                      |
| `POST /conversations/:id/start`          | start a flow on an open conversation                                    | 202 `{ runId }`                                                                            |

API-key routes (the `/public/v1` signed scheme, scoped to the key's workspace):

| Method and path                        | What                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /public/v1/flows`                 | flows, most recently updated first                                                                                                      |
| `GET /public/v1/flows/:id`             | one flow with `subscribers`                                                                                                             |
| `POST /public/v1/flows/:id/enroll`     | `{ contactId }` or `{ phone }`; 201 with the subscriber as it is, launched or not; 404 `FLR_CONTACT_NOT_FOUND`, 422 `FLR_FLOW_INACTIVE` |
| `GET /public/v1/flows/:id/subscribers` | `limit` 1..200                                                                                                                          |

Run statuses: `running`, `waiting` (parked on a reply), `sleeping` (a Delay), `halted` (the channel was down, the daily cap was reached, or a
person paused it; it tries again by itself unless paused), then `completed`, `failed`, `cancelled`, `expired`. Sources: `keyword`,
`any_message`, `tag_added`, `group_join`, `contact_created`, `opt_in`, `order_placed`, `deal_stage_changed`, `away`, `out_of_hours`,
`manual`, `api`, `routing`, `campaign`, `webhook_lead`, `handoff`, `inbox`, `retry`.

What other domains call: `FlowLaunchService.start(orgId, input)` (every launch path), `FlowTriggerService` (`onOrderPlaced`, `onTagAdded`, ...), and the
`InboundMessageHooks` listener answer (`consumed`) that an auto reply or an AI agent must read before it answers.

## Trigger producers

Events consumed by the worker: `order.placed`, `store.order_placed`, `whatsapp.order.received`, `contact.opt_in` (`optedIn: true`), `routing.flow_requested`, `lead.created` / `lead.updated` (with `flowId`). See the wiring map for the reason of each start. A start caused by a run's own step carries `__trigger_hops`; five in a row are refused (subscriber `failed`, code `FLR_TRIGGER_LOOP`). A run not started by a customer message whose free-form messages the 24 hour window refused ends `failed` with `SERVICE_WINDOW_CLOSED`.
