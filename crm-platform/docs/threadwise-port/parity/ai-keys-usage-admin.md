# Parity: ai-keys-usage-admin (AIADM)

Built in rounds 1 and 2 (commits `f34662b1`, `1c6050f1`): migration + Drizzle mirror, contracts, API module (platform keys, workspace BYOK keys, resolver, meter, models, usage), operator and workspace screens, tests.

## Status by feature

- Built (code, unit/web tests green; DB-backed tests not re-run this round, see below): TW-AIADM-001..017, 019..028.
- Not ported on purpose: TW-AIADM-018 stays an operation (`AiTokenMeter.guard`) that AI-calling domains invoke; Reference never called it, so enforcement is a product decision. TW-AIADM-029 is docs-only in Reference; this port audits key changes (deliberate fix). Extras `organization`, `project_id`, `voice_id` are dead config in Reference (nothing reads them) and are not ported.
- Blocked on other domains: voice-call and Node-bridge usage in the ledger (CALL, NODE); callers of `AiKeyResolver` / `AiTokenMeter` in AIAG, AICRM, CALL, FLB, TPL, CAMP.

## Conformance (admin AI keys page, from `admin/api-keys/index.blade.php`)

Aligned this round: eyebrow "Admin · System · AI providers", title "AI API keys", sub-copy, status tiles (Providers/seeded, Active/enabled for fallback, Ready/active + has key, No key set/paste a key to ready), Disabled pill, Activate/Disable button, Sort order, "— Pick a default model —", saved-key placeholder.

Intended deviations: providers grouped under Language models / Voice headings; "Extra models" and "Remove key" are added (Reference has no field or action for them, see inventory TW-AIADM-002 rule 4 and TW-AIADM-003 port notes); last four characters of a saved key shown; optimistic locking and audit.

Not done: side-by-side browser comparison with the live Reference (see not verified).

tier P0 done: TW-AIADM-001, 002, 003, 004, 006, 010, 016 (ledger write path; voice/bridge writers blocked)
tier P1 done: TW-AIADM-005, 008, 009, 011..015, 017, 020..027
tier P2 done: TW-AIADM-007, 019, 028
