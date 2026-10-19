# FAQ knowledge base (FAQ)

> **Retired (2026-10-19).** FAQs are now entries of an AI agent's knowledge base, searched by meaning for every reader; this FAQ engine's screens, settings and routes are gone. See [ADR-0021 addendum 3](../adr/0021-faq-semantic-matching-pgvector.md) and [knowledge-base/README.md](../threadwise-port/knowledge-base/README.md). The text below is kept as history.

A flow writes FAQs (they belong to the flow, not to the workspace): a question, what answers it (a text, or a flow that starts) and many **variations**, the other ways a customer
might ask. When a customer writes in, the message is compared with every variation by meaning (pgvector embeddings), and above the
flow's bar the answer is sent or the flow starts. Replaces Geta's NLU service (MiniLM plus fuzzy matching over a pickle file per
bot). It is **not** a Reference port (Reference has no FAQ screen; its keyword replies and flow keyword triggers are unchanged), so the Reference
parity run does not apply, as for the API Library. It is off for every flow until its owner switches it on in that flow's FAQ settings.

Decision record: [ADR-0021](../adr/0021-faq-semantic-matching-pgvector.md). Model choice and numbers:
[embedding-eval](../threadwise-port/faq-knowledge/embedding-eval.md). Domain notes: [README](../threadwise-port/faq-knowledge/README.md).

Code: `apps/api/src/modules/faq-knowledge/` (module), `apps/api/src/infra/providers/faq-knowledge/` (the AI port, the OpenRouter adapter,
the offline fixture), `packages/contracts/src/faq-knowledge/` (shapes), `packages/db/migrations/20261114090000_faq_core.sql` and
`20261114090100_faq_permissions.sql` (tables, keys), `20261116090000_faq_flow_node_verify.sql` (link to node, the borderline check, flow-origin logs), `20261118090000_faq_per_flow.sql` (FAQs, settings and logs belong to a flow), `packages/db/src/schema/faq-knowledge/`.

## 1. How a customer message is handled

The inbox's inbound hook runs listeners in order. The flow runtime goes first (a keyword flow, or a run waiting for an answer, takes the
message). The FAQ listener is an `after` listener: it only sees a typed text message nobody took, and only when `engineEnabled` (platform) is
true. **Which flow's FAQs answer.** The candidates are the flows that are published and active, whose own FAQ switch (`faq_settings.enabled`, one row
per flow) is on, that have at least one active FAQ, and that are bound to the channel the message came in on (the keyword trigger's rule:
`trigger_channel_id`, else the engine's channel kinds). A flow the customer has a live run in is tried first. Each candidate's `FaqMatchService`
runs with that flow's own settings; the best answered score wins (ties: the live run's flow, then the lowest id). One log row is written, for
the winning flow or, when nothing answers, for the closest candidate. A flow's FAQs never answer on another flow's channel and no other flow's
FAQs are ever looked at. Then, per flow, `FaqMatchService` decides:

1. **Exact.** The message equals the question or a variation ignoring case and spacing: score 1, answered at once.
2. **Meaning.** The message is embedded (cached six hours by model and text) and compared by cosine similarity with every ready variation of
   an active FAQ of this flow (exact scan, `ORDER BY embedding <=> $1`). The best variation per FAQ decides.
3. **Spelling (fallback).** When no vector can be used (no key, vendor down, nothing indexed yet, the hourly cap reached) the same message
   is compared with `pg_trgm` similarity, with its own bar (0.6). The decision says which tier decided and why a fallback was used.

The best FAQ answers when its score reaches its bar (the FAQ's own `thresholdOverride`, else the flow's `threshold`) and, if the flow
set a `minMargin`, leads the runner-up FAQ by at least that much. Otherwise nothing is sent and the message goes to the **Unanswered** list.

**Borderline check (optional, off by default).** When the flow sets `verifyMode: borderline`, a **semantic** match whose score is in
`[bar, bar + verifyBand)` (the bar is the FAQ's own or the flow's; the band is 0.01 to 0.30, default 0.10) is shown to a small chat
model (platform setting `verifyModel`, default `openai/gpt-4o-mini`) with the customer message, the matched question and its closest wording,
and the runner-up question. The model answers JSON `{answers, reason}`. It can only **veto**: `rejected` turns the outcome into
`below_threshold` (nothing is sent, the message is listed as Unanswered with the reason); `confirmed` changes nothing; `error` (provider
failed, unreadable answer) and `skipped` (flow off, platform switch off, hourly cap `verifyPerHour`, no key, allowance used) leave the
match standing, so an outage never silences the FAQ. The customer's text is passed as quoted data and the prompt says to ignore
instructions inside it. Exact matches, the trigram fallback and scores outside the band are never checked. The verdict, model and reason
are on the decision and on the log row, and the tokens are in the AI ledger.

Acting on a match: a text answer is queued through the inbox send path as a bot message (so the 24 hour window, channel capabilities and
dispatch retries apply; one answer per customer message, keyed by a uuid derived from the message), a flow answer starts the flow
(`source: keyword`, `triggerText` = the message) **at the FAQ's `flowNodeId` when it has one** ("link to node"; the launcher fails with
`FLR_NODE_NOT_FOUND` when the step was since deleted, which the log shows as `not_sent`: "The step this should start at is no longer in the flow"). Every decision writes one `faq_match_logs` row with the outcome that really happened.

| Outcome           | Meaning                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `answered`        | A text answer was queued.                                                                                        |
| `flow_started`    | The linked flow started.                                                                                         |
| `below_threshold` | Nothing was similar enough (also: too short to be a question).                                                   |
| `low_margin`      | Two FAQs scored alike; asking is safer than guessing.                                                            |
| `no_faqs`         | The flow has no active FAQ.                                                                                      |
| `provider_error`  | The vendor failed and spelling similarity found nothing either (the log keeps the reason).                       |
| `not_sent`        | Matched, but the answer could not be sent (flow or step deleted, window closed, channel down); `error` says why. |

## 2. Permissions

All org-wide (no record scope). Owner and Admin get all six; the **Manager** preset gets the five that do not switch answering on or off;
Agent and Viewer hold none. Not behind a plan feature: none of the existing ones fits.

| Key                   | Routes                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `faq.entries.read`    | `GET entries`, `entries/:id`, `POST test`, `GET settings`                                               |
| `faq.entries.create`  | `POST entries`, `POST entries/:id/variations`, `POST entries/:id/variations/generate`                   |
| `faq.entries.update`  | `PATCH entries/:id`, `POST entries/bulk` (pause, activate), `PATCH .../variations/:vid`, learn, dismiss |
| `faq.entries.delete`  | `DELETE entries/:id`, `DELETE .../variations/:vid`                                                      |
| `faq.settings.manage` | `PUT settings`                                                                                          |
| `faq.insights.read`   | `GET insights/summary`, `GET insights/log`                                                              |

Platform routes (`/v2/platform/faq`) are for the `super_admin` operator role only, reads included.

## 3. Flow routes (`/v2/faq`)

Every route below `flows/:flowId` is scoped to one flow of the workspace (`:flowId` is the flow's uuid): an unknown flow, or another workspace's, is `404 NOT_FOUND`, and an FAQ or log id of another flow is 404 too. The old unscoped routes (`/v2/faq/entries`, `/test`, `/settings`, `/insights/...`) no longer exist. Every id on the wire is a uuid. Lists are cursor pages (`?limit=&cursor=`) ending in `page: { nextCursor, hasMore, limit }`. A failed
validation is `422 VALIDATION_FAILED` with `errors[].path`; a stale `rowVersion` is `409 ROW_VERSION_CONFLICT`.

| Method and path                                       | Body or query                                                                                                         | Answer                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /flows/:flowId/entries`                          | `search status category indexing limit cursor`                                                                        | `{ data: FaqEntrySummary[], page, stats }`                                                                    |
| `POST /flows/:flowId/entries` (Idempotency-Key)       | `question answerType answerText? flowId? flowNodeId? category? status? thresholdOverride? variations[] resolveLogId?` | `201 FaqEntry`                                                                                                |
| `GET /flows/:flowId/entries/:id`                      |                                                                                                                       | `FaqEntry` with every variation                                                                               |
| `PATCH /flows/:flowId/entries/:id`                    | the form plus `rowVersion`                                                                                            | `FaqEntry`                                                                                                    |
| `DELETE /flows/:flowId/entries/:id`                   |                                                                                                                       | `204`                                                                                                         |
| `POST /flows/:flowId/entries/bulk`                    | `{ action: delete\|pause\|activate, ids[] }` (max 200)                                                                | `{ affected }`                                                                                                |
| `POST /flows/:flowId/entries/:id/variations`          | `{ texts[], source: manual\|ai\|import }`                                                                             | `201 FaqVariation[]` (only the new ones)                                                                      |
| `PATCH /flows/:flowId/entries/:id/variations/:vid`    | `{ text, rowVersion }`                                                                                                | `FaqVariation` (its vector is made again)                                                                     |
| `DELETE /flows/:flowId/entries/:id/variations/:vid`   |                                                                                                                       | `204` (the question itself cannot be removed)                                                                 |
| `POST /flows/:flowId/entries/:id/variations/generate` | `{ count: 3..20 }`                                                                                                    | `{ suggestions[], model }`, **nothing saved**                                                                 |
| `GET /flow-nodes/:flowId`                             |                                                                                                                       | `{ data: [{ id, type, label }] }`, the steps of a flow of this workspace (`422 FAQ_FLOW_NOT_FOUND` otherwise) |
| `POST /flows/:flowId/test`                            | `{ query }`                                                                                                           | `FaqMatchDecision`; sends nothing, not counted                                                                |
| `GET` and `PUT /flows/:flowId/settings`               | `{ enabled threshold minMargin logQueries verifyMode? verifyBand? rowVersion? }`                                      | `FaqSettings`                                                                                                 |
| `GET /flows/:flowId/insights/summary`                 | `?days=1..90`                                                                                                         | `FaqInsights`                                                                                                 |
| `GET /flows/:flowId/insights/log`                     | `view=all\|answered\|unanswered\|errors search faqId limit cursor`                                                    | `{ data: FaqLogItem[], page }`                                                                                |
| `POST /flows/:flowId/insights/log/:id/learn`          | `{ faqId }`                                                                                                           | `{ added }`; the message becomes a `learned` variation and every copy of it is resolved                       |
| `POST /flows/:flowId/insights/log/:id/dismiss`        |                                                                                                                       | `204`                                                                                                         |

Rules worth knowing:

- **The question is a variation.** Creating an FAQ stores its question as the first variation (`source: question`, locked); renaming the
  question renames it and sends it for a new vector. Repeats (ignoring case and spacing) are skipped, never an error.
- **A save never waits for the vendor.** New and reworded variations are `embedState: pending` and get their vector from the worker within
  seconds (`ready`); after five failed attempts the state is `failed` with the reason in `embedError`. A FAQ whose variations are not all
  ready still matches by its ready ones, its exact phrases and spelling similarity.
- **Settings are per flow.** Each flow has its own row (`faq_settings` is keyed `(org_id, flow_id)`: switch, bar, lead, logging, second check); a flow with no row is off with the platform defaults. **Settings versioning.** The first save of a flow sends no `rowVersion` (no row exists); every later save sends the one it read. `threshold` is a
  cosine similarity 0.05 to 0.99, `minMargin` 0 to 0.5 (0 = off). `logQueries: false` keeps scores and outcomes but not the customer's text
  (and makes "learn" impossible for those rows).
- **Scores belong to a model.** `recommendedThreshold` is what suits the model in use; `modelChanged` is true when the platform changed the
  model after this flow last saved, and means "review your sensitivity". Saving confirms it.
- **Hits** (`hitCount`, `lastHitAt`) are counted from the log (last 90 days). They are not a column, so a hit never changes `rowVersion`.
- **Limits** come from the platform and apply per flow: FAQs per flow (default 500) and variations per FAQ (default 60), `422 FAQ_LIMIT_REACHED`.
  Adding variations past the cap takes what fits.
- **Ownership and the answer target.** `owner_flow_id` is the flow the FAQ lives in (delete the flow and its FAQs, settings and log go); `flowId` in the body is the flow a `flow` answer STARTS and defaults to the owner in the editor ("go to a step of this flow"). The same question text may exist in two flows; a duplicate inside one flow is `409 FAQ_DUPLICATE_QUESTION`.
- **Link to node.** `flowNodeId` is the editor's node id inside the target flow; it is validated against the flow when the FAQ is saved
  (`422 FAQ_FLOW_NODE_NOT_FOUND`, path `flowNodeId`), a blank one means "the flow's start", and it is dropped when the answer becomes a
  text. A flow can be edited later, so the entry carries `flowNodeLabel` (null = the step is gone) and the editor warns.
- **The log** is kept 90 days (daily sweep); `origin: test` rows (the playground) never show in the insights or the unanswered list.

## 4. Platform routes (`/v2/platform/faq`, super admin)

| Method and path   | Body or query                                                                                                                                                            | Answer                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `GET /`           | -                                                                                                                                                                        | `{ config, platformKeyReady, stats }` |
| `GET /workspaces` | `search limit`                                                                                                                                                           | `{ data: FaqPlatformWorkspace[] }`    |
| `PATCH /`         | any of `engineEnabled embeddingModel generationModel defaultThreshold(number\|null) maxFaqs maxVariationsPerFaq semanticPerHour verifyEnabled verifyModel verifyPerHour` | `{ config, platformKeyReady, stats }` |
| `POST /reindex`   | `{ scope: all\|failed }`                                                                                                                                                 | `{ queued }`                          |

- `embeddingModel` must be on the allow-list (`FAQ_EMBEDDING_MODELS`: every model answers 3072 dimensions, the width of the column). Changing it
  marks every vector `pending`; matching uses spelling similarity until the worker has re-made them, and a default threshold the operator
  fixed for the old model is dropped (the default then follows the new model's recommended value).
- `engineEnabled: false` stops every workspace from answering and blocks edits (`422 FAQ_ENGINE_DISABLED`); reads still work.
- `semanticPerHour` caps the vector matches one workspace may run an hour (a cost and abuse guard; past it the matcher uses spelling only).
- Stored in `platform_settings` under `faq.config`; every change is an audit event (`platform.faq_config_updated`, `platform.faq_reindex`).

## 5. Keys, cost and the ledger

Embeddings and suggestions use the OpenRouter key `AiKeyResolver` resolves for the workspace: its own key when its plan allows BYOK, else the
platform key (Admin, AI keys, provider `openrouter`). There is no key in the environment. A call on the platform key first asks the monthly token
cap; every call records its tokens in `ai_token_usage` (`provider: openrouter`, the model, who paid). With no key the engine degrades (spelling
similarity) and the screens say so; `generate` is `422 FAQ_EMBEDDING_UNAVAILABLE`.

Typical cost with the default model ($0.13 per million tokens): a 100-variation FAQ set indexes for about $0.00005, and each customer message
costs one embedding (about $0.000002) unless it repeats within six hours or is an exact phrase.

## 6. Error codes

`FAQ_ENGINE_DISABLED` (422), `FAQ_LIMIT_REACHED` (422), `FAQ_DUPLICATE_QUESTION` (409), `FAQ_FLOW_NOT_FOUND` (422), `FAQ_FLOW_NODE_NOT_FOUND` (422), `FAQ_EMBEDDING_UNAVAILABLE`
(422 for a missing or refused key, 502 for a vendor failure). `FAQ_MODEL_NOT_ALLOWED` is reserved: a model that is not on the allow-list is today a plain `422 VALIDATION_FAILED`.
Plus the generic `NOT_FOUND`, `VALIDATION_FAILED`, `ROW_VERSION_CONFLICT`, `PLAN_LIMIT_REACHED`.

## 7. The Flow "Answer from FAQ" node

Builder type `faq` (group AI, runtime `Faq`; `packages/contracts/src/faq-knowledge/node.ts`, `runtime/nodes/ai/faq-node.ts`). It asks the same
matcher through `FaqFlowService` for a message the run holds, so a flow can answer by meaning where it used to need a list of keywords.

- **Data:** `query` (merge tags; default `{{user_message}}`, a variable a Question node saved works), `category` (blank = all FAQs),
  `minScore` (0.05 to 0.99, null = the flow's bar), `sendAnswer` (default true), `save` (variable prefix, default `faq`).
- **Exits:** `matched` (1) and `no_match` (2). A text FAQ is sent (unless `sendAnswer` is off) and the node leaves by `matched`. A flow FAQ
  hands the run to its flow at its chosen step (the run does not come back, like the Sub-flow node). `no_match` is also taken when the
  engine is off, the query is empty, the matcher throws, or the linked flow or step is gone or not live (then `<save>.matched` is set to
  `no`, not left at `yes`).
- **Variables:** `<save>.matched` (yes/no), `.score`, `.question`, `.answer`, `.id`.
- **It matches the FAQs of the flow the run is in** and runs whether or not that flow's automatic answering switch is on (placing the node is the opt-in); it stops only when the platform
  operator switches the engine off. The borderline check applies to it like any semantic match.
- **Log:** one `faq_match_logs` row with `origin: flow` per match, outcome `answered` / `flow_started` / the miss reason. Flow rows never appear in
  the Unanswered list or the insights (those read `origin: inbound`).
- **Order against keyword flows:** unchanged. A keyword flow (or a run waiting for an answer) takes the message first; the FAQ only sees what
  nobody took. The e2e test `order of answering` pins it.
