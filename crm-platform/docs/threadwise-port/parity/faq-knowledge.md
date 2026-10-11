# FAQ knowledge base (FAQ): parity evidence

**There is no Reference twin.** Reference has no FAQ feature: its keyword auto-replies and flow keyword triggers match words, not meaning, and are
unchanged by this domain (it is off for every workspace until its owner switches it on, and it runs after the flow runtime has had its turn).
The feature was built at the project owner's request to replace the FAQ matching of the previous product (Geta's NLU service), so
`threadwise-playwright-parity` has nothing to compare against. Same as the API Library, the rest of the repo's rules apply in full.

What was done instead, so that "no twin" does not mean "no proof":

| Layer           | Where                                                                                                                                     | What it proves                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure rules      | `apps/api/test/unit/faq-knowledge/rules.spec.ts`                                                                                          | thresholds, margin, per-FAQ override, boundary rounding, suggestion parsing, NUL stripping, deterministic answer id                                                                          |
| Vendor adapters | `.../ai-adapters.spec.ts`                                                                                                                 | request shape, batching, error mapping, no vendor body in messages, dimension check, the offline fixture                                                                                     |
| Environment     | `.../env-schema.spec.ts`                                                                                                                  | the offline fixture cannot boot in production                                                                                                                                                |
| API end to end  | `apps/api/test/e2e/faq-knowledge/faq.e2e.spec.ts` (real Postgres with pgvector and Redis, the full inbox pipeline on a simulator channel) | permissions per key, save rules, limits, indexing and failure, every matcher outcome, answering customers, the learning loop, platform controls, tenant isolation down to row-level security |
| Real vendor     | `.../faq.live.e2e.spec.ts` (opt-in, `FAQ_LIVE_OPENROUTER_KEY`)                                                                            | the same dataset through OpenRouter and `halfvec` storage: top-1 80/80, precision 98.2%, coverage 68.8% at 0.5                                                                               |
| Browser         | `apps/web/e2e/faq-knowledge/*.spec.ts`                                                                                                    | the screens, their edge cases, permissions, RTL, dark mode, phone width, console cleanliness (see the run notes below)                                                                       |

## Intended differences from the product it replaces (Geta)

| Geta                                                      | Here                                                                                                                      | Why                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Matching in a separate NLU service over a per-bot pickle  | Vectors in Postgres (`halfvec(3072)`), same transaction and row-level security as the FAQ                                 | no sync job, no stale index, shared by every replica (ADR-0021)                            |
| Retrain after every change                                | A saved variation is indexed by the worker within seconds                                                                 | the pickle had to be rebuilt                                                               |
| One fixed 0.70 / 85 bar inside the NLU service            | Per-workspace threshold, optional per-FAQ override, optional minimum lead over the runner-up, recommended value per model | scores belong to a model; owners can tune with the numbers in front of them                |
| "Link to node" starts a flow at a chosen node             | Starts the flow from its trigger                                                                                          | the flow launcher has no start-node parameter (flow runtime domain); listed as a follow-up |
| No visibility into why a message was or was not answered  | Playground, match log with candidates and scores, unanswered list that turns a message into a variation in one click      | the main reason owners distrust a matcher                                                  |
| Variations generated by a paraphrase model with no review | Suggestions are shown and only saved when the person picks them                                                           | a model's mistake never reaches the matcher unseen                                         |

## Browser run notes (2026-10-10, local stack, offline AI fixture)

- Workspace screens: 74 tests in 11 files (`first-run`, `list`, `editor`, `editor-advanced`, `playground`, `customer-loop`, `unanswered`, `insights`,
  `settings`, `permissions`, `cross-cutting`): 74 passed (one timing flake in the model-change test fixed by a longer re-index wait).
- Platform admin (`/admin/faq`): 80 tests in 9 `admin-*` files, all passed; the platform config was verified unchanged at the end.
- Defects the browser runs found in the web code, all fixed: double submit on Save and on the re-index confirm, the "follow the model" checkbox
  jumping the slider back to the old model's number, focus lost after save/discard/delete/remove/dismiss (now moved to the heading or the next
  row), light-mode contrast on two small labels, field errors left on screen after the field was fixed, a 404 refetch of a just-deleted FAQ
  from the editor, "below the 0% bar" on the unanswered screen, a search placeholder promising answers the API does not search, and a focus
  race after a failed save. Found while driving the screens by hand: a nested `<form>` (Enter in "add variation" could submit the editor) and
  an unsized search icon.
- Defects found in the API by the browser runs, all fixed with an end-to-end test: after a model switch the worker could store vectors under
  the replaced model because the platform store caches config for 5 seconds per process (now a fresh read per batch, plus a self-heal pass
  every minute that re-queues vectors of another model and leaves failed rows alone), and a customer message could be dropped for up to 5
  seconds after the engine was switched back on (the inbound path now reads the platform config fresh).
- Not covered: reduced-motion, the auditor operator role, a real unlisted-model state (the API falls back to the default).

Run them (the specs drive a running stack, see `apps/web/playwright.config.ts`; the FAQ specs also need the offline AI driver, `FAQ_AI_DRIVER=fixture`,
so they are deterministic and free):

```bash
cd apps/web
HEADLESS=1 WEB_URL=http://localhost:3201 pnpm exec playwright test -c playwright.faq.config.ts e2e/faq-knowledge --reporter=list
```

`playwright.faq.config.ts` only adds the `FAQ_CHROMIUM` executable override for machines whose installed Chromium revision differs from the
one Playwright expects.
