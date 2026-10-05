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
