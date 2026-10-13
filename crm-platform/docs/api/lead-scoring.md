# API: lead scoring (AI)

A product extension: Reference only stores a hand-typed `lead_score`; scoring a contact with an AI model is new. Base path `/v2`.
Errors are `application/problem+json` with a stable `code` and a `requestId`; the codes this adds are `LSC_PLATFORM_DISABLED`,
`LSC_NOT_ENABLED`, `LSC_NO_KEY`, `LSC_PROVIDER_FAILED` and `LSC_MANUAL_SCORE` in `@crm/contracts` `lead-scoring/errors.ts`. Shapes live in
`packages/contracts/src/lead-scoring/`. Every id on the wire is a uuid.

## How it works

1. **Three things must be true** before a contact is scored: the platform switch is on (operator), the workspace opted in (it is off by
   default: contact facts go to an AI vendor), and a key resolves (the workspace's own OpenRouter key, else the platform's). Otherwise
   the Score button answers 422 with the code that says which, and background work does nothing (or logs a `skipped` row when it is a
   problem the workspace should see: no key, token allowance, hourly limit).
2. **What the model sees is anonymised**: stage, status, source, channel, title, language, country, whether an email and phone exist, a
   business/free email kind, company name, tags, up to 15 short custom properties, days since created, in the current stage and since
   last activity, deal counts and open deal value, and an `engagement` object of plain numbers (below). Never the name, email address,
   phone number or message text.

   `engagement` is counted in SQL, so no text reaches the vendor: `broadcastsReceived30d` and `broadcastsRead30d` (the sent and read
   receipts of both bulk senders: `broadcast_contacts` and the WhatsApp campaigns' `wp_campaign_contacts`, which migrated Reference
   workspaces use), `linksClicked30d` (tracked links clicked: `wa_link_clicks` plus campaign clicks),
   `messagesFromContact7d` (messages the contact itself sent; bots, staff, reactions, deleted messages and group threads are left out),
   `hoursSinceLastInbound` (newest inbound on any thread of the contact) and `avgReplyMinutes30d` (the mean time the
   contact took to answer the message right before its own, when that was ours and under a week earlier). A message is dated by when it
   was said (`provider_ts`, else the row time), so an old history import is left out by its date and a migrated workspace, where every
   message is flagged as history but dated truly, still counts. A contact with nothing behind
   it gets zeros and nulls, which the prompt tells the model to weigh lightly. `contact.last_activity_at` (and so `daysSinceActivity`)
   now also moves on a customer message and on a staff reply; see [contacts-attributes-tags.md](contacts-attributes-tags.md).

3. **The scorer never overwrites a person's score.** A score typed (or imported, or created with the contact) has `leadScoreSource:
"manual"` and is left alone; a contact with no score, or one the scorer wrote (`"ai"`), is scored. Typing a score over an AI score
   takes it over and drops the AI's reasons; clearing a typed score (`leadScore: null`) hands the contact back to the scorer. The write
   is guarded in the SQL statement itself, so a score typed a moment earlier wins a race (the call is then logged as `kept`).
4. **Automatic scoring**: `contact.created`, `contact.updated` and `contact.stage_changed` are consumed in the worker, which queues one
   job per contact (20 s delay, deduplicated per contact: ten edits in a burst are one score). The queue (`lsc-score`) calls the vendor
   with no transaction open; a busy vendor is retried (3 attempts), a refused key or an unusable answer is not.
5. **Cost**: every attempt is a row in `lead_scoring_runs` with prompt and completion tokens, `costUsd` (decimal string, 8 decimals),
   `costSource` (`vendor` = the figure OpenRouter reported with `usage: {include: true}`, `estimate` = tokens x the list price,
   `none`), who paid (`billedAgainst`: `admin` = the platform key, `workspace` = its own key) and the duration. Tokens also go to the
   shared `ai_token_usage` ledger, so the plan's monthly AI allowance counts them when the platform key pays. The log is kept for
   `retentionDays` (default 90) and deleted by a daily sweep.

## Capabilities (workspace)

| Key                   | Grants                                          | Presets               |
| --------------------- | ----------------------------------------------- | --------------------- |
| `lsc.runs.read`       | the settings read, the scoring log and its cost | Owner, Admin, Manager |
| `lsc.contacts.score`  | Score one contact now, the backfill             | Owner, Admin, Manager |
| `lsc.settings.manage` | the workspace switch                            | Owner, Admin          |
| `lsc.stage.review`    | accept or dismiss AI-suggested stages           | Owner, Admin, Manager |

A contact's own `leadScore`, `leadScoreSource`, `leadScoreReasons`, `leadScoredAt` and `leadScoreModel` come with the contact (any role
that can read contacts), and with the `contactSummary` of `GET /inbox/conversations/:id`, which the Inbox side panel shows as the same score
card (the summary is null for a caller who may not read contacts, so there is no score either).

## Workspace routes

| Method and path                           | Key                   | What                                                                                                                        |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /lead-scoring/settings`              | `lsc.runs.read`       | `{enabled, autoScore, platformEnabled, model, keySource, eligibleContacts, scoredContacts, last30d, rowVersion, updatedAt}` |
| `PATCH /lead-scoring/settings`            | `lsc.settings.manage` | `{enabled, autoScore?, rowVersion?}`. First save has no `rowVersion` (the GET says `null`); later saves need it, else 409.  |
| `GET /lead-scoring/runs`                  | `lsc.runs.read`       | cursor pages, newest first; `?contactId=` (uuid), `?status=ok\|kept\|failed\|skipped`, `?limit=` (25, max 100)              |
| `POST /lead-scoring/contacts/:uuid/score` | `lsc.contacts.score`  | scores now (waits for the vendor): `{contactId, score, reasons, model, costUsd, promptTokens, completionTokens}`            |
| `POST /lead-scoring/backfill`             | `lsc.contacts.score`  | `{limit}` (default 500, max 5000): queues contacts with no score; `{queued}`                                                |

Errors of the Score button and the backfill: `422 LSC_PLATFORM_DISABLED`, `422 LSC_NOT_ENABLED`, `422 LSC_NO_KEY`, `422 PLAN_LIMIT_REACHED`
(monthly token allowance on the platform key, or the operator's per-hour limit), `409 LSC_MANUAL_SCORE`, `422 LSC_PROVIDER_FAILED` (key
refused) or `502 LSC_PROVIDER_FAILED` (vendor down or not a score). A contact that is not in the workspace is `404`.

## Reading conversations (pilot): the chat digest and stage suggestions

A second part of lead scoring, **offered to the pilot workspaces only** (`CHAT_DIGEST_PILOT_SLUGS` in `lead-chat-digest.rules.ts`; today
`demo-interakt`). It sends the **masked** recent messages of a contact to the AI vendor, which the rest of lead scoring never does, so it
has its own opt-in on top of the scoring switch. Another workspace gets `422 LSC_CHAT_DIGEST_UNAVAILABLE` when it tries to switch it on or
to read a chat, and `chatDigestAvailable: false` in its settings.

**When a chat is read.** A sweeper (worker, every 3 minutes) queues each contact whose last customer message is older than 12 minutes
(and under 14 days) and newer than the last reading. Idle time is the only trigger: conversation status, resolve and first-response are
not used. The "Read chat" button reads now.

**Who reads it** (`planChat`). The messages are the contact's text in its threads, the last 30 within 14 days, dated by when they were said.
Reactions, media, deleted messages, bots, group threads (`@g.us` or group data on the message) and other businesses' away messages are left
out. Then: a **model** reads it when the contact said three real messages, or one long (40 letters) free-text message; the **phrase table**
classifies it with no call (cost 0, `source: "rules"`) when the contact only tapped buttons or keywords it knows ("view warranty slip",
"register ry26", "buy a watch or clock"); **nobody** reads a chat of greetings, emoji and thanks (`422 LSC_NOT_ENOUGH_CHAT` on the button).
A short phrase the table classifies counts as a tap, not as a real message.

**What is masked** (`maskPii`, before anything leaves, partly): phone, card and Aadhaar numbers keep the first and last two digits
(`+91 ***** ***10`); emails keep the first letter and the domain (`p***@acme.io`); PAN keeps its first two and last characters; a link keeps
its page but loses the query string and fragment; the contact's own name (and its parts), and a name someone gives about themselves ("my
name is ..."), keep the first and last letter. The model's own words (summary, reasons) are masked again before they are stored.

**One call answers everything.** The prompt carries the anonymised scoring facts (with the engagement numbers), the workspace's lifecycle
stages and the fenced chat (`<chat>...</chat>`, declared to the model as data it must never obey). It returns `{score, reasons, intent,
signals, summary, suggestedStage, confidence, evidence}`. The score is written the usual way (a score a person typed is never replaced),
the reading is stored in `lead_chat_digests` with its tokens and cost, and a row in `lead_scoring_runs` (`trigger: "chat"`, or `manual`
for the button) keeps the cost on the same ledger and counts against the same allowance and hourly limit.

**Stage suggestions** (`stageSuggestions`, needs `chatDigest`). A suggestion is made only when the stage is one the model was offered
(never the contact's own, never a Won or Lost stage, which need a lost reason), the confidence is at least 0.6, and the contact's stage did
not move in the last 3 days. A contact has one open suggestion: a newer one replaces it, and one that no longer starts from the contact's
stage is superseded. Nothing moves by itself. **Accepting** changes the stage through `ContactsService.update` as the person who accepted
(they need `lsc.stage.review` and the right to edit that contact), so the status is kept valid for the new stage, the audit trail and the
`contact.stage_changed` event are the ordinary ones. Open suggestions expire after 30 days; readings and decided suggestions follow the
log's retention.

| Method and path                            | Key                  | What                                                                                                                                                                             |
| ------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /lead-scoring/contacts/:uuid/insight` | `lsc.runs.read`      | `{active, digest, suggestion}`: the latest reading and the open suggestion; `active` is false unless the pilot is on for the workspace                                           |
| `POST /lead-scoring/contacts/:uuid/digest` | `lsc.contacts.score` | reads the chat now (waits for the vendor) and answers like `insight`. `422 LSC_CHAT_DIGEST_UNAVAILABLE`, `422 LSC_NOT_ENOUGH_CHAT`, and the usual `LSC_*` / `PLAN_LIMIT_REACHED` |
| `GET /lead-scoring/suggestions`            | `lsc.runs.read`      | cursor pages, newest first; `?status=pending\|accepted\|dismissed\|superseded\|expired` (default pending), `?limit=`                                                             |
| `POST /lead-scoring/suggestions/decide`    | `lsc.stage.review`   | `{action: "accept"\|"dismiss", ids: [uuid]}` (up to 100) -> `{done, failed: [{id, code}]}`; each one is decided on its own                                                       |

`PATCH /lead-scoring/settings` also takes `chatDigest` and `stageSuggestions` (the second is forced off while the first is off), and the
settings read returns them with `chatDigestAvailable` and `pendingSuggestions`. The new key `lsc.stage.review` is held by Owner, Admin and
Manager. Tables: `lead_chat_digests`, `lifecycle_stage_suggestions` (migration `20261121090100_lsc_chat_digest`); the demo workspace is
switched on by that migration.

**Listeners.** After a reading is stored (by a rule, by the model, or by the Read chat button) lead scoring tells every registered
`ChatDigestListener` (`lead-chat-digest.listeners.ts`) with a `ChatDigestEvent` (intent, signals, score, summary, language, issue, opt-out,
the conversation and the contact). The [growth pilot](growth.md) is the one listener; a listener that throws never fails the reading. The
digest also stores the chat `language` and the kind of `issue` the contact reports, and a stage suggestion has a `source` (`chat` or
`engagement`) and the statuses `auto_applied` and `undone` for the guarded automatic mode.

## Operator routes (`/platform/lead-scoring`, super admin only, reads included)

| Method and path                         | What                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/lead-scoring`            | config (`platformEnabled`, `model`, `scoresPerHour`, `retentionDays`, the model list with prices), `platformKeyReady`, `workspacesEnabled`, `contactsScored`, cost totals for the last 24 hours and 30 days |
| `PATCH /platform/lead-scoring`          | any of `platformEnabled`, `model` (an OpenRouter id), `scoresPerHour` (0 = no limit), `retentionDays` (7 to 730); returns the overview; audited                                                             |
| `GET /platform/lead-scoring/workspaces` | workspaces by 30 day cost: enabled, contacts scored, scores, cost                                                                                                                                           |
| `GET /platform/lead-scoring/runs`       | the log across workspaces with the workspace name; `?workspaceId=`, `?status=`, cursor                                                                                                                      |

The platform switch is OFF until the operator turns it on. Default model `openai/gpt-6-luna-pro` (list price 0.10 USD in / 0.50 USD
out per million tokens, a score is about 0.0001 USD); the picker offers the ones checked against OpenRouter's public models list.

## Known behaviour to be aware of

- Writing a score updates the contact row, so its `updated_at` and `row_version` move (the audit trail records `leadScore` old and new
  under `contacts`). A person with the edit form open sees one version conflict and reloads.
- The score is a hint for a human, not a decision: the reasons are the model's own words about anonymised facts.
