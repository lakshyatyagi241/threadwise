# Runbook: lead sync, backfill and speed-to-lead

Two worker-side pieces of the lead pipeline (`LeadsWorkerModule`, worker process only). Neither can lose a lead: a lead is stored
before anything else happens to it, and both pieces only ever add (a pulled lead goes through the pipeline's idempotency key, a first
message has a unique row per lead).

## The `lead-sync` queue ("Sync now" and backfill)

One job per row of `lead_sync_runs`, id `lead-sync-<org>-<run>`, concurrency 2. A backfill of a portal with a five-minute minimum
interval takes minutes by design (one request per interval, window by window); a long queue of backfills is normal, a stuck one is not.

| Symptom                                        | Look at                                                                                                             | Do                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Run stays `queued` more than a minute          | `SELECT * FROM lead_sync_runs WHERE status = 'queued'`; the `lead-sync` queue in Redis                              | The sweep (every 30 s) queues it again. If it keeps happening, the worker is down or Redis is: fix that first       |
| Run stays `running`, progress not moving       | `heartbeat_at` (written after every request to the portal)                                                          | After 20 minutes of silence the sweep ends it `failed / interrupted`. Ask again; leads already received are skipped |
| "This source is already being pulled" for ever | `SELECT * FROM lead_sync_runs WHERE source_id = ... AND status IN ('queued','running')`                             | Wait for the sweep (above). Do not delete the row by hand: the unique index is what keeps two pulls apart           |
| Many `partial` / `too_soon` / `not_now` runs   | The marketplace connection's `last_poll_at` and `next_poll_at` (the poller and a backfill share the portal's limit) | Nothing to fix: the portal said wait. Run again later                                                               |
| Run `failed` with `credentials_refused`        | The installation's connection page                                                                                  | The portal refused the key. Reconnect the app; a backfill never changes the connection's own health                 |

Switching it off for one source: pause the source (a paused source refuses new runs). Platform-wide: stop the `LEAD_SYNC` processor
(the queue just fills); nothing else depends on it.

## Speed-to-lead (`lead_first_replies`)

Scheduled by the outbox consumer on `lead.created`, sent by a sweep every 10 seconds (`LeadFirstReplySweepService`). Messages are never
sent twice to one lead: the row is unique per lead event, a WhatsApp message carries the row's uuid as its idempotency key, and an SMS or
an email whose claim was interrupted ends `failed / interrupted` and is NOT retried (the provider has no idempotency key).

| Symptom                                   | Look at                                                                                                       | Do                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Lead has no first message though it is on | `lead_first_replies` for the lead event; the source's `defaults.speedToLead`; the outbox `lead.created` event | No row: the event was a test lead, a returning contact, or the setting was off at the time. A row: read `status` / `reason` |
| Rows `held`                               | `reason`: `quiet_hours`, `outside_business_hours`, `channel_unavailable`, `wallet_empty`, `send_halted`       | They go by themselves when the cause passes; a held message older than a day ends `failed / expired`                        |
| Rows `blocked`                            | `reason`: `opted_out`, `no_consent`, `minor`, `plan_limit`                                                    | Working as designed: the ConsentGate and the plan said no. There is no override                                             |
| Rows stuck in `sending`                   | `claimed_at`                                                                                                  | After ten minutes the sweep puts a WhatsApp row back and fails an SMS or email row as `interrupted`                         |

Switching it off: turn the setting off on the source (a waiting message is then `skipped / disabled`), or stop `LeadFirstReplyConsumer`
and the sweep by not importing `LeadsWorkerModule`'s first-reply providers; the rows stay and are picked up when it is back.
