# Wiring map: channel-facebook (FB)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                      | Permission              |
| ------ | ----------------------------------------- | ----------------------- |
| GET    | `/v2/facebook/broadcasts/compose`         | `fb.broadcasts.read`    |
| GET    | `/v2/facebook/broadcasts`                 | `fb.broadcasts.read`    |
| POST   | `/v2/facebook/broadcasts`                 | `fb.broadcasts.manage`  |
| POST   | `/v2/facebook/broadcasts/:id/start`       | `fb.broadcasts.manage`  |
| POST   | `/v2/facebook/broadcasts/:id/pause`       | `fb.broadcasts.manage`  |
| POST   | `/v2/facebook/broadcasts/:id/retry`       | `fb.broadcasts.manage`  |
| DELETE | `/v2/facebook/broadcasts/:id`             | `fb.broadcasts.manage`  |
| GET    | `/v2/facebook/insights`                   | `fb.insights.read`      |
| GET    | `/v2/facebook/config`                     | `fb.pages.read`         |
| GET    | `/v2/facebook/pages`                      | `fb.pages.read`         |
| POST   | `/v2/facebook/connect/start`              | `fb.pages.manage`       |
| POST   | `/v2/facebook/connect/embedded`           | `fb.pages.manage`       |
| POST   | `/v2/facebook/connect/manual`             | `fb.pages.manage`       |
| POST   | `/v2/facebook/pages/:id/refresh`          | `fb.pages.manage`       |
| POST   | `/v2/facebook/pages/:id/resubscribe`      | `fb.pages.manage`       |
| DELETE | `/v2/facebook/pages/:id`                  | `fb.pages.manage`       |
| GET    | `/v2/facebook/posts`                      | `fb.posts.read`         |
| POST   | `/v2/facebook/posts`                      | `fb.posts.manage`       |
| POST   | `/v2/facebook/posts/:id/publish`          | `fb.posts.manage`       |
| DELETE | `/v2/facebook/posts/:id`                  | `fb.posts.manage`       |
| GET    | `/v2/facebook/my-posts`                   | `fb.posts.read`         |
| GET    | `/v2/facebook/setup`                      | `fb.setup.manage`       |
| PUT    | `/v2/facebook/setup/:pageId/get-started`  | `fb.setup.manage`       |
| DELETE | `/v2/facebook/setup/:pageId/get-started`  | `fb.setup.manage`       |
| PUT    | `/v2/facebook/setup/:pageId/greeting`     | `fb.setup.manage`       |
| DELETE | `/v2/facebook/setup/:pageId/greeting`     | `fb.setup.manage`       |
| PUT    | `/v2/facebook/setup/:pageId/menu`         | `fb.setup.manage`       |
| DELETE | `/v2/facebook/setup/:pageId/menu`         | `fb.setup.manage`       |
| PUT    | `/v2/facebook/setup/:pageId/ice-breakers` | `fb.setup.manage`       |
| DELETE | `/v2/facebook/setup/:pageId/ice-breakers` | `fb.setup.manage`       |
| GET    | `/v2/facebook/webhook`                    | public                  |
| POST   | `/v2/facebook/webhook`                    | public (Meta signature) |
| GET    | `/v2/facebook/callback`                   | public (sealed state)   |

## Web screens

- `/facebook/broadcasts`
- `/facebook/insights`
- `/facebook/my-posts`
- `/facebook`
- `/facebook/posts/create`
- `/facebook/posts`
- `/facebook/setup`

## Tables read or written

`channels`, `contacts`, `conversations`, `facebook_broadcast_recipients`, `facebook_broadcasts`, `facebook_pages`, `facebook_posts`, `fb_page_lookup`, `message_ledger`, `messages`, `picked`, `wa_templates`

## Queues and workers

`FB_BACKFILL`, `FB_BROADCAST`

## Outbox events emitted

`facebook.broadcast.created`, `facebook.broadcast.deleted`, `facebook.broadcast.paused`, `facebook.broadcast.retry_requested`, `facebook.broadcast.started`, `facebook.page.connected`, `facebook.page.disconnected`, `facebook.post.deleted`

## Lead ads (leadgen) on the same webhook

`leadgen` changes of `POST /v2/facebook/webhook` are read by `readLeadgen` (`event-rules.ts`) and queued on `meta-leadgen` by `InboundService.queueLead`, one job per workspace and lead; the Meta lead ads domain consumes them ([meta-lead-ads.md](meta-lead-ads.md)). `PagesService.startLogin` takes optional extra scopes, `auth_type=rerequest` and a sealed `returnTo`, and the callback redirects to `/lead-sources?tab=ads` for a login started there. `PageApi.subscribeWebhooks` keeps `leadgen` when the Page has it. The module exports `FACEBOOK_GRAPH`, and the barrel `FacebookPagesService` and `FacebookPagesRepository`. Consumer of `facebook.page.disconnected`: `PageDisconnectConsumer` (meta-lead-ads, worker).

## Shims, owners and blocked consumers

- `OpenFacebookPlanGate`: no Facebook keys in the plan catalogue.
- `NoInboundHooks`: unused. The flow runtime listens to stored inbound messages but its channel-kind map (`KINDS_OF_PROVIDER`) has no `facebook` yet, so no flow runs here until the runtime adds it; routing, AI agent and auto-reply are still absent.
- `ChatInboxIngest`: real, over chat-conversations; `FacebookChannelAdapter` registered on init.
