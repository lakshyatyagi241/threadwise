# Embedding model evaluation (FAQ matching)

Why `openai/text-embedding-3-large` is the default, and how to repeat the test. Decision record: [ADR-0021](../../adr/0021-faq-semantic-matching-pgvector.md).

## Method

- **Data** (`eval/data.json`): 16 customer-support FAQs, each with the question and 5 variations (what a client would write). 80 held-out
  customer phrasings (5 per FAQ: a paraphrase, a long contextual message, a typo, a romanised-Hindi message, a one-word keyword) and 30
  negatives (off-topic or social messages that no FAQ covers). Synthetic: the numbers show the _shape_, not what a given client will see.
- **Run** (`eval/run.mjs`): every model embeds the FAQ texts and the queries through OpenRouter's `/embeddings`; each query is scored against
  every variation by cosine similarity and the best variation per FAQ decides.
  `OPENROUTER_API_KEY=sk-or-... node run.mjs openai/text-embedding-3-large google/gemini-embedding-2` prints the numbers and a threshold sweep.
- **Metrics**: _top-1_ = the right FAQ ranked first; _rec@3_ = right FAQ in the top three; _negatives p90 / max_ = the score of the 90th
  percentile / highest off-topic message (the ceiling a threshold must clear); _best threshold_ = the threshold that keeps precision at
  95% or more while answering the most messages, with the _coverage_ it gives (share of the 80 phrasings answered correctly).
- Geta's current model (`all-MiniLM-L6-v2`) is the baseline. It is served by OpenRouter too, so it ran in the same harness.

## Results (2026-10-09)

| Model                                    | Dims | Top-1  | Rec@3  | Negatives p90 / max | Best threshold at 95% precision | Coverage there |
| ---------------------------------------- | ---- | ------ | ------ | ------------------- | ------------------------------- | -------------- |
| `openai/text-embedding-3-large`          | 3072 | 100.0% | 100.0% | 0.40 / 0.50         | 0.38                            | 96%            |
| `perplexity/pplx-embed-v1-4b`            | 2560 | 97.5%  | 100.0% | 0.33 / 0.47         | 0.34                            | 89%            |
| `google/gemini-embedding-2`              | 3072 | 97.5%  | 100.0% | 0.69 / 0.70         | 0.70                            | 85%            |
| `qwen/qwen3-embedding-8b`                | 4096 | 95.0%  | 100.0% | 0.75 / 0.77         | 0.76                            | 80%            |
| `voyageai/voyage-4`                      | 1024 | 95.0%  | 100.0% | 0.62 / 0.63         | 0.64                            | 62%            |
| `openai/text-embedding-3-small`          | 1536 | 90.0%  | 98.8%  | 0.42 / 0.53         | 0.54                            | 54%            |
| `voyageai/voyage-4-lite`                 | 1024 | 92.5%  | 98.8%  | 0.65 / 0.75         | 0.68                            | 52%            |
| `baai/bge-m3`                            | 1024 | 91.2%  | 96.2%  | 0.72 / 0.76         | 0.74                            | 50%            |
| `qwen/qwen3-embedding-4b`                | 2560 | 93.8%  | 100.0% | 0.70 / 0.78         | 0.78                            | 49%            |
| `intfloat/multilingual-e5-large`         | 1024 | 82.5%  | 92.5%  | 0.87 / 0.89         | 0.89                            | 36%            |
| `sentence-transformers/all-minilm-l6-v2` | 384  | 82.5%  | 95.0%  | 0.43 / 0.55         | 0.70                            | 24%            |

Reading it: `text-embedding-3-large` found the right FAQ first for every phrasing, including the typos and the romanised Hindi, and keeps
the most coverage at high precision. The baseline MiniLM found it first in 82.5% of cases and covers only 24% at 95% precision, which is
why a straight port of Geta's matcher would answer less _and_ answer wrongly more often.

Only the models whose vectors are 3072 wide can be stored in `faq_variations.embedding halfvec(3072)`, so the platform allow-list is
`openai/text-embedding-3-large` and `google/gemini-embedding-2`. `qwen/qwen3-embedding-8b` (4096 wide, 1/13 of the price) tied on top-1 but
cannot be stored without truncation; revisit if cost matters.

## Scores are not comparable between models

The same threshold means different things on different models, so the platform keeps a **recommended threshold per model** and the
default follows the model in use:

| Threshold | `text-embedding-3-large` precision / coverage | `gemini-embedding-2` precision / coverage |
| --------- | --------------------------------------------- | ----------------------------------------- |
| 0.40      | 97% / 95%                                     | 71% / 98%                                 |
| 0.45      | 97% / 89%                                     | 71% / 98%                                 |
| 0.50      | 98% / 69%                                     | 71% / 98%                                 |
| 0.60      | 100% / 38%                                    | 79% / 96%                                 |
| 0.70      | 100% / 9%                                     | 97% / 85%                                 |
| 0.72      | 100% / 5%                                     | 97% / 78%                                 |

`openai/text-embedding-3-large` ships with 0.50 (conservative on purpose: a wrong auto-answer costs more than a silent one, and the
learning loop turns unanswered messages into variations). `google/gemini-embedding-2` needs about 0.72. When the operator changes the
model, a threshold fixed for the old model is dropped and workspaces that tuned theirs are flagged to review it.

## Live confirmation through the whole stack

`apps/api/test/e2e/faq-knowledge/faq.live.e2e.spec.ts` (opt-in, `FAQ_LIVE_OPENROUTER_KEY`) runs the same dataset through the real API,
worker, Postgres `halfvec` storage and the SQL matcher with the real vendor. Result on 2026-10-09 at threshold 0.5:
top-1 80/80, wrong answers 0 of 55 answered, one off-topic message answered of 30 ("send me a pizza" matched "Get my invoice" at 0.503),
precision 98.2%, coverage 68.8%. That equals the offline sweep above, so storing the vectors as `halfvec` and scanning them in SQL loses nothing.
Indexing the 96 variations took 316 tokens in 2 requests (about $0.00004).
