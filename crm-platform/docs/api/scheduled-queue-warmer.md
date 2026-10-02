# Scheduled messages and the warmer API (SCHED)

Base `/v2`. Contracts: `packages/contracts/src/scheduled-queue-warmer/index.ts`. Reads need `sched.schedules.read`, changes
`sched.schedules.manage`, the warmer `sched.warmer.manage` and the plan flag `whatsapp_warmer`. Creating needs the plan flag
`scheduled_messages` and the plan limit `scheduled_messages` (a live count of every status; deleting frees a slot).

| Method and path | What |
| --- | --- |
| `GET /scheduled?tab=&q=&limit=&offset=` | schedules with tab counts, search and the next one due |
| `GET /scheduled/options` | senders (with `warming`), groups, tags, earlier broadcasts, templates, the lead time |
| `POST /scheduled/audience-preview` | `{total, optedOut, sample}` for a draft audience |
| `POST /scheduled` | create (idempotent); one schedule per sender when the audience is split |
| `GET /scheduled/:id` | detail with recipients (first 200) and counts by status |
| `PATCH /scheduled/:id` | name, time, message of a waiting or paused schedule; `rowVersion` required |
| `POST /scheduled/:id/pause`, `resume`, `cancel`, `run-now` | lifecycle; 409 when the status does not allow it |
| `POST /scheduled/:id/retry` | new date and time; failed recipients are tried again |
| `DELETE /scheduled/:id` | delete (204) |
| `GET /warmer` | every number with profile, budget today, sent today, health |
| `PUT /warmer/:key` | save a number's profile; key is `<engine>:<uuid>` |

Create checks, in order: plan flag, plan limit, timezone and a start at least 2 minutes ahead, the message, senders (forged or stale keys are
dropped), audience (opted-out and archived contacts are left out), the send guard (emergency halt, content), the wallet, the warmer's budget for
the send date. A failure writes nothing. Errors are problem+json with field paths.

Other domains schedule through `ScheduleProducerService.produce({orgId, key, source, name, phones, message, runAt})` and `cancel(orgId, key)`.
