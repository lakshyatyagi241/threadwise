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

Not in Reference. The broadcasts page (`BroadcastsService.sendBroadcast`) is marketing: it asks `SendWindowService` through `splitByQuietHours` for the picked threads (the thread's `contact_id`, now on `ThreadRef`). A held thread is not sent; the answer carries `held` and `heldUntil` and a delayed job `held-broadcast` on the `ig-pull` queue (`IgPullProcessor` runs it) keeps the texts already made for each person. At the opening `releaseHeld` reads the hours again (a person still inside their own hours waits for their opening), asks the ConsentGate again (every person, not only a released one) and sends through the same `deliver` the page uses; the engine's 24 hour rule still decides at that moment. The inbox composer (`sendFromComposer`) is a person answering a person and is never held. No broadcast record exists (Reference kept none), so the delayed job in Redis is the only place a held send lives; a lost job loses the held sends (the answer already told the person how many were held).

## Consent on the first send (BL-141 follow-up, product extension)

Not in Reference. The broadcasts page (`sendBroadcast`, `marketing: true`) asks the ConsentGate for every picked thread before anything is sent: `gateRecipients(gate, orgId, rows, 'instagram')` (marketing purpose, consent channel `instagram`, one `checkMany` for the page; a thread with no contact is an anonymous subject). The gate comes before the quiet hours, so a refused person is never merely held. A refused person is not messaged and is neither `sent` nor `failed`: the answer counts them as `skipped` and lists the gate's closed-set reason codes in `skippedReasons` (`[{ reason, count }]`, `IgSendResult` in contracts). The screen shows "Not messaged because of consent: N" with the reason sentences of `contact-consent.gate.reasons`. Nothing is kept as a broadcast record, so the answer is the record of the skip (it is logged too). `releaseHeld` asks the gate for everyone it takes up (the count comes back as `skipped`). The inbox composer (`sendFromComposer`) is a person answering a person (service): it is never asked, so it still answers an opted-out person. Rules, switch and minor behaviour are the gate's own (see the other channels). No migration and no allow-list entry (the file names `ConsentGate`; the guard test proves it calls `gateRecipients`). Tests: `test/unit/contact-consent/consent-gate-recipients.spec.ts`, `test/e2e/channel-instagram/instagram-broadcast.e2e.spec.ts` (BL-141 block), `web/.../channel-instagram/lib/broadcast-model.test.ts`.
