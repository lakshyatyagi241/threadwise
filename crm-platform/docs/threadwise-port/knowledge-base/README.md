# Knowledge base search (AI agents): domain notes

What an AI agent reads when a customer writes. Decision and trade-offs: [ADR-0021 addendum 3](../../adr/0021-faq-semantic-matching-pgvector.md).
Replaces the FAQ engine ([faq-knowledge/README.md](../faq-knowledge/README.md), retired).

```
AI Training  ->  ai_training_sources (one agent each: URL, text, Q&A, file; FAQs are a text entry "FAQ" or Q&A entries)
   ready  ->  KbIndexService.indexSource (same transaction)  ->  ai_training_chunks (pending)
   KbEmbedWorker (worker, every 5 s)   claims a batch (SKIP LOCKED) -> OpenRouter embeddings -> halfvec(3072), ready
                                       about once a minute: cut entries that have no passages, re-queue other-model / failed rows

customer message
   flow AI step (AiCallService)  |  website chat (WidgetPublicService)
        -> KbRetrievalService.retrieve(org, agent, message)
             vector search of THIS agent's passages -> floor + band + top 3  (+ unindexed text) -> grounded prompt
             search cannot run -> the agent's whole base, as before
```

## Pieces

| Piece                  | Where                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables                 | `ai_training_chunks` (migration `20270205090000`); drizzle in `packages/db/src/schema/ai-agents-training/tables.ts`                               |
| Constants              | `packages/contracts/src/knowledge-base/index.ts`: models, `KB_RETRIEVAL` (top-k 3, band 0.12, chunk 900 chars, overlap 120, floor per model)      |
| Module                 | `apps/api/src/modules/knowledge-base/` (`KnowledgeBaseModule` for API and flow runtime, `KnowledgeBaseWorkerModule` for the worker only)         |
| Vendor port            | `apps/api/src/infra/providers/knowledge-base/`: OpenRouter embeddings, or `KB_AI_DRIVER=fixture` offline (refused in production)                  |
| Pure rules             | `kb.rules.ts` (floor + band + top-k, query cut), `kb-chunker.ts` (one FAQ question per passage); tests in `apps/api/test/unit/knowledge-base/`   |
| Readers                | `flow-runtime-engine/.../ai-call.service.ts`, `chatbot-widget/widget-public.service.ts` (+ `ai-prompt.ts`)                                        |
| What users see         | AI Training > an agent > Knowledge: entries, "Add FAQ", a failed page with its reason. No scores, switches, indexing status or tests.             |

## Before changing the numbers or the model

Scores are not comparable between models, and combining passages is where a wrong answer is born. Run a fixed set of real customer questions
(include ones the knowledge does NOT answer) through the agent with the change, and compare against the answers you expect; a question the base
cannot answer must get "I do not know", not a blend. Only then change `KB_RETRIEVAL` or the model allow-list.

## Known gaps

- `tools/migration` (legacy data load) still writes the old `faq*` tables; until it is retargeted at text entries per agent, FAQs it loads are
  not read by anything. The old tables are kept for that reason.
- No usage insights are shown. If a simple "what customers ask" view is wanted it needs retrieval logging, which does not exist yet.
