# Parity evidence: AI Training (AIAG), slice WD-AIAG-001 to 016

WaDesk 1.7.0 reference vs this branch (`lakshya/aiag/ai-training`). API: [docs/api/ai-agents-training.md](../../api/ai-agents-training.md). Wiring:
[wiring/ai-agents-training.md](../wiring/ai-agents-training.md).

## What was verified, and how

- Behavior was read from the reference source (`AiTrainingController`, `AiChatAssistant`, `AiTrainingSource`, `AiChatService::contextFor`, `AiAgentService`, the Blade views
  and the builder JS). **The reference app was not run and the `wadesk-playwright-parity` twin run was not done in this session**, so there is no `same / intended / defect`
  table yet and no stamp. Until it is run, every UI statement here is from the source, not from a side-by-side.
- Automated: unit (rules, extraction, SSRF refusals, contracts, web models, messages, rendered components), and a 99-test e2e against a throw-away Postgres and Redis
  (permissions, plan gate, every validation boundary, sources of every kind, the worker consumer, files on disk, duplicate, cascade delete, tenant isolation, the responder
  mode and the readers).

## Intended differences (each needs the domain owner's approval)

| Id          | WaDesk                                                                 | Here                                                                                                                                                          | Why                                                   |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| WD-AIAG-001 | status tabs and rail buttons do nothing; delete leaves the cards stale | the status views filter the loaded rows; delete refreshes the cards                                                                                           | PORTING_RULES 5.2 (no dead buttons)                   |
| WD-AIAG-001 | page numbers                                                           | cursor pages of 20                                                                                                                                            | architecture                                          |
| WD-AIAG-002 | creativity 0 saved as 0.7 (`parseFloat(x) \|\| 0.7`)                   | 0 is kept                                                                                                                                                     | plain bug                                             |
| WD-AIAG-003 | saving with an unknown id creates a new assistant                      | 404                                                                                                                                                           | plain bug                                             |
| WD-AIAG-003 | last write wins                                                        | `rowVersion`, 409 on a stale save                                                                                                                             | architecture (optimistic locking)                     |
| WD-AIAG-004 | a copied entry shares the original's file                              | each copy has its own file                                                                                                                                    | plain bug (deleting one deleted the other's file)     |
| WD-AIAG-006 | up to 200 000 characters of pasted text                                | the schema allows 200 000, but the platform JSON body cap (100 KiB, `INFRA_BODY_LIMIT_KB`) refuses larger pastes with 413 and the panel says to upload a file | kernel setting, see decisions                         |
| WD-AIAG-007 | the page is fetched while the request waits; ready or failed at once   | the entry is `processing`, a worker reads it, the list polls every 3 s                                                                                        | a slow page must not hold a request (worker-job rule) |
| WD-AIAG-007 | `FILTER_FLAG_NO_PRIV_RANGE` check, one DNS lookup                      | own address rule incl. IPv4-mapped IPv6, NAT64, 6to4, Teredo; the checked address is the connected one                                                        | security hardening                                    |
| WD-AIAG-008 | text file read verbatim even if binary; no zip size cap                | a binary "text" file and a document that inflates past 64 MB are refused                                                                                      | security hardening                                    |
| WD-AIAG-008 | the stored path is in the database only                                | same; the response carries `hasFile` only                                                                                                                     | security                                              |
| WD-AIAG-012 | orphan sweep on each list load                                         | not needed                                                                                                                                                    | FK cascade                                            |
| WD-AIAG-014 | page-only paywall, JSON endpoints answered anyway                      | 422 `PLAN_FEATURE_LOCKED` on every route                                                                                                                      | plan rule of this repo                                |
| WD-AIAG-016 | n/a                                                                    | "+ Create knowledge base" and "Refresh list" in the AI node forms; AI Training links open in a new tab                                                        | owner-reported gap (not a WaDesk feature)             |

## Not verified, and why

- The Brain step's model suggestions come from `GET /v2/ai/models`; a live provider call with a trained assistant was not made (needs real keys).
- PDF extraction was checked on a generated one-page PDF only; scanned and encrypted PDFs, and large real-world DOCX files, were not tried.
- The responder mode only stores the choice: no sender in this repo reads it yet (see WIRE-AIAG-012), so "our AI stays silent when Meta answers" is NOT verified and not implemented here.
- A live URL fetch against the public internet was not run (the fetcher is tested with a stubbed socket and with real local servers that must be refused).
- Arabic copy and RTL layout were written but not reviewed by a native reader or in a browser.
