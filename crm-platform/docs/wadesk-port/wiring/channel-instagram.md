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
- `NoInstagramAutomation`: keyword auto-reply (WD-IG-017) is not available.
- `ChatInstagramIngest`: real, over chat-conversations; `InstagramChannelAdapter` registered on init.
