# Wiring map: scheduled-queue-warmer (SCHED)

Read with [the inventory entry](../inventory/scheduled-queue-warmer.md). `built` = in this repo and tested; `covered:<id>` = built under another
domain's id (the engine is NODE's: WD-NODE-022, 030 to 036); `blocked:<domain>` = waits on a domain that does not exist yet; `intended` =
deliberately different (reason in [parity/scheduled-queue-warmer.md](../parity/scheduled-queue-warmer.md)). The inventory details 001 to 030; 031 to 045
are index rows only, ported from the reference source directly.

## How a schedule moves

| Step | WaDesk | Ours |
| --- | --- | --- |
| Store | `ScheduledController@store` writes rows, registers each with the Node bridge | `ScheduleCreateService` writes rows and recipient rows in one transaction; the row is the schedule |
| Wait | Node's in-memory cron (lost on restart, restored from `GET api/scheduled/active`) | `scheduled_messages.next_run_at`; `ScheduledDueService` queues due rows on BullMQ queue `sched-run` (job id `<uuid>-<epoch>-<attempt>`) |
| Run | Node `executeScheduledMessage` | `ScheduledRunService`: claims each recipient (`pending` to `processing`), warmer hours and gap, pacing, daily cap, lease per number, halt |
| Report | `POST api/update-schedule-status`, per-recipient callback | counters on the row; `ScheduledReceiptsService` takes delivery reports from the receipt router |
| Retry | heartbeat sweeper, `RetryPolicy` | `ScheduledDueService` re-queues failed one-offs on the retry policy |

## Rows

| Id | Feature | Permission | Feeds it | Consumers | Where | State |
| --- | --- | --- | --- | --- | --- | --- |
| WD-SCHED-001 | Scheduled list, stats, up next, tabs, search | `sched.schedules.read` | `GET /v2/scheduled` | `/scheduled` | `ScheduleReadService.list`, web list screen | built |
| WD-SCHED-002 | Composer wizard (5 steps) | `sched.schedules.manage` | `GET /v2/scheduled/options`, `POST .../audience-preview` | `/scheduled/create` | `ScheduleReadService.options`, web composer | built |
| WD-SCHED-003 | Create: validation, gates, persistence | `sched.schedules.manage` | composer | list, run | `ScheduleCreateService` | built |
| WD-SCHED-004 | Audiences: group, tag, queue, number | same | contacts, groups, tags, broadcasts | recipient rows | `ScheduleAudienceService` | built, `intended` (opted-out never messaged, one copy per person) |
| WD-SCHED-005 | Multi-sender fan-out | same | composer | one row per sender | `splitRoundRobin` | built |
| WD-SCHED-006 | Message types, media, template | same | composer | run | text, media by link, location, template as text on the unofficial engine and Twilio | partial: no upload, no Cloud API template (see parity) |
| WD-SCHED-007 | "Send a test to me first" | same | `testNumber` | sender transport | `ScheduleCreateService.sendTest` | built, `intended` (a typed number: users have no phone) |
| WD-SCHED-008 | Warmer budget reservation | same | warmer profile | warmer ledger | `WarmerService.hold` | built, `intended` (released on cancel, delete, fail) |
| WD-SCHED-009 | SendGate: halt, guardrails, wallet | `OUTBOUND_SEND_GUARD`, `WALLET_GATE` | AUTH, WALLET | create and run | `ScheduleCreateService`, `ScheduledRunService` | built |
| WD-SCHED-010 | Registration with the Node scheduler | none | create | none | the row is the schedule | covered:WD-NODE-030, intended |
| WD-SCHED-011 | Recurrence: cadence, weekdays, end, next run | same | composer | run | `schedule-time.ts` | covered:WD-NODE-030, 032 |
| WD-SCHED-012 | Detail and analytics | `sched.schedules.read` | `GET /v2/scheduled/:id` | `/scheduled/:id` | `ScheduleReadService.detail`, web detail screen | built |
| WD-SCHED-013 | Pause and resume | manage | list, detail | run | `ScheduleActionsService`, `SchedulerService` | built |
| WD-SCHED-014 | Cancel | manage | list, detail | run | same, releases warmer budget | built |
| WD-SCHED-015 | Run now | manage | list, detail | run | same | built |
| WD-SCHED-016 | Edit (PATCH) | manage | detail | run | same; lead time and version check added | built, `intended` |
| WD-SCHED-017 | Retry a failed schedule with a new time | manage | list, detail | run | same; failed recipients only | built, `intended` |
| WD-SCHED-018 | Delete | manage | list, detail | none | same, releases warmer budget | built |
| WD-SCHED-019 | Plan, role and limit gates | feature `scheduled_messages`, limit `scheduled_messages` | PLAN | create | `PlanEntitlementService` | built |
| WD-SCHED-020 | Node scheduler runtime | none | none | none | BullMQ and the due poller | covered:WD-NODE-030 |
| WD-SCHED-021 | One-off execution | none | run | receipts | `ScheduledRunService` | covered:WD-NODE-031 |
| WD-SCHED-022 | Recurring execution | none | run | run | `nextRun` after each run | covered:WD-NODE-032 |
| WD-SCHED-023 | Aggregate status callback | none | run | list | counters on the row | covered:WD-NODE-033 |
| WD-SCHED-024 | Per-recipient callback and billing | none | receipts | list | `ScheduledReceiptsService`; settling the wallet per delivery is the wallet domain's and is not verified for scheduled sends | covered:WD-NODE-035 |
| WD-SCHED-025 | Restore after a restart | none | none | none | nothing to restore: state is in the database | covered:WD-NODE-030, intended |
| WD-SCHED-026 | Durable retry sweeper | none | due service | run | `ScheduledDueService` | covered:WD-NODE-036 |
| WD-SCHED-027 | RetryPolicy | none | none | none | broadcast `retry-policy.ts` shared | covered |
| WD-SCHED-028 | REST API v1 scheduled endpoints | API key | none | none | `ScheduleCreateService` is the use case to call | blocked:API (the customer API domain does not exist; the repo's `public-api` is a lead-intake skeleton) |
| WD-SCHED-029 | Mobile app schedule-message | none | none | none | | blocked:MOB |
| WD-SCHED-030 | Programmatic producers | none | cart recovery (ECOM), reminders (APPT) | list | `ScheduleProducerService` | built |
| WD-SCHED-031 to 035 | Mobile message queues | none | none | none | | blocked:MOB |
| WD-SCHED-036 | Warmer page | `sched.warmer.manage` + plan `whatsapp_warmer` | `GET /v2/warmer` | `/warmer` | `WarmerService.list`, web warmer screen | built |
| WD-SCHED-037 | Save a number's profile | same | `PUT /v2/warmer/:key` | warmer | `WarmerService.save` | built |
| WD-SCHED-038 | Warmer engine: ramp, hours, gap, spintax | none | profile | send paths | `warmer-rules.ts`; scheduled run and every bulk sender | built, `intended` (hours, gap and spintax now also reach scheduled sends) |
| WD-SCHED-039 | Warmer daily ledger, where enforced | none | reservations | budget | `warmer_daily_sends`; schedule, broadcast and campaign launches | built |
| WD-SCHED-040 | Warmer health score | none | device status, failures | warmer page | `healthScore` | built |
| WD-SCHED-041 | Warmer access and plan gate | `sched.warmer.manage` + `whatsapp_warmer` | PLAN | warmer | `WarmerController` | built, `intended` (the gate actually closes) |
| WD-SCHED-042 | Node send-safety primitives | none | none | none | broadcast pacing, lease, cap, halt | covered:WD-NODE-029, 036 |
| WD-SCHED-043 | Pacing settings feed to Node | operator | none | none | `NodeBridgeSettingsService` and `PlatformPacingSettings` | covered:WD-NODE-029 |
| WD-SCHED-044 | UI-only and advertised-but-absent controls | none | none | none | not ported: controls with no behavior | intended |
| WD-SCHED-045 | Read surfaces of scheduled data in other pages | none | none | dashboards, contact timeline | | blocked:the pages' domains |
