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

## Round 2 close-out

DB-backed gates run against crm_aiadm after `pnpm db:migrate` (178 migrations): integration `ai-schema.spec.ts` 10/10, API e2e `ai-keys.e2e.spec.ts` 57/57, API unit 39/39, web feature tests 24/24, `db:verify-schema` 0 errors, arch:check clean (one pre-existing orphan warning in paygw), web lint and API lint clean. Typecheck errors that remain are in other domains' files (chat channel-dispatcher spec, auth plan-draft test), none in AIADM.

Conformance, read from `admin/ai-dashboard/index.blade.php` and `user/ai-usage/index.blade.php` (no live-page side-by-side was run): the admin dashboard now carries Reference's copy and structure: title "AI usage & token burn", KPI strip Tokens burned / Estimated cost / AI calls / Workspaces using AI with Reference's sub-lines, "Daily token burn" with the peak line, "Tokens by provider", "Who pays — platform vs BYOK" with the plan-cap note, "Top token-burning workspaces" (calls and BYOK per row), "Top models", "AI key health" with "Manage keys", "no default model", Live/Off, "BYOK keys active", "Workspaces on BYOK". The workspace usage page uses Reference's headings (By provider, By model, Plan keys vs your keys, This month · plan AI cap), cap and BYOK notes and the cost disclaimer.

Intended deviations (added): "Live" means active and the key decrypts (Reference showed the raw Active flag, inventory TW-AIADM-024 quirk 5); the "AI voice calls" figure is omitted until CALL writes voice usage (blocked); charts are bars built from @crm/ui tokens rather than Reference's inline SVG line, same data.

The inventory "implemented / partial / dead-code" column describes Reference itself, not this port; the partial rows (002, 015, 016, 026) are partial in Reference and are ported with their documented behaviour.
