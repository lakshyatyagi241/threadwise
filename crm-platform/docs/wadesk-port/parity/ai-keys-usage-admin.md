# Parity: ai-keys-usage-admin (AIADM)

Built in rounds 1 and 2 (commits `f34662b1`, `1c6050f1`): migration + Drizzle mirror, contracts, API module (platform keys, workspace BYOK keys, resolver, meter, models, usage), operator and workspace screens, tests.

## Status by feature

- Built (code, unit/web tests green; DB-backed tests not re-run this round, see below): WD-AIADM-001..017, 019..028.
- Not ported on purpose: WD-AIADM-018 stays an operation (`AiTokenMeter.guard`) that AI-calling domains invoke; WaDesk never called it, so enforcement is a product decision. WD-AIADM-029 is docs-only in WaDesk; this port audits key changes (deliberate fix). Extras `organization`, `project_id`, `voice_id` are dead config in WaDesk (nothing reads them) and are not ported.
- Blocked on other domains: voice-call and Node-bridge usage in the ledger (CALL, NODE); callers of `AiKeyResolver` / `AiTokenMeter` in AIAG, AICRM, CALL, FLB, TPL, CAMP.

## Conformance (admin AI keys page, from `admin/api-keys/index.blade.php`)

Aligned this round: eyebrow "Admin · System · AI providers", title "AI API keys", sub-copy, status tiles (Providers/seeded, Active/enabled for fallback, Ready/active + has key, No key set/paste a key to ready), Disabled pill, Activate/Disable button, Sort order, "— Pick a default model —", saved-key placeholder.

Intended deviations: providers grouped under Language models / Voice headings; "Extra models" and "Remove key" are added (WaDesk has no field or action for them, see inventory WD-AIADM-002 rule 4 and WD-AIADM-003 port notes); last four characters of a saved key shown; optimistic locking and audit.

Not done: side-by-side browser comparison with the live WaDesk (see not verified).

tier P0 done: WD-AIADM-001, 002, 003, 004, 006, 010, 016 (ledger write path; voice/bridge writers blocked)
tier P1 done: WD-AIADM-005, 008, 009, 011..015, 017, 020..027
tier P2 done: WD-AIADM-007, 019, 028

## Round 2 close-out

DB-backed gates run against crm_aiadm after `pnpm db:migrate` (178 migrations): integration `ai-schema.spec.ts` 10/10, API e2e `ai-keys.e2e.spec.ts` 57/57, API unit 39/39, web feature tests 24/24, `db:verify-schema` 0 errors, arch:check clean (one pre-existing orphan warning in paygw), web lint and API lint clean. Typecheck errors that remain are in other domains' files (chat channel-dispatcher spec, auth plan-draft test), none in AIADM.

Conformance, read from `admin/ai-dashboard/index.blade.php` and `user/ai-usage/index.blade.php` (no live-page side-by-side was run): the admin dashboard now carries WaDesk's copy and structure: title "AI usage & token burn", KPI strip Tokens burned / Estimated cost / AI calls / Workspaces using AI with WaDesk's sub-lines, "Daily token burn" with the peak line, "Tokens by provider", "Who pays — platform vs BYOK" with the plan-cap note, "Top token-burning workspaces" (calls and BYOK per row), "Top models", "AI key health" with "Manage keys", "no default model", Live/Off, "BYOK keys active", "Workspaces on BYOK". The workspace usage page uses WaDesk's headings (By provider, By model, Plan keys vs your keys, This month · plan AI cap), cap and BYOK notes and the cost disclaimer.

Intended deviations (added): "Live" means active and the key decrypts (WaDesk showed the raw Active flag, inventory WD-AIADM-024 quirk 5); the "AI voice calls" figure is omitted until CALL writes voice usage (blocked); charts are bars built from @crm/ui tokens rather than WaDesk's inline SVG line, same data.

The inventory "implemented / partial / dead-code" column describes WaDesk itself, not this port; the partial rows (002, 015, 016, 026) are partial in WaDesk and are ported with their documented behaviour.

## Round 3: live comparison with the running WaDesk (admin AI keys, admin AI dashboard)

Opened `/admin/api-keys` and `/admin/ai-dashboard` on the live WaDesk (22 providers, all disabled, no keys) and read the views and `AdminAiKeyController::FIELD_SCHEMA`. Fixed on the keys page:

- Provider card name "Anthropic Claude" (new migration `20261025090000_aiadm_anthropic_claude_name`; WaDesk's seed names it so).
- Card sub-line "provider: openai · default model: gpt-5.4-mini" (was "Provider id: ...").
- Per-provider API key hint in WaDesk's words (all 22), required asterisk, `autocomplete=new-password`, placeholder "paste key here".
- The optional text field is back: Organization ID (OpenAI), Project ID (Gemini), Default voice ID (ElevenLabs). WaDesk saves them and nothing reads them; reproduced deliberately (stored in `extra_config`, audited), so the card matches. Unlike WaDesk, a blank value clears it.
- Field order and grouping as WaDesk: key, text field, max tokens (placeholder "e.g. 4096", WaDesk's hint), then a rule and Default model, Sort order; a custom stored model is listed last as "(custom)".
- One flat list ordered by sort order (the Language models / Voice headings were removed; voice vendors sort last anyway).
- Footer card "How these keys are used / Fallback chain" with WaDesk's text.

Dashboard: copy, KPI strip, sections, key-health list (capitalised provider, model or "no default model", Off) already matched the live page; no change. The workspace usage page was not opened live (needs a registered workspace user); it follows `user/ai-usage/index.blade.php`.

Remaining intended deviations on the keys page: last four characters of the saved key, "Extra models" and "Remove key" (no WaDesk equivalent), optimistic locking.

Feature status: every feature of the index is built except WD-AIADM-018 (dead code in WaDesk, `AiTokenMeter.guard` has no callers; the guard exists as an operation, enforcement is not wired, on purpose). WD-AIADM-029 is docs-only in WaDesk; the port audits key changes (deliberate fix).
