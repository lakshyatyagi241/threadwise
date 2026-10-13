# API: growth pilot

A product extension (no Reference screen): what [lead scoring](lead-scoring.md) already knows (campaign receipts, chat readings, engagement),
turned into things a team can act on. Base path `/v2/growth`. Errors are `application/problem+json` with a stable `code`; the codes this adds
are `GRW_NOT_AVAILABLE` (403), `GRW_FEATURE_OFF` (422), `GRW_ACTION_GONE` (409), `GRW_ASSISTANT_FAILED` (422/502) and `GRW_UNDO_REFUSED`
(409) in `@crm/contracts` `growth/index.ts`. Shapes live in `packages/contracts/src/growth/`. Every id on the wire is a uuid.

## Who gets it

**Only the pilot workspace** (slug in `CHAT_DIGEST_PILOT_SLUGS`, today `demo-interakt`) **that also has a `growth_settings` row.** The gate is
`GrowthGateService` and it is the first line of every route, listener and sweeper:

- a route answers `403 GRW_NOT_AVAILABLE` to any other workspace (`GET /growth/settings` answers `available: false` with every switch off);
- a listener ignores the event before reading anything; a sweeper loops only over `pilotOrgs(feature)` (slug in the list, feature on);
- the migration `20261122090000_growth_pilot.sql` seeds the settings row, the `ai_intent` contact property and a `last_activity_at` backfill
  for that slug only. The tables themselves are inert elsewhere.

Each part has its own switch (`GROWTH_FEATURES`), all **off** until a person turns them on (the pilot workspace is seeded with them on).
A route whose part is off answers `422 GRW_FEATURE_OFF`.

## Capabilities

Growth reuses lead scoring's keys: `lsc.runs.read` (every read), `lsc.contacts.score` (run something: stamp, sync an audience, recompute,
ask the assistant, enrichment), `lsc.settings.manage` (switches and thresholds), `lsc.stage.review` (accept or dismiss an action, undo).

## Routes

| Method and path                      | Key                   | What                                                                                               |
| ------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /growth/settings`               | `lsc.runs.read`       | `{available, features, config, rowVersion, enrichmentConfigured}`                                  |
| `PATCH /growth/settings`             | `lsc.settings.manage` | `{features?, config?, rowVersion}`; `409` on a stale version                                       |
| `GET /growth/overview`               | `lsc.runs.read`       | settings and the latest digest                                                                     |
| `GET /growth/campaigns/report`       | `lsc.runs.read`       | per campaign, the contacts who wrote back within 24 and 72 hours of the send (`campaign_response`) |
| `POST /growth/campaigns/stamp`       | `lsc.contacts.score`  | fill `responded_at` on every recipient that wrote back and recount the campaigns                   |
| `GET /growth/audiences`              | `lsc.runs.read`       | engaged, silent, lapsed, hot in chat, likely to convert, one per service rule, with sizes          |
| `POST /growth/audiences/sync`        | `lsc.contacts.score`  | `{key}`: rebuild the contact group of one audience (named `AI · <label>`)                          |
| `GET /growth/send-times`             | `lsc.runs.read`       | hours when contacts read and write, in the workspace time zone; the three best and the quiet hours |
| `GET /growth/propensity`             | `lsc.runs.read`       | the conversion model: AUC, share of converted contacts in the top tenth, weights                   |
| `POST /growth/propensity/recompute`  | `lsc.contacts.score`  | learn again and score everyone                                                                     |
| `GET /growth/contacts/:uuid`         | `lsc.runs.read`       | the contact's conversion score and the enrichment found                                            |
| `GET /growth/quality`                | `lsc.runs.read`       | accept/dismiss rates, how well the lead score separates converted contacts, AI cost (30 days)      |
| `GET /growth/digest`                 | `lsc.runs.read`       | today's summary                                                                                    |
| `GET /growth/actions`                | `lsc.runs.read`       | the Growth inbox (`status`, `type`, cursor), with the open count per type                          |
| `POST /growth/actions/decide`        | `lsc.stage.review`    | `{action: accept\|dismiss, ids}`; each is decided on its own                                       |
| `GET /growth/auto-stage`             | `lsc.runs.read`       | stage changes made automatically, how many today, the daily cap                                    |
| `POST /growth/auto-stage/:uuid/undo` | `lsc.stage.review`    | put the contact back, if nobody moved it since (`409 GRW_UNDO_REFUSED` otherwise)                  |
| `POST /growth/assistant/broadcast`   | `lsc.contacts.score`  | `{goal}`: suggest one audience and one approved template; creates and sends nothing                |
| `GET /growth/enrichment`             | `lsc.runs.read`       | whether a provider is configured and how many contacts it found, did not find, failed on           |
| `POST /growth/enrichment/run`        | `lsc.contacts.score`  | look up the next 50 contacts with a business email; inert without a provider key                   |

## The Growth inbox (`growth_actions`)

One **open** action per `dedupe_key` (a unique index), so a repeated reading never piles up. Types: `hot_lead`, `unanswered_intent`,
`registration_issue`, `purchase_route`, `opt_out`, `lapsed`, `service_due`, `status_reply`. Accepting does the work of its kind as the
signed-in person: `purchase_route` assigns the conversation (needs the right to assign), `opt_out` records the consent in the ledger
(`contact-consent`); the other types only close. Nothing in the pilot sends a message to a contact. Open actions expire after 30 days.

## Where each of the 27 ideas lives

| Part (`features` key)           | What it does                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `campaign_response`             | #1, #2: real replies per campaign; stamps `responded_at` hourly; `last_activity_at` is backfilled by the migration |
| `engagement_audiences`          | #4, #6: engaged / silent / lapsed audiences, lapsed actions, groups kept fresh daily                               |
| `engagement_stage_rules`        | #5: stage suggestions (`source = engagement`) from campaign opens, a person decides                                |
| `send_times`                    | #7: best hours to send                                                                                             |
| `intent_fields`                 | #8: writes `ai_intent` on the contact, so a flow `field_match` can react                                           |
| `hot_lead_alerts`               | #9: hot-lead action and a notification to the chat owner                                                           |
| `unanswered_watch`              | #10: buying questions nobody answered (hourly)                                                                     |
| `auto_notes`                    | #11: the chat summary as a contact note                                                                            |
| `handover_summary`              | #12: the summary as an internal note when a chat is assigned (worker, `conversation.assigned`)                     |
| `language_detect`               | #13: the chat language stored on the conversation                                                                  |
| `registration_check`            | #14: "paid but no confirmation" action with the contact's groups and last campaign send                            |
| `propensity`                    | #15: logistic regression on engagement counts, holdout AUC, daily                                                  |
| `status_reply`                  | #17: status from the workspace's own status properties, ready to send (never sent by Growth)                       |
| `service_rules`                 | #18, #20: contacts whose date property makes them due, as audiences and actions                                    |
| `purchase_routing`              | #19: suggest who should take a buying chat                                                                         |
| `broadcast_assistant`           | #16, #21: audience and template for a goal, weighted by real reply rates                                           |
| `auto_stage`                    | #22: only confident readings, daily cap, undo                                                                      |
| `enrichment`                    | #23: company details; inert without `GROWTH_ENRICHMENT_DRIVER` and key                                             |
| `daily_digest`                  | #24: one stored summary per day                                                                                    |
| `quality`                       | #25: accept/dismiss rates, score AUC, AI cost                                                                      |
| thresholds, phrases, mask words | #26: `config` (see `growthConfigSchema`)                                                                           |
| `optout_detection`              | #27: "asked to stop" action; accept records the opt-out                                                            |

## Privacy

Chat text still reaches the model only through lead scoring's chat reading (personal data partly masked, then fenced as data). The broadcast
assistant sends the goal, audience names and sizes, and template names and bodies; never a contact. Enrichment sends a **business** email
address (free-mail domains are never sent) to the configured vendor, only when the server has a key and the workspace turned it on.
