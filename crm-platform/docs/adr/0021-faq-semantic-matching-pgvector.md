# ADR-0021: FAQ semantic matching with pgvector and OpenRouter embeddings

- **Status:** proposed
- **Date:** 2026-10-09

## Context

Geta's bot has an FAQ feature Reference does not: a client writes a question, an answer (a text or a flow) and many _variations_
of the question; a customer's message is compared with the variations and, above a threshold, the FAQ's answer is sent or its
flow starts. Geta did the comparing in a separate NLU service: MiniLM-L6 embeddings plus a fuzzy string score, kept in a pickle
file per bot on local disk, re-read and re-loaded on every request, and stale until someone retrained the bot.

Reference's own text matching (keyword rules, flow keyword triggers) is exact, contains, regex and fuzzy: it cannot answer "where
is my parcel" with the FAQ "Track my order". This feature is therefore **new to the product**, not a port, and
`docs/threadwise-port/PORTING_RULES.md` section 2.4 ("no extra features") does not cover it; the project owner asked for it
explicitly. It is built as its own domain (`faq-knowledge`, code `FAQ`), off by default for every workspace, so nothing a
Reference user relies on changes until a workspace owner switches it on.

Before choosing a model we measured eleven embedding models served by OpenRouter on a synthetic set (16 FAQs, 5 variations each,
80 held-out customer phrasings including typos and romanised Hindi, 30 off-topic negatives):
`docs/threadwise-port/faq-knowledge/embedding-eval.md`. MiniLM, Geta's model, found the right FAQ first in 82.5% of cases and covered
24% of queries at 95% precision; `openai/text-embedding-3-large` 100% and 96%; `google/gemini-embedding-2` 97.5% and 85%.

## Decision

1. **Store vectors in Postgres with pgvector**, in `faq_variations.embedding halfvec(3072)`, next to the text, under the same
   forced RLS and the same transaction as the rest of the FAQ. No second datastore, no sync job, no pickle.
2. **Search by exact scan, no ANN index.** A workspace has hundreds to a few thousand variations; a cosine scan filtered by
   `(org_id)` is exact and fast at that size, avoids the filtered-HNSW recall problem under RLS, and lets any dimension be used.
   An HNSW index (`halfvec_cosine_ops`, `hnsw.iterative_scan = relaxed_order`) is added only if a workspace passes ~50k rows.
3. **Embeddings come from OpenRouter** (`POST /api/v1/embeddings`) through a port (`FaqEmbeddingPort`) with one adapter, using the key
   `AiKeyResolver` resolves (workspace BYOK, else the platform key) and recording tokens in `ai_token_usage`. The platform
   operator picks the model from an allow-list of 3072-dimension models (default `openai/text-embedding-3-large`); a model whose
   vectors are not 3072 long is refused at call time. Changing the model marks every variation `pending`; matching only reads
   vectors of the current model, and a worker re-embeds in the background.
4. **A match is a decision with a record.** The matcher tries, in order, an exact (case-insensitive) match, the semantic match, and
   a trigram fallback when the embedding provider is down or a variation has no vector yet. It returns the best FAQ, its score,
   the runner-up and the variation that matched, applies the workspace's threshold (and an optional per-FAQ threshold and a
   minimum margin over the runner-up), and writes a `faq_match_logs` row, so a person can always see why an answer was sent or not.
5. **The inbound listener is an `after` listener** of the inbox hook, like the catalog concierge: a flow or keyword trigger that
   took the message wins; an FAQ answer counts as taking it. It only reads typed text and is inert unless the workspace enabled it.

## Consequences

- Scores are not comparable across models: the threshold default (0.45) is for the default model, and the settings screen shows
  the live score distribution so an owner can tune it. Changing the model resets nothing but warns that scores will move.
- A provider outage degrades to trigram matching, never to an error to the customer.
- Each FAQ edit costs a few embedding calls (about $0.00001 for a variation); the platform key's monthly token cap applies.
- The scan is O(variations in the workspace) per message. The documented trigger to add HNSW is a workspace over 50k variations.
- Query text is stored in `faq_match_logs` for 90 days (a retention sweep deletes older rows); a workspace can switch query
  logging off, after which only scores and outcomes are kept.
- "Start the flow at a given node" (Geta's link-to-node) is built (see the addendum): the launcher takes an optional `startNodeId`.

## Addendum (2026-10-11): link to node, the borderline check, the flow node

Decided with the project owner after the first release.

1. **Link to node.** `faqs.flow_node_id` (text, only with a flow answer). `FlowLaunchService` takes an optional `startNodeId` (a node the
   graph no longer has fails the launch with `FLR_NODE_NOT_FOUND`, which the FAQ logs as `not_sent`); a Sub-flow transition takes the same
   option with a `missPort`/`missVars` so a caller can choose the exit when the flow or step cannot be entered.
2. **A second opinion for close calls, not a second matcher.** A vector score is a similarity, not a probability, and the evaluation
   (embedding-eval.md) still lets one off-topic message in thirty through at the best threshold. For matches inside a configurable band above
   the bar, a small chat model (default `openai/gpt-4o-mini`, any OpenRouter slug) judges "does this FAQ fully serve this message". It can
   only veto (a wrong auto-answer costs more than a silent miss, and the Unanswered list plus "learn" repair silence), never creates a match,
   and any failure leaves the match standing. Off by default per workspace; the platform operator can switch it off, change the model and
   cap calls per workspace per hour. Rejected alternatives: replacing the vector match with an LLM over all FAQs (cost and latency on every
   message, no control of precision); a cross-encoder reranker (another model to host).
3. **The FAQ as a flow step.** Builder node `faq` calls the same matcher through `FaqFlowService`, with the exits `matched` / `no_match`,
   an optional category and an optional per-node bar. Logged with `origin: flow`, which the unanswered list and the insights ignore.
   `FaqKnowledgeWorkerModule` is no longer re-exported by the module barrel: the flow runtime imports the barrel for this node and the worker
   module imports the flow runtime, so exporting it would be a cycle; `WorkersModule` imports it from its file.
4. **Keyword rules first.** Unchanged and now pinned by an end-to-end test: flow keyword triggers and waiting runs take a message before
   the FAQ sees it.

## Addendum 2 (2026-10-12): FAQs belong to a flow

Decided with the project owner after seeing the workspace-level screens: the FAQ is a bot's knowledge, as in Geta, not a workspace module.

1. **Ownership.** `faqs.owner_flow_id` (NOT NULL, `ON DELETE CASCADE`), `faq_settings` keyed `(org_id, flow_id)`, `faq_match_logs.flow_id`. The question is unique within a flow. `faqs.flow_id` stays and means the flow a `flow` answer starts (default: the owner, "go to a step of this flow"). Migration `20261118090000_faq_per_flow.sql` deletes existing rows: the feature was new and off by default, nothing was in production.
2. **Where it answers.** The inbound listener stays an `after` listener (keyword flows and waiting runs still win). The candidates are the published, active flows whose own switch is on, with at least one active FAQ, bound to the message's channel by the keyword trigger's rule; the live run's flow first; each candidate matches with its own settings; the best answered score wins (ties: live run's flow, lowest id); one log row. A flow's FAQs never answer for another flow. Rejected: one FAQ pool shared by all flows of a channel (that is the workspace module again) and "FAQs only through the FAQ step" (the owner wants the Geta fallback behaviour).
3. **Where it is edited.** Inside the Simple builder, as the FAQs tab of every saved flow (list, editor, Try it, Test, Unanswered, Insights, Settings). The `/faq/*` screens and the menu entry are gone (`/faq` redirects to `/flows`). The Advanced builder has no FAQs tab; the FAQ step's inspector links to it. Platform controls (`/admin/faq`) stay, with limits now per flow and workspace counts aggregated over their flows.
4. **The FAQ step** matches the FAQs of the flow the run is in.
5. **Route shape.** `/v2/faq/flows/:flowId/...` for everything the screens use, `/v2/faq/flow-nodes/:flowId` for the steps of an answer-target flow; the unscoped routes were removed without aliases.
