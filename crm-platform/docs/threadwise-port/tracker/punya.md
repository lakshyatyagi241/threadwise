# Reference port tracker — Punya

Only Punya edits this file (`threadwise-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/threadwise-parity-tracker/scripts/tracker.py set TW-XXX-001 in-progress --pr 123`

## catalog-products (cat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-CAT-001 | done |  |  |
| TW-CAT-002 | done |  |  |
| TW-CAT-003 | done |  |  |
| TW-CAT-004 | done |  |  |
| TW-CAT-005 | done |  |  |
| TW-CAT-006 | done |  |  |
| TW-CAT-007 | done |  | reference /catalog returns 500 (Reference bug); checked against Blade source and fixture mode only |
| TW-CAT-008 | done |  | reference /catalog returns 500 (Reference bug); checked against Blade source and fixture mode only |
| TW-CAT-009 | done |  |  |
| TW-CAT-010 | done |  |  |
| TW-CAT-011 | done |  |  |
| TW-CAT-012 | done |  |  |
| TW-CAT-013 | done |  |  |
| TW-CAT-014 | done |  |  |
| TW-CAT-015 | done |  | plan-first message billing blocked on wallet-message-billing |
| TW-CAT-016 | done |  |  |
| TW-CAT-017 | done |  |  |
| TW-CAT-018 | done |  |  |
| TW-CAT-019 | done |  |  |
| TW-CAT-020 | done |  |  |
| TW-CAT-021 | done |  |  |
| TW-CAT-022 | done |  |  |
| TW-CAT-023 | done |  |  |
| TW-CAT-024 | done |  |  |
| TW-CAT-025 | done |  |  |
| TW-CAT-026 | done |  |  |
| TW-CAT-027 | done |  |  |
| TW-CAT-028 | blocked |  | service done and tested; no inbound caller (WABA_INBOUND_SINK is owned by the inbox domain) |
| TW-CAT-029 | blocked |  | service done and tested; no inbound caller (WABA_INBOUND_SINK is owned by the inbox domain) |
| TW-CAT-030 | done |  |  |
| TW-CAT-031 | blocked |  | picker endpoint done; per-conversation send route belongs to team-inbox |
| TW-CAT-032 | done |  |  |
| TW-CAT-033 | done |  |  |
| TW-CAT-034 | done |  |  |
| TW-CAT-035 | done |  |  |
| TW-CAT-036 | blocked |  | Store rail belongs to the STORE domain |

## storefront-builder (store)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-STORE-001 | done |  |  |
| TW-STORE-002 | in-progress |  | partial: sibling pages (orders, coupons...) belong to CHK, shown Coming soon |
| TW-STORE-003 | done |  |  |
| TW-STORE-004 | done |  |  |
| TW-STORE-005 | done |  |  |
| TW-STORE-006 | done |  |  |
| TW-STORE-007 | done |  |  |
| TW-STORE-008 | done |  |  |
| TW-STORE-009 | done |  |  |
| TW-STORE-010 | done |  |  |
| TW-STORE-011 | done |  |  |
| TW-STORE-012 | done |  |  |
| TW-STORE-013 | done |  |  |
| TW-STORE-014 | done |  |  |
| TW-STORE-015 | done |  |  |
| TW-STORE-016 | done |  |  |
| TW-STORE-017 | done |  |  |
| TW-STORE-018 | done |  |  |
| TW-STORE-019 | done |  |  |
| TW-STORE-020 | done |  |  |
| TW-STORE-021 | in-progress |  | partial: workspace-level custom domain not consulted |
| TW-STORE-022 | done |  |  |
| TW-STORE-023 | blocked |  | sibling store pages belong to checkout-orders-merchant-payments |
| TW-STORE-024 | done |  |  |
| TW-STORE-025 | wontfix |  | dead code in Reference |
| TW-STORE-026 | done |  |  |
| TW-STORE-027 | done |  |  |
| TW-STORE-028 | done |  | partial as Reference: handle stored, never used |
| TW-STORE-029 | done |  |  |
| TW-STORE-030 | done |  |  |
| TW-STORE-031 | done |  |  |

## ai-agents-training (aiag)

| Feature | Status | PR | Notes |
|---|---|---|---|
| TW-AIAG-001 | frontend-done |  | built by lakshya on lakshya/aiag/ai-training for the owner's reported 404; twin parity run and gate not yet done |
| TW-AIAG-002 | frontend-done |  | five-step wizard; creativity 0 kept (Reference bug) |
| TW-AIAG-003 | frontend-done |  | PATCH on an unknown id is 404 (Reference created a new assistant); rowVersion lock |
| TW-AIAG-004 | frontend-done |  | files are copied per entry (Reference shared one file) |
| TW-AIAG-005 | frontend-done |  | files removed after commit |
| TW-AIAG-006 | frontend-done |  | pastes over the 100 KiB JSON body cap are 413; use a file |
| TW-AIAG-007 | frontend-done |  | read by the worker (outbox consumer); fetched with own SSRF rule, shared helper misses hex-mapped IPv6 (follow-up task) |
| TW-AIAG-008 | frontend-done |  | PDF via unpdf (new dependency), DOCX via own ZIP reader; files on local disk behind TRAINING_FILE_STORE |
| TW-AIAG-009 | frontend-done |  |  |
| TW-AIAG-010 | frontend-done |  | readers include them; nothing creates one (as Reference) |
| TW-AIAG-011 | frontend-done |  | /ai-training/assistants/picker; the flow and widget pickers are unchanged |
| TW-AIAG-012 | done |  | intended: FK cascade, no orphans to sweep |
| TW-AIAG-013 | frontend-done |  | stores and audits the choice; the stand-down of our AI/keyword replies is not changed (see wiring WIRE-AIAG-012) |
| TW-AIAG-014 | frontend-done |  | plan feature ai_assistants; keys aiag.training.* and aiag.responder.manage |
| TW-AIAG-015 | frontend-done |  | readers unchanged and covered by e2e |
| TW-AIAG-016 | frontend-done |  | our addition: Create knowledge base link and Refresh list in the three AI node forms |
| TW-AIAG-017 | blocked |  | inbox AI agents (ai_agents, /ai-agents): separate port, not in this slice |
| TW-AIAG-018 | blocked |  | AI voice assistants (ai_call_assistants): belongs with calling-voice, not in this slice |
