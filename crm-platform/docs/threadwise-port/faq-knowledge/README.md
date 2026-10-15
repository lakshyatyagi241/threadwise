# FAQ knowledge base: domain notes

What it is, how it fits together, how to run and test it, and what is deliberately not done. API reference:
[docs/api/faq-knowledge.md](../../api/faq-knowledge.md). Decision: [ADR-0021](../../adr/0021-faq-semantic-matching-pgvector.md).
Model evaluation: [embedding-eval.md](embedding-eval.md).

> **Since addendum 2 of the ADR the FAQs belong to a flow**: each flow has its own FAQs, settings, match log and Unanswered list, edited in the Simple builder's FAQs tab, and they answer only inside that flow. Where the text below says "workspace" for FAQs, settings or the log, read "flow".

## Why it exists

Geta's bot lets a client write FAQs and many variations of each, and answers customers by comparing their message with the variations
in a separate NLU service (MiniLM embeddings plus a fuzzy score, a pickle file per bot, loaded again on every request, stale until
retrained). Reference has no FAQ feature (only keyword replies and flow keyword triggers, which match words, not meaning), so this is a new
domain, built at the project owner's request, with the vectors in Postgres and the screens redone with transparency in mind. It does not
change any Reference behaviour: it is off per workspace by default, runs after the flow runtime, and adds screens and routes of its own.

## Pieces

```
customer message
   -> inbox ingest -> InboundMessageHooks
        1. flow runtime (keyword flow / waiting run)           takes it? stop
        2. FaqInboundListener (after)                          only typed text, only when enabled
             FaqMatchService   exact -> vector (pgvector) -> trigram
             FaqAnswerService  queue bot message  |  start linked flow  |  nothing
             faq_match_logs    one row, the outcome that really happened

FAQ edit -> faqs / faq_variations (embed_state = pending)
   -> FaqEmbedWorker (worker process, every 5 s)  claims a batch (SKIP LOCKED), embeds via OpenRouter, stores halfvec(3072)

Platform operator -> /v2/platform/faq  (engine switch, model, limits, re-index)  -> platform_settings 'faq.config'
```

| Part                               | Where                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables                             | `faq_settings` (one row per workspace), `faqs`, `faq_variations` (text + `halfvec(3072)`), `faq_match_logs`                                                       |
| Matching rules (pure, unit-tested) | `faq.rules.ts`                                                                                                                                                    |
| AI port and adapters               | `infra/providers/faq-knowledge/`: `OpenRouterFaqAiAdapter`, `FixtureFaqAiAdapter` (tests, `FAQ_AI_DRIVER=fixture`, refused in production)                         |
| Key, cap and ledger                | `AiKeyResolver`, `AiTokenMeter` (AIADM); no key in the environment                                                                                                |
| Flow step                          | builder node `faq` ("Answer from FAQ"): `FaqFlowService`, runtime `faq-node.ts`; exits matched / no match; logs `origin: flow`                                    |
| Borderline check                   | `FaqVerifyService`: a small chat model can veto a match inside `[bar, bar + band)`; settings `verify_mode`, `verify_band`; platform `verifyEnabled/Model/PerHour` |
| Worker                             | `FaqKnowledgeWorkerModule`: embed queue, inbound listener, 90 day log sweep                                                                                       |
| Web (workspace)                    | `apps/web/src/features/faq-knowledge/`, routes `/faq`, `/faq/new`, `/faq/[id]`, `/faq/test`, `/faq/unanswered`, `/faq/insights`, `/faq/settings`                  |
| Web (platform)                     | `apps/web/src/features/faq-knowledge/platform/`, route `/admin/faq`                                                                                               |

## Design points worth knowing before changing anything

- **Exact scan, no ANN index.** A workspace holds hundreds to a few thousand variations; filtering by `org_id` and scanning is exact and fast,
  and avoids the filtered-HNSW recall problem under row-level security. Add HNSW (`halfvec_cosine_ops`, `hnsw.iterative_scan =
relaxed_order`) only if one workspace passes ~50k variations.
- **Scores belong to a model.** 0.45 is 97% precise on `text-embedding-3-large` and 71% on `gemini-embedding-2`. The default threshold follows
  the model; changing the model drops an operator-fixed default and flags workspaces that tuned theirs (`modelChanged`).
- **No hit counter column.** A counter `UPDATE` would fire `touch_row` and bump `row_version` on every customer message, so an editor would get
  409 for a change nobody made. Hits are counted from the log.
- **Boundaries are compared at four decimals** (what the screens show), because `0.7 - 0.6` is `0.09999999999999998`.
- **One answer per message.** The reply's `clientMessageId` is a uuid derived from the inbound message (`answerId`), so a retried job queues one reply.
- **A save never waits for the vendor, and a vendor outage never breaks answering**: exact phrases and spelling similarity still work.
- **The question is a variation** (`source: question`), so a match reads one table.

## Running and testing it

```bash
# unit (pure rules, both adapters)
pnpm --filter @crm/api exec vitest run --dir test/unit test/unit/faq-knowledge
# end to end: real Postgres (pgvector) + Redis in containers, the whole inbox pipeline on a simulator channel, offline AI fixture
pnpm --filter @crm/api exec vitest run --dir test/e2e test/e2e/faq-knowledge/faq.e2e --testTimeout=120000
# live: the same dataset through the real OpenRouter API (spends a few cents; the key is read from the environment only)
FAQ_LIVE_OPENROUTER_KEY=sk-or-... pnpm --filter @crm/api exec vitest run --dir test/e2e test/e2e/faq-knowledge/faq.live --testTimeout=300000
```

Browser tests (Playwright, `apps/web/e2e/faq-knowledge/`, 154 tests over the workspace and platform screens) drive a running stack on a scratch database with the
offline AI driver; how to run them is at the end of [the parity note](../parity/faq-knowledge.md).

Local stack against a scratch database: set `FAQ_AI_DRIVER=fixture` in `.env` and run the API and the worker (`pnpm dev`, `pnpm dev:worker`);
the fixture embeds by shared words, so "order status" answers "Where is my order?" with no key and no network. For the real vendor, unset it and
save an OpenRouter key under Admin, AI keys.

## Not done on purpose (follow-ups)

- **Ordering against keyword rules.** Flow keyword triggers and waiting runs already run before the FAQ (pinned by an e2e test). If a separate
  keyword auto-reply listener is ever added to the inbox it must register before this one (it is an `after` listener).
- **Plan gating.** No plan feature fits; add `faq_knowledge` to the plan catalogue if the commercial plans should gate it (the platform switch and
  the per-workspace switch exist already).
- **Importing Geta's FAQs and variations** (ADR-0015): a one-off script reading Geta's `bot_workspace` and `faq_variations` and calling the create
  route; not needed while the feature is new to this platform.
- **Other languages in the UI**: only `en` messages exist (like the API Library); the matching itself is multilingual.
- **A second embedding width.** The column is fixed at 3072; a model with another width needs a new column and a migration.
