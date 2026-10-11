# ADR-0021: FAQ semantic matching with pgvector and OpenRouter embeddings

- **Status:** proposed
- **Date:** 2026-10-09

## Context

Geta's bot has an FAQ feature WaDesk does not: a client writes a question, an answer (a text or a flow) and many _variations_
of the question; a customer's message is compared with the variations and, above a threshold, the FAQ's answer is sent or its
flow starts. Geta did the comparing in a separate NLU service: MiniLM-L6 embeddings plus a fuzzy string score, kept in a pickle
file per bot on local disk, re-read and re-loaded on every request, and stale until someone retrained the bot.

WaDesk's own text matching (keyword rules, flow keyword triggers) is exact, contains, regex and fuzzy: it cannot answer "where
is my parcel" with the FAQ "Track my order". This feature is therefore **new to the product**, not a port, and
`docs/wadesk-port/PORTING_RULES.md` section 2.4 ("no extra features") does not cover it; the project owner asked for it
explicitly. It is built as its own domain (`faq-knowledge`, code `FAQ`), off by default for every workspace, so nothing a
WaDesk user relies on changes until a workspace owner switches it on.

Before choosing a model we measured eleven embedding models served by OpenRouter on a synthetic set (16 FAQs, 5 variations each,
80 held-out customer phrasings including typos and romanised Hindi, 30 off-topic negatives):
`docs/wadesk-port/faq-knowledge/embedding-eval.md`. MiniLM, Geta's model, found the right FAQ first in 82.5% of cases and covered
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
- "Start the flow at a given node" (Geta's link-to-node) needs a start-node parameter on the flow launcher, which belongs to the
  flow runtime domain; the FAQ starts the flow from its trigger until that exists.
