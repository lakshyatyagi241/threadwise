# WaDesk port tracker — Punya

Only Punya edits this file (`wadesk-ownership-guard` enforces it). Statuses: todo · in-progress · backend-done · frontend-done · done · verified · blocked · wontfix.
Update with: `python3 .claude/skills/wadesk-parity-tracker/scripts/tracker.py set WD-XXX-001 in-progress --pr 123`

## catalog-products (cat)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-CAT-001 | done |  |  |
| WD-CAT-002 | done |  |  |
| WD-CAT-003 | done |  |  |
| WD-CAT-004 | done |  |  |
| WD-CAT-005 | done |  |  |
| WD-CAT-006 | done |  |  |
| WD-CAT-007 | done |  | reference /catalog returns 500 (WaDesk bug); checked against Blade source and fixture mode only |
| WD-CAT-008 | done |  | reference /catalog returns 500 (WaDesk bug); checked against Blade source and fixture mode only |
| WD-CAT-009 | done |  |  |
| WD-CAT-010 | done |  |  |
| WD-CAT-011 | done |  |  |
| WD-CAT-012 | done |  |  |
| WD-CAT-013 | done |  |  |
| WD-CAT-014 | done |  |  |
| WD-CAT-015 | done |  | plan-first message billing blocked on wallet-message-billing |
| WD-CAT-016 | done |  |  |
| WD-CAT-017 | done |  |  |
| WD-CAT-018 | done |  |  |
| WD-CAT-019 | done |  |  |
| WD-CAT-020 | done |  |  |
| WD-CAT-021 | done |  |  |
| WD-CAT-022 | done |  |  |
| WD-CAT-023 | done |  |  |
| WD-CAT-024 | done |  |  |
| WD-CAT-025 | done |  |  |
| WD-CAT-026 | done |  |  |
| WD-CAT-027 | done |  |  |
| WD-CAT-028 | blocked |  | service done and tested; no inbound caller (WABA_INBOUND_SINK is owned by the inbox domain) |
| WD-CAT-029 | blocked |  | service done and tested; no inbound caller (WABA_INBOUND_SINK is owned by the inbox domain) |
| WD-CAT-030 | done |  |  |
| WD-CAT-031 | blocked |  | picker endpoint done; per-conversation send route belongs to team-inbox |
| WD-CAT-032 | done |  |  |
| WD-CAT-033 | done |  |  |
| WD-CAT-034 | done |  |  |
| WD-CAT-035 | done |  |  |
| WD-CAT-036 | blocked |  | Store rail belongs to the STORE domain |

## storefront-builder (store)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-STORE-001 | done |  |  |
| WD-STORE-002 | in-progress |  | partial: sibling pages (orders, coupons...) belong to CHK, shown Coming soon |
| WD-STORE-003 | done |  |  |
| WD-STORE-004 | done |  |  |
| WD-STORE-005 | done |  |  |
| WD-STORE-006 | done |  |  |
| WD-STORE-007 | done |  |  |
| WD-STORE-008 | done |  |  |
| WD-STORE-009 | done |  |  |
| WD-STORE-010 | done |  |  |
| WD-STORE-011 | done |  |  |
| WD-STORE-012 | done |  |  |
| WD-STORE-013 | done |  |  |
| WD-STORE-014 | done |  |  |
| WD-STORE-015 | done |  |  |
| WD-STORE-016 | done |  |  |
| WD-STORE-017 | done |  |  |
| WD-STORE-018 | done |  |  |
| WD-STORE-019 | done |  |  |
| WD-STORE-020 | done |  |  |
| WD-STORE-021 | in-progress |  | partial: workspace-level custom domain not consulted |
| WD-STORE-022 | done |  |  |
| WD-STORE-023 | blocked |  | sibling store pages belong to checkout-orders-merchant-payments |
| WD-STORE-024 | done |  |  |
| WD-STORE-025 | wontfix |  | dead code in WaDesk |
| WD-STORE-026 | done |  |  |
| WD-STORE-027 | done |  |  |
| WD-STORE-028 | done |  | partial as WaDesk: handle stored, never used |
| WD-STORE-029 | done |  |  |
| WD-STORE-030 | done |  |  |
| WD-STORE-031 | done |  |  |

## ai-agents-training (aiag)

| Feature | Status | PR | Notes |
|---|---|---|---|
| WD-AIAG-001 | frontend-done |  | built by lakshya on lakshya/aiag/ai-training for the owner's reported 404; twin parity run and gate not yet done |
| WD-AIAG-002 | frontend-done |  | five-step wizard; creativity 0 kept (WaDesk bug) |
| WD-AIAG-003 | frontend-done |  | PATCH on an unknown id is 404 (WaDesk created a new assistant); rowVersion lock |
| WD-AIAG-004 | frontend-done |  | files are copied per entry (WaDesk shared one file) |
| WD-AIAG-005 | frontend-done |  | files removed after commit |
| WD-AIAG-006 | frontend-done |  | pastes over the 100 KiB JSON body cap are 413; use a file |
| WD-AIAG-007 | frontend-done |  | read by the worker (outbox consumer); fetched with own SSRF rule, shared helper misses hex-mapped IPv6 (follow-up task) |
| WD-AIAG-008 | frontend-done |  | PDF via unpdf (new dependency), DOCX via own ZIP reader; files on local disk behind TRAINING_FILE_STORE |
| WD-AIAG-009 | frontend-done |  |  |
| WD-AIAG-010 | frontend-done |  | readers include them; nothing creates one (as WaDesk) |
| WD-AIAG-011 | frontend-done |  | /ai-training/assistants/picker; the flow and widget pickers are unchanged |
| WD-AIAG-012 | done |  | intended: FK cascade, no orphans to sweep |
| WD-AIAG-013 | frontend-done |  | stores and audits the choice; the stand-down of our AI/keyword replies is not changed (see wiring WIRE-AIAG-012) |
| WD-AIAG-014 | frontend-done |  | plan feature ai_assistants; keys aiag.training.* and aiag.responder.manage |
| WD-AIAG-015 | frontend-done |  | readers unchanged and covered by e2e |
| WD-AIAG-016 | frontend-done |  | our addition: Create knowledge base link and Refresh list in the three AI node forms |
| WD-AIAG-017 | blocked |  | inbox AI agents (ai_agents, /ai-agents): separate port, not in this slice |
| WD-AIAG-018 | blocked |  | AI voice assistants (ai_call_assistants): belongs with calling-voice, not in this slice |
