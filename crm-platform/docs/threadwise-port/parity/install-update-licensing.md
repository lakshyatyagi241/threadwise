# Parity: install-update-licensing (TW-INST-001 .. 029)

Reference: Reference 1.7.0 Blade views `resources/views/install/*` (welcome, license, requirements, database, application, admin, node,
progress, layout) and `resources/views/admin/update/index.blade.php`. Our side: `/setup` (`apps/web/src/features/install-update-licensing/setup`)
and `/admin/update` (`.../system`).

## How this was checked, and its limits

Source comparison only: each Blade view and its controller were read and the screen rebuilt from them. A live side-by-side in the
browser (headless Playwright against `http://127.0.0.1:8000` and our app) was **not** run in this pass; layout, spacing and colour
fidelity is therefore from the Blade/CSS source, not from pixels. Behaviour is covered by tests (see the end).

## Screens

| Reference screen              | Ours                                                                                       | Result   |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| install layout (card+rail) | one centred card, seven-step rail on the left (lg+), progress bar and step name on mobile  | same     |
| welcome                    | setup token field (replaces nothing in Reference: see D1)                                     | intended |
| license (purchase code)    | shown only when `LICENCE_MODE` enforces a code; sits under rail step 1 like Reference         | same     |
| requirements               | checklist of server prerequisites, blocks "Continue" while a required one fails            | same     |
| database                   | host, port, name, user, password, "Test connection" with transport cascade result          | same     |
| application                | name, URL, timezone typeahead (first 25), locale                                           | same     |
| admin                      | name, email, password rules list, confirm, plus workspace name                             | same     |
| node                       | URL, port, token with "Generate" (64 hex from the browser CSPRNG)                          | same     |
| progress                   | six sub-steps, live status, per-row durations, overall percentage, retry from failed step  | same     |
| admin/update               | licence card (step 1), release/health/migration ledger, informational process steps 2 to 5 | intended |

## Deliberate deviations (intended)

- **D1 Setup token.** Reference's installer is open to whoever reaches the URL first; ours needs the deploy-time `SETUP_TOKEN`
  (a hosted multi-tenant platform cannot be claimed by a stranger). Welcome screen asks for it.
- **D2 Database and node settings are deploy-time.** The wizard collects and tests the values (TW-INST-005, -006, -009) but the
  app never writes `.env` (TW-INST-011, -016). The test connection is token-gated and read-only (tries the typed host, then 127.0.0.1, then localhost, as Reference does).
- **D3 Licence.** Envato verification (TW-INST-003, -017, -020) runs only when `LICENCE_MODE` is on; default off, because our
  product is not sold on CodeCanyon.
- **D4 Updater is read-only.** See "Not ported on purpose".

## Not ported on purpose

| TW id                                   | Reason                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 011, 016 write `.env` / `node/.env`     | Containers take configuration from the deploy environment, validated at boot; an app that rewrites its own env file has no meaning (and is a risk).   |
| 018, 028 hosting and update docs        | Docs-only in the inventory; `docs/api/install-update-licensing.md` states the deploy-time contract instead.                                           |
| 021 backup (code ZIP + database dump)   | Replaced by image tags and `pg_dump` / PITR on the database host; the container has neither a writable code tree nor `pg_dump`.                       |
| 022, 023 upload and apply update ZIP    | A browser-driven overwrite of application files cannot work on an immutable image. Release = new image.                                               |
| 024 run new migrations from the browser | Done by the migrator (`pnpm db:migrate`, checksum runner); the System page reports pending/modified/missing migrations read-only (TW-INST-025, -027). |
| 026 rollback and backup list            | No backups exist to list (021); forward-only migrations are a repo rule. Rollback is redeploying the previous image.                                  |

These are listed in `featuresNotStarted` of the round report with this reason; none is a missed feature, but all are a
conscious departure from "same behaviour". **Approved by the project owner on 2026-10-04**: the updater stays read-only
(release info, health, migration ledger); a release ships as a new image and a rollback redeploys the previous image.

## Test evidence

- `apps/api/test/unit/install-update-licensing/*` (50), `test/e2e/install-update-licensing/*` (53, HTTP incl. licence, run order,
  idempotency, demo guard), `test/integration/install-update-licensing/setup-schema.spec.ts` (RLS, claim race).
- `apps/web/src/features/install-update-licensing/**/*.test.ts` (32).

## Verification (round 2 re-run)

tier P0 done: TW-INST-008, 012, 013, 014, 015. tier P1 done: 001, 004, 005, 006, 007, 009, 010, 027, 029 (011 not ported on purpose).
tier P2 done: 002, 003, 016 (not ported, see above), 017, 019, 020, 025. Re-run on a freshly migrated `crm_inst`: API unit 50, API e2e + integration 66,
web 32, all green; `pnpm arch:check` and `pnpm db:verify-schema` show 0 errors. Typecheck failures in `chat-conversations` and
`auth-registration-security` specs belong to other domains (upstream).

## Round 3 re-check

Fresh `crm_inst` migrated (212 migrations). API unit 50, API e2e 53, integration 13, web 32 all green; `db:verify-schema` 0 errors;
`arch:check` reports 7 errors, all in `chat-conversations` / `flow-runtime-engine` (other domains, none in this zone).
Tiers P0, P1, P2 stay as recorded above. The nine features without code (011, 016, 018, 021, 022, 023, 024, 026, 028) remain
"not ported on purpose" with the reasons in the table: each writes files into a PHP tree, shells out to composer/artisan/mysqldump,
or is docs-only. A live pixel comparison of the installer and update screens was still not run (the installed reference redirects
`/install` away, and only `/admin/update` could be compared).
