# FAQ knowledge base (FAQ)

A workspace writes FAQs: a question, what answers it (a text, or a flow that starts) and many **variations**, the other ways a customer
might ask. When a customer writes in, the message is compared with every variation by meaning (pgvector embeddings), and above the
workspace's bar the answer is sent or the flow starts. Replaces Geta's NLU service (MiniLM plus fuzzy matching over a pickle file per
bot). It is **not** a WaDesk port (WaDesk has no FAQ screen; its keyword replies and flow keyword triggers are unchanged), so the WaDesk
parity run does not apply, as for the API Library. It is off for every workspace until its owner switches it on.

Decision record: [ADR-0021](../adr/0021-faq-semantic-matching-pgvector.md). Model choice and numbers:
[embedding-eval](../wadesk-port/faq-knowledge/embedding-eval.md). Domain notes: [README](../wadesk-port/faq-knowledge/README.md).

Code: `apps/api/src/modules/faq-knowledge/` (module), `apps/api/src/infra/providers/faq-knowledge/` (the AI port, the OpenRouter adapter,
the offline fixture), `packages/contracts/src/faq-knowledge/` (shapes), `packages/db/migrations/20261114090000_faq_core.sql` and
`20261114090100_faq_permissions.sql` (tables, keys), `packages/db/src/schema/faq-knowledge/`.

## 1. How a customer message is handled

The inbox's inbound hook runs listeners in order. The flow runtime goes first (a keyword flow, or a run waiting for an answer, takes the
message). The FAQ listener is an `after` listener: it only sees a typed text message nobody took, and only when `engineEnabled` (platform) and
`enabled` (workspace) are both true. Then `FaqMatchService` decides:

1. **Exact.** The message equals the question or a variation ignoring case and spacing: score 1, answered at once.
2. **Meaning.** The message is embedded (cached six hours by model and text) and compared by cosine similarity with every ready variation of
   an active FAQ in this workspace (exact scan, `ORDER BY embedding <=> $1`). The best variation per FAQ decides.
3. **Spelling (fallback).** When no vector can be used (no key, vendor down, nothing indexed yet, the hourly cap reached) the same message
   is compared with `pg_trgm` similarity, with its own bar (0.6). The decision says which tier decided and why a fallback was used.

The best FAQ answers when its score reaches its bar (the FAQ's own `thresholdOverride`, else the workspace `threshold`) and, if the workspace
set a `minMargin`, leads the runner-up FAQ by at least that much. Otherwise nothing is sent and the message goes to the **Unanswered** list.

Acting on a match: a text answer is queued through the inbox send path as a bot message (so the 24 hour window, channel capabilities and
dispatch retries apply; one answer per customer message, keyed by a uuid derived from the message), a flow answer starts the flow
(`source: keyword`, `triggerText` = the message). Every decision writes one `faq_match_logs` row with the outcome that really happened.

| Outcome           | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `answered`        | A text answer was queued.                                                                                |
| `flow_started`    | The linked flow started.                                                                                 |
| `below_threshold` | Nothing was similar enough (also: too short to be a question).                                           |
| `low_margin`      | Two FAQs scored alike; asking is safer than guessing.                                                    |
| `no_faqs`         | The workspace has no active FAQ.                                                                         |
| `provider_error`  | The vendor failed and spelling similarity found nothing either (the log keeps the reason).               |
| `not_sent`        | Matched, but the answer could not be sent (flow deleted, window closed, channel down); `error` says why. |

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

## 3. Workspace routes (`/v2/faq`)

Every id on the wire is a uuid. Lists are cursor pages (`?limit=&cursor=`) ending in `page: { nextCursor, hasMore, limit }`. A failed
validation is `422 VALIDATION_FAILED` with `errors[].path`; a stale `rowVersion` is `409 ROW_VERSION_CONFLICT`.

| Method and path                         | Body or query                                                                                             | Answer                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /entries`                          | `search status category indexing limit cursor`                                                            | `{ data: FaqEntrySummary[], page, stats }`                                              |
| `POST /entries` (Idempotency-Key)       | `question answerType answerText? flowId? category? status? thresholdOverride? variations[] resolveLogId?` | `201 FaqEntry`                                                                          |
| `GET /entries/:id`                      |                                                                                                           | `FaqEntry` with every variation                                                         |
| `PATCH /entries/:id`                    | the form plus `rowVersion`                                                                                | `FaqEntry`                                                                              |
| `DELETE /entries/:id`                   |                                                                                                           | `204`                                                                                   |
| `POST /entries/bulk`                    | `{ action: delete\|pause\|activate, ids[] }` (max 200)                                                    | `{ affected }`                                                                          |
| `POST /entries/:id/variations`          | `{ texts[], source: manual\|ai\|import }`                                                                 | `201 FaqVariation[]` (only the new ones)                                                |
| `PATCH /entries/:id/variations/:vid`    | `{ text, rowVersion }`                                                                                    | `FaqVariation` (its vector is made again)                                               |
| `DELETE /entries/:id/variations/:vid`   |                                                                                                           | `204` (the question itself cannot be removed)                                           |
| `POST /entries/:id/variations/generate` | `{ count: 3..20 }`                                                                                        | `{ suggestions[], model }`, **nothing saved**                                           |
| `POST /test`                            | `{ query }`                                                                                               | `FaqMatchDecision`; sends nothing, not counted                                          |
| `GET /settings`, `PUT /settings`        | `{ enabled threshold minMargin logQueries rowVersion? }`                                                  | `FaqSettings`                                                                           |
| `GET /insights/summary`                 | `?days=1..90`                                                                                             | `FaqInsights`                                                                           |
| `GET /insights/log`                     | `view=all\|answered\|unanswered\|errors search faqId limit cursor`                                        | `{ data: FaqLogItem[], page }`                                                          |
| `POST /insights/log/:id/learn`          | `{ faqId }`                                                                                               | `{ added }`; the message becomes a `learned` variation and every copy of it is resolved |
| `POST /insights/log/:id/dismiss`        |                                                                                                           | `204`                                                                                   |

Rules worth knowing:

- **The question is a variation.** Creating an FAQ stores its question as the first variation (`source: question`, locked); renaming the
  question renames it and sends it for a new vector. Repeats (ignoring case and spacing) are skipped, never an error.
- **A save never waits for the vendor.** New and reworded variations are `embedState: pending` and get their vector from the worker within
  seconds (`ready`); after five failed attempts the state is `failed` with the reason in `embedError`. A FAQ whose variations are not all
  ready still matches by its ready ones, its exact phrases and spelling similarity.
- **Settings versioning.** The first save sends no `rowVersion` (no row exists); every later save sends the one it read. `threshold` is a
  cosine similarity 0.05 to 0.99, `minMargin` 0 to 0.5 (0 = off). `logQueries: false` keeps scores and outcomes but not the customer's text
  (and makes "learn" impossible for those rows).
- **Scores belong to a model.** `recommendedThreshold` is what suits the model in use; `modelChanged` is true when the platform changed the
  model after this workspace last saved, and means "review your sensitivity". Saving confirms it.
- **Hits** (`hitCount`, `lastHitAt`) are counted from the log (last 90 days). They are not a column, so a hit never changes `rowVersion`.
- **Limits** come from the platform: FAQs per workspace (default 500) and variations per FAQ (default 60), `422 FAQ_LIMIT_REACHED`.
  Adding variations past the cap takes what fits.
- **The log** is kept 90 days (daily sweep); `origin: test` rows (the playground) never show in the insights or the unanswered list.

## 4. Platform routes (`/v2/platform/faq`, super admin)

| Method and path   | Body or query                                                                                                                    | Answer                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `GET /`           | -                                                                                                                                | `{ config, platformKeyReady, stats }` |
| `GET /workspaces` | `search limit`                                                                                                                   | `{ data: FaqPlatformWorkspace[] }`    |
| `PATCH /`         | any of `engineEnabled embeddingModel generationModel defaultThreshold(number\|null) maxFaqs maxVariationsPerFaq semanticPerHour` | `{ config, platformKeyReady, stats }` |
| `POST /reindex`   | `{ scope: all\|failed }`                                                                                                         | `{ queued }`                          |

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

`FAQ_ENGINE_DISABLED` (422), `FAQ_LIMIT_REACHED` (422), `FAQ_DUPLICATE_QUESTION` (409), `FAQ_FLOW_NOT_FOUND` (422), `FAQ_EMBEDDING_UNAVAILABLE`
(422 for a missing or refused key, 502 for a vendor failure). `FAQ_MODEL_NOT_ALLOWED` is reserved: a model that is not on the allow-list is today a plain `422 VALIDATION_FAILED`.
Plus the generic `NOT_FOUND`, `VALIDATION_FAILED`, `ROW_VERSION_CONFLICT`, `PLAN_LIMIT_REACHED`.
