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

## Quiet hours (BL-191, product extension)

Not in Reference. `FbBroadcastSenderService` asks `SendWindowService` (compliance-center) through `splitByQuietHours` for each claimed batch: the broadcast is always marketing, so there is no purpose to read. A recipient whose contact (the conversation's `contact_id`; none means the workspace fallback clock) is inside the workspace's quiet hours goes back to `pending` with `facebook_broadcast_recipients.held_until` / `held_reason` (`holdRecipient`); `claim` skips it until then; the rest of the audience is sent. When only held recipients are left the run ends, the broadcast stays `sending`, and `scheduleWake` queues a delayed job on `fb-broadcast` (job id `<uuid>-held-<opening>`, so one per opening). Every person, held or not, is checked with the ConsentGate (see below) and the 24 hour window is checked again at send time; if it closed while they waited the person is `blocked` with a note saying so. The list carries `held` and `heldUntil` (`heldSummaries`), shown under the counts with `compliance-center.hold.*`. Pausing a held broadcast makes the wake-up a no-op. Migration `20261225090000`. Spec: privacy-and-data-governance.md 11.5.

## Consent on the first send (BL-141 follow-up, product extension)

Not in Reference. Every claimed batch of Messenger recipients is put through the ConsentGate before anything is sent, on the first send and on a release from the quiet hours alike: `gateRecipients(gate, orgId, batch, 'facebook')` in `contact-consent/consent-gate.recipients.ts` (marketing purpose, consent channel `facebook`, one `checkMany` for the slice; a recipient with no contact is asked as an anonymous subject). The rule is the gate's own: a withdrawal (the roll-up flag, or STOP on any channel) always refuses; with the workspace switch "Require recorded consent for marketing sends" OFF (the default) nobody else is refused; with it ON a recorded grant on `facebook` is needed, so a recipient with no contact is refused too; a flagged minor is refused by the workspace's children setting (`subject_minor`); the Do-Not-Call list does not apply to this channel. Service and utility messages are never asked here: a broadcast is marketing by nature, and a reply typed in the inbox goes through the dispatcher (service purpose, never blocked by a marketing STOP). A refused person is recorded `blocked` with `error = 'Not messaged: consent (<reason>)'`, counted in `blocked`. The consent check comes before the 24 hour window check, so a person who is both refused and outside the window keeps the consent reason. A broadcast stays marketing inside the 24 hour window: the window decides whether Meta lets the Page write, not whether the person agreed to marketing. The gate is asked BEFORE the quiet hours: a refused recipient is never merely held. There is no migration: `facebook` was already a consent channel (`consentChannelOfKind`) and the ledger's channel column is a free pattern check. Allow-list: none needed. Tests: `test/unit/contact-consent/consent-gate-recipients.spec.ts` (truth table per channel), `test/e2e/channel-facebook/facebook-broadcasts.e2e.spec.ts` (BL-141 block)`.
