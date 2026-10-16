# Wiring map: channel-instagram (IG)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                       | Permission             |
| ------ | ------------------------------------------ | ---------------------- |
| GET    | `/v2/instagram/accounts`                   | `ig.accounts.read`     |
| GET    | `/v2/instagram/accounts/available`         | `ig.accounts.manage`   |
| POST   | `/v2/instagram/accounts`                   | `ig.accounts.manage`   |
| POST   | `/v2/instagram/connect/start`              | `ig.accounts.manage`   |
| DELETE | `/v2/instagram/accounts/:id`               | `ig.accounts.manage`   |
| GET    | `/v2/instagram/compose`                    | `ig.broadcasts.manage` |
| POST   | `/v2/instagram/broadcasts`                 | `ig.broadcasts.manage` |
| POST   | `/v2/instagram/composer/send`              | `ig.broadcasts.manage` |
| GET    | `/v2/instagram/flows`                      | `ig.flows.run`         |
| POST   | `/v2/instagram/conversations/:id/run-flow` | `ig.flows.run`         |
| POST   | `/v2/instaflow/inbound`                    | public                 |

## Web screens

- `/instagram/broadcast`
- `/instagram`

## Tables read or written

`channels`, `contacts`, `conversations`, `message_ledger`, `messages`, `organizations`, `users`, `wa_templates`, `workspace_ig_accounts`

## Queues and workers

`IG_PULL`

## Outbox events emitted

`instagram.account.linked`, `instagram.account.unlinked`

## Shims, owners and blocked consumers

- `OpenInstagramPlanGate`: no Instagram keys in the plan catalogue.
- `NoInstagramAutomation`: keyword auto-reply (TW-IG-017) is not available. The flow runtime listens to stored inbound messages, but its channel-kind map has no `instagram` yet (the engine runs Instagram flows itself).
- `ChatInstagramIngest`: real, over chat-conversations; `InstagramChannelAdapter` registered on init.

## Quiet hours (BL-191, product extension)

Not in Reference. The broadcasts page (`BroadcastsService.sendBroadcast`) is marketing: it asks `SendWindowService` through `splitByQuietHours` for the picked threads (the thread's `contact_id`, now on `ThreadRef`). A held thread is not sent; the answer carries `held` and `heldUntil` and a delayed job `held-broadcast` on the `ig-pull` queue (`IgPullProcessor` runs it) keeps the texts already made for each person. At the opening `releaseHeld` reads the hours again (a person still inside their own hours waits for their opening), asks the ConsentGate again and sends through the same `deliver` the page uses; the engine's 24 hour rule still decides at that moment. The inbox composer (`sendFromComposer`) is a person answering a person and is never held. No broadcast record exists (Reference kept none), so the delayed job in Redis is the only place a held send lives; a lost job loses the held sends (the answer already told the person how many were held).
