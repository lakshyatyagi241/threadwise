# Wiring map: broadcasts (BCAST)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                              | Permission                                                                                                             |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| DELETE | `/v2/broadcasts/:id`              | `bcast.broadcasts.delete`                                                                                              |
| POST   | `/v2/broadcasts/:id/retry-failed` | `bcast.broadcasts.retry`                                                                                               |
| POST   | `/v2/broadcasts/:id/resume`       | `bcast.broadcasts.resume`                                                                                              |
| GET    | `/v2/broadcasts/:id/export`       | `bcast.broadcasts.export`                                                                                              |
| GET    | `/v2/broadcasts`                  | `bcast.broadcasts.read`                                                                                                |
| GET    | `/v2/broadcasts/compose`          | `bcast.broadcasts.create`                                                                                              |
| GET    | `/v2/broadcasts/summary`          | `bcast.broadcasts.read`                                                                                                |
| GET    | `/v2/broadcasts/:id`              | `bcast.broadcasts.read`                                                                                                |
| GET    | `/v2/broadcasts/:id/recipients`   | `bcast.broadcasts.read`                                                                                                |
| GET    | `/v2/broadcasts/:id/live`         | `bcast.broadcasts.read`                                                                                                |
| GET    | `/v2/broadcasts/:id/statistics`   | `bcast.broadcasts.read`                                                                                                |
| POST   | `/v2/broadcasts`                  | `bcast.broadcasts.create`                                                                                              |
| POST   | `/v2/media/marketing`             | `bcast.broadcasts.create`, `camp.campaigns.create`, `camp.campaigns.update`, `tg.broadcasts.manage`, `fb.posts.manage` |

## Web screens

- `/broadcasts/:id`
- `/broadcasts/create`
- `/broadcasts`

## Tables read or written

`bcast_link_lookup`, `bcast_receipt_lookup`, `broadcast_contacts`, `broadcasts`, `contact_group_members`, `contact_groups`, `contact_tags`, `contacts`, `conversations`, `devices`, `ins`, `messages`, `org_plan_state`, `tags`, `wa_link_clicks`, `wa_provider_configs`, `wa_templates`, `webhooks`, `workspace_settings`

## Queues and workers

`BCAST_DISPATCH`

## Outbox events emitted

`broadcast.created`, `broadcast.deleted`, `broadcast.link_clicked`, `broadcast.message_status`, `broadcast.resumed`, `broadcast.retry_requested`, `broadcast.status_changed`

## Shims, owners and blocked consumers

- Sender and template directories, wallet gate, pacing: `_shims/` (SQL stand-ins; the pacing reads the Node bridge settings, the wallet gate is the real `BillingWalletGate`).
- `OpenWarmerGate`: nothing is held until `scheduled-queue-warmer` exposes a hold.
- `OpenBroadcastPlanGate`: no `broadcast` flag in the plan catalogue (the numeric cap `broadcasts` is enforced).
- Marketing media upload (`POST /v2/media/marketing`) lives here and serves campaigns, Telegram and Facebook as well.
