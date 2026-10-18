# Legacy Geta migration

**Status: Phase 1 is built and tested against invented data (see "Phase 1" below). Stage 2 roles and users are built (see "Stage 2: roles and users"), and so are the chat history = inbox step (see "Stage 2: inbox") and the broadcast campaigns + recipient logs (see "Stage 2: broadcasts") and the credits (see "Stage 2: credits": token counters, a wallet ledger anchored to a confirmed balance, billing-log usage charges, and the operator command `pricing-seed`); simple flows and chatbot widgets are built (see "Stage 2: flows and chatbot widgets"); advanced automations are built (see "Stage 2: advanced automations"); the rest of phase 2 (segments) is not.** The source is now the Waboo MongoDB databases (pilot clients `iskm` and `karma`); the Python tree
below is the older description of the same product.

## What we are migrating from

A Python/uWSGI application:

```
geta-core/src/Resource/ContactModule/
  SubmitContacts.py          the exposed write API
  ContactProperties.py       custom field definitions
  LifecycleStages.py         funnel stages
  ContactDetails.py, ContactList.py, ContactTags.py, FieldHistory.py
geta-core/src/Chatbot/
  Conversations.py, Inbox.py, LiveAgents.py, Chatbots.py, CannedResponse.py
```

## Agreed scope

| Data               | Approach                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contacts           | **Full.** `contacts.legacy_id` holds the source id                                                                                                      |
| Contact properties | Mapped into `data` JSONB via a field mapping                                                                                                            |
| Lifecycle stages   | Mapped to `lifecycle_stage` with an explicit value map                                                                                                  |
| Chat history       | **~90% best effort.** Raw export archived to S3 first                                                                                                   |
| Conversations      | Rebuilt as one thread per contact per channel                                                                                                           |
| Automations        | Team decision: simple flows -> chatbot flows, advanced -> automation, both MIGRATE_LATER (stage 2, latest version only); manager to confirm automations |
| Users / roles      | Recreated. Passwords cannot migrate (different hash scheme)                                                                                             |

The 10% chat-history gap was accepted in the requirements discussion because
the underlying chat data is unstable. It is only acceptable **because the raw
export is archived** — the data still exists, it is just not indexed in the new
system.

## Layout

```
tools/migration/
  README.md          this file
  cli.ts             coverage | manifest | init | run | reconcile
  registry/          every Waboo collection -> MIGRATE | MIGRATE_LATER | EXCLUDE | GAP, target tables, reason, handler
  extract/           source adapters (NDJSON directory; MongoSource is a documented stub), manifest (count + sha256), coverage
  transform/         Waboo document -> target rows, one handler per step, each with an explicit field map
  inbox/             stage 2 chat history: channel-map.json parsing, turn parser, peer key rules, the plan of pass 1
  flows/             stage 2 flows and widgets: the vendored web converter (wabo-convert.ts), the switches, the plan of pass 1, the widget and FAQ rules
  broadcast/         stage 2 broadcasts: the switches, the pure rules (status, schedule, error code), the plan of pass 1 (campaign counters)
  credits/           stage 2 credits: decimal helpers (money is text), the opening-balance file, the rules, the plan of pass 1 (every wallet posting with its balance_after)
  pricing/           the operator command pricing-seed (credits_mapping_new -> the GLOBAL message_rates; dry run by default)
  proposals/         SQL TEXT awaiting a manager's approval (never applied by the tool, never in packages/db)
  load/              batched raw SQL inside withTenant(orgId); migration.id_map / quarantine / run_log; org creation
  reconcile/         the verifier (separate command): equation, field coverage, fingerprints, integrity, NOT PRESENT section
  test/              vitest, invented fixtures for two fake clients, scratch Postgres
  dumps/             gitignored — never commit customer data
  out/               gitignored — reports
```

## Sequence

1. **Archive first.** Full raw export to S3, verified, before anything is
   transformed. This is what makes the 10% acceptable.
2. **Dry run** into a scratch database. Produce the reconciliation report.
3. **Review the skips.** Every skipped row gets a reason. "Unknown" is not a
   reason.
4. **Cutover.** Freeze legacy writes, run the final delta, switch clients.
5. **Keep legacy readable** (not writable) for an agreed period.

## Non-negotiables

- `dumps/` and `out/` are gitignored. Customer data never enters git.
- Loads are **idempotent**. A re-run must be safe, because there will be re-runs. Phase 1 uses `ON CONFLICT DO NOTHING` on the
  deterministic row uuid (uuid v5 of client + collection + source key; every tenant table has a unique key on `(org_id, uuid)`),
  plus `contacts (org_id, legacy_id)`. It never overwrites, so a re-run cannot clobber the preserved `created_at`/`updated_at`
  (`touch_row()` resets `updated_at` on every UPDATE). A delta load that updates changed rows is future work. This replaces the
  earlier plan of `ON CONFLICT (org_id, legacy_id) DO UPDATE`.
- Loads run as `crm_worker_user` (`TARGET_DATABASE_URL`) inside `withTenant(orgId)`, so a wrong `org_id` fails RLS instead of
  silently writing across tenants. This replaces the earlier plan of running as the owner in privileged mode. The owner connection
  (`MIGRATION_DATABASE_URL`) is used only for `init` (the tool's own `migration` schema) and to create the organization, the way
  `provisionOrganization` does.
- The reconciliation report is produced **before** cutover, not after.
- Flows and automations are NOT migrated in phase 1. Team decision: simple flows go to the chatbot flows and advanced ones to automation
  (crm-platform has ONE `flows` table, so this is a flag on it), latest version only, both `MIGRATE_LATER` (stage 2). The earlier plan to
  rebuild automations by hand stands until the manager confirms that automations are in scope. An automation that misfires sends real
  messages to real people, so definitions are never loaded without a review.

## Open questions (current)

- [ ] WhatsApp re-authorisation of the migrated numbers (P1: nothing sends until the channels are re-connected; `chatbot_misc_config` is HIGH RISK).
- [ ] RAG / AI knowledge-base sources (`document_col`): no table, no team decision, ask the manager.
- [ ] Contacts status / stage mapping: which `contact_lifecycle_stages` rows are stages and which are statuses needs manager confirmation.
- [ ] Plan and permission parity: which plan the migrated organizations start on, and the Waboo-permission to crm-platform-key map for `roles`.
- [ ] "Certain number fields": some Waboo number properties may need a different type than `decimal`; confirm on the real field list.
- [ ] `openchat_logs` (undecided, not migrated, reported on every run).
- [ ] `file_manager` target: no file-library table, and the files must be copied; where do they go?
- [x] `leadrepo`, `leads`, `contact_attribution`: decided, see "Stage 2: lead data" (the leadrepo / leads shapes are still UNVERIFIED: not yet exported).
- [ ] Owner sign-in end to end (NULL password, no `auth_subject`, `--owner-verified`) against a running app: never tested.
- [ ] Automations in scope? (manager to confirm; built and loaded INACTIVE, see "Stage 2: advanced automations").
- [ ] Chat history: how much matters, and is there a stable conversation identifier? Write-freeze window and how long the legacy system stays readable.

---

# Phase 1

## Phase 1 status

Built and tested on invented data (two fake clients that mirror the pilot quirks). **Not yet run against a real dump.**

| Step              | Source collection(s)                                                                                               | Target                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| org               | none: `--org-name`, `--org-slug`, `--org-plan`                                                                     | `organizations` + `org_plan_state` + `provision_workspace_presets()` (5 preset roles) + a default `workspace_settings` row. Optional owner user, see below. `project`, `project_configuration`, `workspace_settings` are NOT imported |
| fields            | `contact_properties_fields` (+ `_field_options`, `_field_dependancy_mapping`, `_field_options_dependancy_mapping`) | `field_sections`, `fields`, `field_options`, `field_dependencies`, `field_option_dependencies` (module `contacts`). Credential-named properties are excluded                                                                          |
| undeclared fields | keys on contact documents with no definition                                                                       | `fields` (text, `config.legacy.undeclared = true`) so every `contacts.data` key has a field row                                                                                                                                       |
| lifecycle         | `contact_lifecycle_stages`                                                                                         | `status_options` (`lifecycle_stage` group for stages, `status` group for open / closed_won / closed_lost, scoped to its stage)                                                                                                        |
| tags              | `contact_tag`                                                                                                      | `tags`                                                                                                                                                                                                                                |
| contacts          | `contact_list`                                                                                                     | `contacts`: `legacy_id` = Mongo `_id` hex, E.164 phone, lowercase email, resolved lifecycle and subscription, custom keys in `data`, original timestamps, `CON-00001` display ids, `sequence_counters` set to the max                 |
| groups            | `marketing_list`, `contact_list.marketing_list`                                                                    | `contact_groups`, `contact_group_members`                                                                                                                                                                                             |
| notes             | `contact_notes`                                                                                                    | `contact_notes`                                                                                                                                                                                                                       |

`broadcast_templates` are NOT migrated (templates are re-synced from Meta). Broadcasts reference templates, so a later broadcast load needs a
template re-sync plan first (match by name + language, or by `meta_template_id`).

Rules the loader follows: no `event_outbox` rows, no notifications, no audit rows; `created_at`/`updated_at` set explicitly (a document with
no usable date at all gets the dump manifest time and a `NO_DATE` flag, never 1970); soft-deleted documents (`is_deleted` as `true` / `1` /
`"yes"`, or a `deleted_time` that is set) are excluded and counted with a reason; invalid values never crash the run, they go to
`migration.quarantine` with a `reason_code`; a document with `__x__error_reason` / `__x__unverified_value` keys still loads, and the raw
rejected values are kept only in quarantine (they can be bad PII). Every document registers its ObjectId `_id` and, unless another document
already owns that key, its string `id` in `migration.id_map`, so references by either resolve; a clash is quarantined as `KEY_COLLISION`
(both documents load) and a repeated primary key as `DUPLICATE_KEY`.

### The organization and its owner

The team supplies the organization, it is not derived from Waboo's `project`. `--org-name` and `--org-slug` default to the client key;
`--org-plan` is optional (the plan slug, default `starter`). The slug is normalised to the login schema (2..40 of `a-z0-9-`), a taken slug
gets a suffix, and the whole slug including the suffix stays within 40 characters. Creation is serialised by an advisory lock and the
organization has a deterministic uuid, so a re-run (or two runs at once) finds the same organization.

`--owner-email` / `--owner-name` create the first user the way the app does (`TenantDirectory.provisionOrganization` makes the first user the
Owner; `MembersRepository.insertPending` is the invited-user shape): a `users` row with `status = 'active'`, `invited_at = now()`,
`joined_at = NULL`, **no password** (`password_hash` NULL; the app uses an unusable random hash, NULL is the same for sign-in purposes), the
`Owner` preset role in `user_roles`, a `user_security` and `user_profiles` row, and `organizations.settings.ownerUserId`. No email is sent and no
invite token is issued. `auth_subject` is left NULL: the app links an account to its Clerk id on the owner's first sign-in with that email
(`auth.service.ts`), so a Clerk id is not required. **TODO(owner):** if sign-in is not by Clerk, issue an invite/reset token through the app.
Without an owner option the run prints `WARNING: THE ORGANIZATION HAS NO OWNER` and the reconcile report repeats it.

### Lifecycle default

A contact with no lifecycle stage, or one that cannot be resolved (`UNRESOLVED_LIFECYCLE` is quarantined), gets what the app gives a contact
created without a stage: the workspace's default, active `lifecycle_stage` status option (`ContactsRepository.defaultOptionValue`), and only
when no option is marked default the column default `new`. The default option comes from the `default` flag of `contact_lifecycle_stages`.

## Run it

Environment:

| Variable                 | Used by            | Meaning                                                                                                                    |
| ------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE_DUMPS_DIR`       | all                | folder with `<client>/<collection>.ndjson` (MongoDB Extended JSON, one document per line). Default `tools/migration/dumps` |
| `TARGET_DATABASE_URL`    | `run`, `reconcile` | the **worker** login (`crm_worker_user`); every tenant write and read goes through it                                      |
| `MIGRATION_DATABASE_URL` | `init`, `run`      | the **owner** login; creates the `migration` schema and the organization only                                              |

The tool is not in the pnpm workspace. Run it from `tools/migration/` with `drizzle-orm`, `tsx`, `typescript` and `vitest`
resolvable. In this checkout they are junctions in the untracked `tools/migration/node_modules` that point at the workspace copies;
`@crm/db` code is imported by relative path (`packages/db/src/client.ts`, `tenant.ts`) and so is the phone canonicaliser
(`packages/contracts/src/contacts-attributes-tags/phone.ts`), so there is one implementation of each.

```bash
CLI="node node_modules/tsx/dist/cli.mjs cli.ts"
$CLI manifest  --all                     # fixes counts, bad lines and sha256 of the dump; do this once per dump
$CLI coverage  --client iskm             # every collection vs the registry; exit 1 on UNKNOWN
$CLI init                                # once per target database (owner), idempotent
$CLI run       --client iskm --dry-run   # full transform + validation, ROLLBACK at the end, prints the plan
$CLI run       --client iskm --org-name "ISKM" --org-slug iskm --org-plan growth --owner-email a@b.c --owner-name "A B"
$CLI reconcile --client iskm --out out   # writes out/<client>/reconcile.{json,md}; exit 1 on any alarm
```

| Flag                                       | Command            | Meaning                                                                           |
| ------------------------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| `--org-name` / `--org-slug` / `--org-plan` | `run`              | the organization to create or reuse (defaults: client key, client key, `starter`) |
| `--owner-email` / `--owner-name`           | `run`              | create the Owner user as described above                                          |
| `--dry-run`                                | `run`              | everything in one transaction, rolled back                                        |
| `--batch N`, `--force`                     | `run`              | rows per transaction (default 1000); ignore checkpoints and re-read everything    |
| `--skip-hash`                              | `run`, `reconcile` | do not compare the dump with `manifest.json` (never for a real run)               |
| `--default-cc 91`                          | `run`, `reconcile` | country code for national numbers that carry none                                 |
| `--allow-target-host H[,H]`                | all                | accept a database host that is not localhost / 127.0.0.1 / a docker-internal name |
| `--confirm-db-name=<name>`                 | `run`              | the exact database name, required to WRITE to any non-local host                  |
| `--allow-extra-rows`                       | `reconcile`        | rows added to the target after cutover are not an error                           |
| `--allow-docker-host N[,N]`                | all                | accept this docker-compose service name as local                                  |
| `--timezone ZONE`                          | `run`              | IANA zone for `organizations.settings.timezone` (business hours, SLA, quiet hours read it) |
| `--owner-verified` / `--trial-days N`      | `run`              | mark the owner's email verified / start a trial on a free plan                    |
| `--lock-wait-seconds N`                    | `run`              | how long to wait for another run of the same client (default 120)                 |

Before anything is written `run` prints `target: host=... port=... db=... role=...`. It refuses a non-local host without
`--allow-target-host`, and a real write to one without `--confirm-db-name`. It also refuses to start when a collection is not in the registry,
when the dump no longer matches `manifest.json`, when the `migration` schema is missing, and it holds a per-client advisory lock so two runs
of the same client cannot overlap (the second waits, then finds everything done). It resumes from `migration.run_log` after a crash.
Lines of a dump that are not valid JSON (a truncated last line) are quarantined as `PARSE_ERROR` with their file and line number, the rest
is loaded, and the run then exits with an error.

## Runbook for the server run

1. Archive: raw export of every client database to S3, verified (sequence step 1). Produce NDJSON in canonical Extended JSON (for
   example `mongoexport --jsonFormat=canonical`), one folder per client under `SOURCE_DUMPS_DIR`.
2. `manifest --all`, then `coverage --all`. Resolve every `UNKNOWN` by adding it to `registry/index.ts` (decide MIGRATE / EXCLUDE / GAP / OPEN).
3. Work on a snapshot or scratch restore of the target first. `init`.
4. `run --client X --dry-run` for each client. Read the plan: quarantined and soft-issue counts must be explainable.
5. `run --client X` with the org flags and an owner, then `reconcile --client X`. Exit code 0 is required. Read `reconcile.md`: the non-migrated
   key list, the field-level issues and the NOT PRESENT section.
6. Review quarantine: `SELECT reason_code, count(*) FROM migration.quarantine WHERE source_client = 'X' GROUP BY 1;` Fix at source or
   accept per code. Marking rows `resolved = true` changes the table, and reconcile compares it with the per-row digest recorded at the end of
   the last `run` (`QUARANTINE_CHANGED`): after a deliberate review, re-run `run` (it loads nothing new) to record the new state.
7. Cutover per the sequence above. A final delta is a re-dump (new `manifest`) and a re-run: unchanged documents are skipped and new ones are
   inserted; changed documents are NOT updated (phase 1 never overwrites). Run `reconcile --allow-extra-rows` once the app takes writes.
8. Pass `--default-cc <digits>` when contacts carry national numbers without a country code (for example `91`); without it such
   numbers are quarantined as `INVALID_PHONE` rather than guessed. A phone with letters or an extension ("ext 12", "x4") is never guessed at.

Measured on invented data on a laptop (33,009 contacts, 11,000 group members, every row and column compared): `run` took about 81 s and `reconcile` about 8.5 s.

## What the verifier proves

`reconcile` is a separate command and does not trust the loader's counters. Per client and collection it recomputes, from the dump and
`migration.*`:

- read (from the manifest, hashes re-checked) = migrated + quarantined + excluded, and `unaccounted` must be 0;
- every non-migrated source key with its reason, and every quarantine row is re-derived from the source (a quarantine row the source does not
  justify is `FALSE_QUARANTINE`; one that points at nothing is `QUARANTINE_ORPHAN`);
- every field seen in the source is mapped or in the explicit dropped list (else ALARM); custom contact keys must have a `fields` row;
- EVERY column the loader writes is compared source vs target for every row (contacts.data as a whole included), and the columns it does not
  write must still hold their defaults (`is_archived`, `owner_id`, `company_id`, `won_at`, `lost_at`, `color`, `row_version = 1`, ...); only a
  collection above 250,000 documents is sampled (seeded);
- an INDEPENDENT oracle (`reconcile/oracle.ts`, imports nothing from `transform/`) recomputes phone, email, name, lifecycle, normalized
  columns and dates of every contact; a bug in the loader's transform makes reconcile fail;
- extra rows: a row in a migrated table that no source document accounts for is `EXTRA_ROWS`. Every OTHER org-scoped table (roles, every
  role grant, users, plan state, pipelines, outbox, audit, notifications, identities, templates ...) is held to a per-row digest
  (`load/baseline.ts`) recorded when the organization is created: a changed, deleted or added row is `BASELINE_CHANGED` / `EXTRA_ROWS`;
- `migration.id_map` must equal the expected mapping both ways (bogus key, swapped target, missing alias), `migration.quarantine` must equal the
  per-row digest recorded at the end of the last run, display ids must follow the allocator (no swaps), timestamps are compared to the
  microsecond, and no migrated legacy id may sit in another organization (`LEAKED_ROWS`);
- group membership and both dependency tables are recomputed independently from the source (`reconcile/oracle.ts`);
- organization state (slug, name, plan, status, settings, `org_plan_state`, `workspace_settings`, preset roles, the owner) against what the
  tool recorded, display ids (format, unique, none missing) and `sequence_counters >= max imported display id`;
- referential integrity, run inside the tenant (RLS) context so a row in another org is invisible;
- the NOT PRESENT IN WADESK section.

Reports never print a raw phone, email or name: values are masked to their last two characters and the source key plus field name is given.
Credential-looking key names are never printed either.

Exit code is nonzero if unaccounted > 0, any alarm fires, or integrity fails.

## Secrets (current rules)

One shared function (`scrub` / `isSecretEntry` / `isSecretName` in `util.ts`) is used for `contacts.data`, `fields` (names and `config`) and
quarantine documents; reports list only key NAMES. A name is split into words (snake, kebab, camel case): `key`, `token`, `secret`, `password`,
`passwd`, `pwd`, `auth` + key, `bearer`, `credential`, `apikey`, `oauth`, `private` + key mark it, and all-lowercase compounds (`authtoken`) too;
`key_account`, `primary_key`, `private_notes`, `auth_status`, `keyword`, `author` do not. A marked key is dropped when its value is a string,
object or array, and kept when it is a number or boolean (`tokens_used`, `input_tokens`, `*_token_price`, `token_count`, `token_usage`) unless the
name is on the always-secret list. Values shaped like vendor keys, JWTs, bearer tokens or PEM blocks are dropped under any name. A long opaque
string is dropped under a name that contains a credential WORD (`session_key`), never by substring (`author_id`, `passport_photo`, `monkey_id`
are kept). Metadata about a credential (`password_changed_at`, `token_expiry`, `password_hint`) is kept when its value is a short plain string;
a `password_hint` is a hint a person typed, so decide with the client whether hints may hold the password itself. A property definition
named like a credential is excluded (`SECRET_FIELD`, an unverified guess).

## Tests

```bash
cd tools/migration
# either point at a Postgres superuser URL you own ...
MIGRATION_TEST_ADMIN_URL=postgres://crm:crm@localhost:5432/postgres node node_modules/vitest/vitest.mjs run
# ... or leave it unset: the global setup runs `docker run pgvector/pgvector:pg16` as crm-migtool-test-<pid>-<n> on a free port and removes it
node node_modules/vitest/vitest.mjs run
```

Both create one template database, apply the repo's migrations to it, and clone it per test. Set `MIGRATION_TEST_REUSE_TEMPLATE=1`
to skip re-migrating the template between runs on a server you keep. Check free disk space first: the suite starts a container and
clones databases. Lint and format, from the repo root:
`node node_modules/eslint/bin/eslint.js tools/migration` and `node node_modules/prettier/bin/prettier.cjs --check tools/migration`.

## What is NOT migrated in phase 1, and why

**Not imported as data (EXCLUDE):** `project`, `project_configuration`, `workspace_settings` (the organization comes from the flags),
`broadcast_templates` (re-synced from Meta; a later broadcast load needs a template re-sync plan), `credits_mapping`, `credits_expenses`,
`entry_points`, `source_registry`, `medium_registry`, `company_properties_*` (4), `deals`, `deal_pipelines`, `deal_properties`, `auth_logs`,
`available_permissions` (read-only input of `permission-catalogue`), `shapes`, `journey` (legacy duplicate of `bot_workspace`; cross-check only), `node_execution_history`,
`field_history` (2.4M rows on karma; product decision pending), `import_*`, `export_history`, `meta_callbacks*`, `openchat_logs`,
`webhook_logs`, `chathistory_view`, `contact_attribution_audit_log`, `contact_list_dummy` (confirm it really is a test copy),
`system.profile`, `temp_*`, `*_bak` / `*_bkp` / `*_backup`.

**Undecided (OPEN, reported on every run):** `openchat_logs` only (the lead collections are decided, see "Stage 2: lead data").

**No table in crm-platform (GAP):** `company_saved_views` (`contact_views` has no module column), `contact_task_config`,
`sms_broadcasting_data`, `email_broadcasting_data` (no SMS or email broadcast tables), `document_col` (AI knowledge-base sources),
`automation_version`, `automation_node_version` (version history).

**Phase 2 (MIGRATE_LATER, handler `todo`):** `visitor_logs`, `visitor_logs_view`,
`file_manager` (no table, and the files must be copied), flows
(`flows`, `flows_version`, `bot_flow_version`, `bot_flow_version_data`, `bot_workspace`: latest version only; simple flows to the chatbot flows,
advanced to automation; crm-platform has ONE `flows` table, so this is a flag on it), `whatsapp_flow`, `faq_variations`, `segments`,
`contact_saved_views`, `webhooks`, `api_library`, `attachments`, `contact_files`, `chatlabels`, `chatbots` and
`chatbot_*`. **`chatbot_misc_config` is HIGH RISK:** it holds the WhatsApp token, phone-number id and WABA id plus Google OAuth and OpenAI
keys; its target is the channel tables (`channels` / `wa_provider_configs`), NOT `chatbot_widgets`, and the secrets may only go through the
app's encrypted-credential path.

**Source fields of migrated collections with no target column (dropped; every report lists them with counts):** soft-delete flags;
`created_by` / `updated_by` / author names on notes, groups and field definitions (Waboo users are phase 2; `contact_owner` and `created_by`
on contacts are kept in `contacts.data` so phase 2 can resolve them); lifecycle `custom`; the pair id `field_dependancy_id` of option
dependencies; and every credential-looking key (never copied, never named).

**Also not migrated:** contact-to-tag links (no source field was found in the sampled contact documents), `contact_identities` rows (the app
falls back to `normalized_phone`), and any secret or credential value.

## Assumptions and unverified guesses (keep this list current)

- Rows of `contact_lifecycle_stages` with type `open` / `closed_won` / `closed_lost` are statuses, the rest are stages; a status with a parent
  stage becomes `status_options.stage_option_id`. **Unverified on a real dump.**
- Subscription statuses become the words the app uses (`subscribed` / `unsubscribed`; Yes/No and opt-in/out map to them); any other label
  becomes its slug. **Unverified.**
- A contact whose lifecycle stage cannot be resolved gets the workspace default stage and the raw value is quarantined.
- Waboo property definitions for built-in properties (`first_name` ...) also become `fields` rows, marked `is_system` when Waboo says so. Exception: Waboo's own web-analytics properties (`referrer`, `referrer_name`, `referrer_keyword`, `referrer_url`, `utm_medium`, `utm_campaign`, `utm_source`, `device_type`, `device_model`, `operating_system`, `operating_system_name`, `browser_version`, `browser_name`, `ip_continent`, `ip_country_region`, `ip_state_region`, `ip_city`, `channel`, `bot_name`, `module_type`, `module_name`, `platform`) are NOT `is_system`: WaDesk has no built-in place for them and a system field is hidden on the contact page, so they stay ordinary fields, and they are also NOT `is_read_only` (the contact Edit panel lists only editable fields, so Waboo's read-only flag would keep the UTM, referrer, device and IP fields out of it) (`source` stays system: it is the native `contacts.source` column). Their values stay in `contacts.data`. Likewise `created_time` and `modified_time` (Waboo's Created Time / Modified Time) are NOT `is_system` and are always `is_read_only`: the contact page shows them as read-only rows, their values are the contact's creation and last-change instants as ISO text in `contacts.data` (the same instants as `contacts.created_at` / `updated_at`).
  Check in the UI that built-in properties are not shown twice. **Unverified.**
- `contacts.channel` is left empty: Waboo `channel` ("WhatsApp", "API") is the capture channel, not the app's `channel` + `channel_uid`
  identity pair. It stays in `contacts.data.channel`.
- `country_code` is stored as `+<digits>`; the app's own form of this column was not confirmed.
- The owner user has no password (`NULL`); whether the app's sign-in treats `NULL` and its random unusable hash alike was not tested end to end.
- A `deleted_time` that is set marks a contact deleted even when `is_deleted` is false (the other collections already worked this way).
- The reconcile "extra rows" rule assumes the target organization is used only by this migration until cutover.
- Phase 1 never updates an existing row; a changed document in a later dump is not picked up.

## Second verification round: what changed

- **Guard.** The URL is parsed the way `pg` parses it (`pg-connection-string`). `?host=`, `?hostaddr=`, `?service=`, a host in `?options=`, an empty host
  (pg would fall back to `PGHOST` or a socket) and socket paths are refused. Only `localhost`, `127.0.0.0/8` (dotted quad) and `::1` are local;
  a docker-compose name is accepted only from the fixed list (`crm-postgres`, `crm-platform-postgres`, `host.docker.internal`; bare `postgres` and `db` are NOT on it)
  or when named with `--allow-docker-host <name>` (or `MIGRATION_ALLOW_DOCKER_HOSTS`). Any other host needs `--allow-target-host`, and a real write
  to it also `--confirm-db-name=<db>`.
- **Errors.** Every message printed by the CLI or logged by a run goes through `sanitizeError`: SQLSTATE, constraint, table and column names only,
  plus the batch's source keys. Driver text (SQL and bound parameters) is never printed. A lone UTF-16 surrogate quarantines that document
  (`LONE_SURROGATE`) like a NUL character.
- **Unique conflicts.** Two tags `VIP`, or lists `Friends` / `friends`, load once and quarantine the second as `UNIQUE_CONFLICT`; reconcile re-derives
  that from the source. A failing reconcile always prints at least one alarm line.
- **Scrub.** All-lowercase compounds (`authtoken`, `sessiontoken`, `bearertoken`, `pwd`) are caught; the plain CRM names `key_account`,
  `primary_key`, `private_notes`, `auth_status` are kept. Value-shaped secrets (`sk-...`, `sk_live_...`, `ghp_...`, `xox?-...`, `AKIA...`, `AIza...`,
  JWT, Bearer, Meta `EAA...`, PEM blocks) are dropped under any key name, including allow-listed ones; the same inside free text become `[redacted]`;
  `key=value` pairs with a credential name in free text are redacted; a string holding JSON is parsed and scrubbed. The report now lists the NAMES
  of dropped keys (never values) so a human can review them. **A property definition whose name looks like a credential is excluded
  (`SECRET_FIELD`) and is listed among the unverified guesses below.**
- **Phones.** With a country code the national number must have a length that country uses (table in `transform/contacts.ts` and, separately, in
  `reconcile/oracle.ts`): `"9812345680 12"`, `"98123456801"`, `"981234568012"`, `"1234567"` with `91` load without a phone (`INVALID_PHONE`).
  Unknown codes fall back to 8..15 digits in total.
- **Run lock.** A second real run of a client waits (`pg_try_advisory_lock`, default 120 s, `--lock-wait-seconds`) and then fails with
  `RunLockedError: another run is active for client X` (exit code 3). The holder renames its session every 2 s
  (`waboo-migration:<client>:<epoch>`); a holder of the same role, idle, silent for more than 15 s is a dead run and its session is terminated, so a
  resume after a SIGKILL does not wait for the old backend to time out. A dry run no longer holds the global org-create lock.
- **Plan and trial.** The plan follows the app (`pickDefaultPlan`): `--org-plan` if it exists and is active, else the first active plan flagged default,
  else the first free plan, else `starter`. A trial only starts on a free plan with `--trial-days N` (the app's `trialFor`). Default: no trial,
  billing cycle `monthly`.
- **Owner verification.** `user_security.email_verified_at` is NULL by default, which makes `TenantDirectory.orgsForVerifiedEmail` omit the owner from
  the workspace list at login. `--owner-verified` sets it to now. Choose consciously.
- **Reconcile coverage.** The organization's provisioning (roles, every role grant, users, user_security, user_profiles, org_plan_state,
  workspace_settings, pipelines and stages, sequence counters, the organization row) and every other org-scoped table (outbox, audit, notifications,
  identities, templates ...) are covered by a per-row digest recorded when the org is created and recomputed by reconcile
  (`load/baseline.ts`): a changed, deleted or added row is `BASELINE_CHANGED` / `EXTRA_ROWS`. A second organization with the same marker is an alarm.
  The ten non-contact tables have an independent oracle (`TableOracle` in `reconcile/oracle.ts`) for name / key normalisation, defaults, ordering
  and uniqueness. `field_dependencies.depends_on_option_id/value` are checked. `test/verify-extra2.spec.ts` mutates every column of every org table
  that has rows (266 mutations) and requires reconcile to notice each one.

## Unverified guesses added in round 2

- **`SECRET_FIELD`:** a contact property definition named like a credential is excluded and its values are never copied. Whether any real property of
  that kind should be kept as plain data is unknown.
- The owner's first sign-in against a running app was NOT tested (no `auth_subject`, NULL password, invited state, `--owner-verified` choice).
- National-number lengths per country are a small table; countries not in it fall back to 8..15 digits.
- Only keys that appear in the sampled data are known to the scrub: a differently named credential field would not be recognised by name (value
  shapes still are).

## Safety checklist before the first real dump

1. The dump directory (`SOURCE_DUMPS_DIR`) lives on an encrypted volume (BitLocker or an encrypted folder), never inside the repo and never in a
   synced folder (OneDrive, Dropbox, Google Drive). No cloud sync or backup of that directory.
2. Name the holders of the dump and of the scratch Postgres (people, not roles). Nobody else gets a copy.
3. Record the `manifest.json` hashes OUTSIDE the dump directory (a ticket or a signed note) so a changed dump is noticed later.
4. Treat `migration.quarantine` as sensitive: it holds raw rejected values (PII). `out/` reports are masked but internal only.
5. `dry-run` first, against a scratch database, then the real target with `--confirm-db-name`.
6. Afterwards: securely delete the dump, the `out/` folder and the scratch Postgres data (drop the database, remove the container WITH its
   volume: `docker rm -f -v <name>`), and delete the encrypted folder's key material if it was created for this job.
7. Nothing from the dump is pasted into tickets, chats or logs; run logs and reports contain keys and counts only.

---

# Stage 2: roles and users

Built and tested on invented data (`test/access.spec.ts`, 34 tests). **Not run against a real dump.** The pilot profiles are masked, so no real
Waboo permission key name is known: the permission map ships EMPTY on purpose and every migrated role starts with no grants until a person reviews it.

## Commands and flags

```bash
$CLI permission-catalogue --client iskm --out out   # read-only: lists the Waboo permissions access/permission-map.json does not map (names, ids, counts only)
$CLI run --client iskm --org-plan growth --owner-email a@b.c --owner-name "A B"   # roles + users now run BEFORE contacts
$CLI run --client iskm --allow-no-owner             # only if nobody needs to administer the org; refused by default when the dump has users
```

| File                                      | What                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access/permission-map.json`              | Waboo permission id/name -> crm-platform keys per action (`create/read/update/delete`, or `use`). Only `status: REVIEWED` + `reviewedBy` entries apply. `candidates` are UNREVIEWED hints |
| `access/role-map.json`                    | per client: Waboo role id -> `custom` (default) or `preset:manager/agent/viewer/workspace_admin` (approver + evidence required). `allowAdminClass` needs a custom role and an approver    |
| `access/admin-class.ts`, `policy.ts`      | the admin-class key list and the pure mapping algorithm                                                                                                                                   |
| `transform/roles.ts`, `users.ts`          | the two handlers; `transform/access-plan.ts` the cross-document plans (role names, winning email)                                                                                         |
| `load/access.ts`                          | permission catalogue and plan features read from the target, `roles_version` bump, seat check                                                                                             |
| `reconcile/oracle-access.ts`, `access.ts` | independent oracle (no import from `transform/` or `access/`) and the verifier                                                                                                            |

Order: org (+ owner) -> roles -> users -> fields ... -> contacts. `contacts.owner_id` is resolved through id_map at insert (`contact_owner` may be a string or an int; both
user keys `_id` and `user_id` are registered); no UPDATE, so the preserved timestamps stay. An owner that resolves to nobody is a soft `OWNER_UNRESOLVED`; the contact loads.
A dump with no `user` collection leaves `owner_id` empty and reports nothing.

## Safety rules

- **Fail closed.** A Waboo permission without a REVIEWED map entry grants nothing (`PERM_UNMAPPED`). Not-accessible permissions add nothing and never a deny. Unknown target keys
  (`PERM_KEY_UNKNOWN`), keys outside the org plan (`PERM_PLAN_LOCKED`, a plan-gap table is printed), keys of an app that is not installed, and admin-class keys
  (`PERM_ADMIN_CLASS_WITHHELD`) are dropped and reported.
- **No admin.** Only the `--owner-email` user holds Owner. `preset:admin` is refused at startup, with or without an approver; `preset:workspace_admin` and every other preset need
  `approvedBy` and `evidence`. `is_staff` and role NAMES are never privilege (a role called "Admin" becomes a custom role "Admin (Waboo)"). A user with a missing, null, non-string,
  unknown, deleted or unloaded role gets **Viewer** (`ROLE_MISSING`, `ROLE_DELETED`, `ROLE_NOT_LOADED`).
- **Users** are created like an invited member: `status` active (inactive only when `is_active` is false; `workspace_enabled` is history only, see OQ-7), `invited_at` = created, `joined_at` only when the email
  was verified, **no password hash, no auth_subject, no token, no mail, no outbox row**. Waboo `password` is never read, copied, quarantined or logged; reconcile searches the target
  for the dump's password strings (`PASSWORD_LEAK`). Emails are trimmed and lower-cased; two documents with one email: the active, then newest one wins, the other is `DUPLICATE_EMAIL`.
  Deleted users are excluded (`SOFT_DELETED`).
- **Owner rule.** If a Waboo user has the owner's email, the existing Owner row is kept untouched (role, name, status) and id_map points at it (`OWNER_ADOPTED`); no second row.
- `organizations.roles_version` is bumped once (RBAC cache key); no `user_roles` row is ever deleted; no `DELETE` exists in the loader.

## Interactive bot messages (read since the first real dump)

**Found on the real ISKM and Rhythm dumps (structure only).** A bot turn is `bot_response = {botid, type, subType, response: [element]}` with ONE element per document. `bot_response.type` (`Flow`, `FAQ`, ...) says
**where the reply came from**, not what it is; the elements are `{type:'text'|'info', value}`, `{type:'image'|'file', value:{fileName,text,type,url}}`, `{type:'share-location', value:{name,address,latitude,longitude,url}}` and
`{type:'whatsapp_interactive'|'interactive-button-url', interactive:{type:'button', header, body, footer, action:{buttons:[...]}}}`. ISKM: 2,617 of 7,223 bot turns are interactive (header `video` 1,478, `image` 770, none 369;
buttons `link` / `flow` / `mobile`); Rhythm: 1,435 of 3,391 (no header; buttons `flow` / `mobile` / `link` / `live_agent`). Before this change the parser never looked inside `interactive`, so those messages had no body and no media and the
inbox showed "Message unavailable".

**What is read now (loader `inbox/parse.ts` `readInteractive`, oracle `reconcile/oracle-chat.ts` `interactiveParts`, written separately):**

| Piece                                                                                                                | Where it goes                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header` of type `text` (`header.text`, string or `{text}`), then `body` (string or `{text}` / `{body}`), then `footer` | `messages.body`, joined with a newline, blank parts left out. Nothing is invented: no body when all three are blank                                                                                                                                                                                                  |
| `header` of type `image` / `video` / `document` with an http(s) `link` (also `header[type].link`, `header.url`)       | `meta.legacy.mediaUrl` (the first one of the turn). `media_key` stays NULL                                                                                                                                                                                                                                           |
| `header`, `action` (buttons: id / type / value; list sections / rows), the interactive `type`                         | `meta.legacy.interactive` (jsonSafe, scrubbed; an array when a turn has several). **Not** `meta.interactive`: the app reads that only for a customer's button / list REPLY (`message.mapper.ts` `interactiveOf`: `button_reply`, `list_reply`) and shows an interactive message by its body                          |
| `kind`                                                                                                               | the header file's kind (`image` / `video` / `document`) when the header has a file, and the text is its caption; `interactive` only when there is no header file. Always a value of `chk_messages_kind`                                                                                                                                           |
| `share-location` element                                                                                             | body = `name` and `address`; the maps `url` is NOT a file; `{latitude, longitude}` in `meta.legacy.location`                                                                                                                                                                                                         |
| `bot_response.type` = `Flow`, `FAQ`, `AI`, `Bot`, `Chatbot`, `Automation`, `Broadcast`, `Agent`, `Livechat`, `KB`     | origin labels: no `UNKNOWN_KIND`; the kind comes from the elements (interactive, then the first non-text element type, then the url extension, then text). Any other unknown type is still `UNKNOWN_KIND`                                                                                                              |

Unchanged on purpose: a turn is _empty_ by the same rule as before (an interactive element is a payload, so it was never `EMPTY_MESSAGE` and keeps its seq; measured: no duplicate `(session, message_id)` group involves an interactive turn on
either dump, so the duplicate rule and the plan fingerprint (state, code, thread, seq per document) do not move, and a re-run finds every document already in `migration.id_map` and creates nothing). The whole element stays in
`meta.legacy.response`. The conversation preview is `previewOf` of the last message's new body.
**Not read:** template elements (none in either dump), list `sections` as text (none in either dump; kept in `meta.legacy.interactive`), button titles as body text, the meaning of `live_agent` / `flow` buttons.

**Still unreadable after this change (element key sets, counts; from a structural survey of the two dumps).**

| Client | Element keys                                                                       | Before | After |
| ------ | ---------------------------------------------------------------------------------- | -----: | ----: |
| iskm   | `interactive,type`                                                                 |  2,617 |     0 |
| iskm   | `_id,createdAt,id,isUser,text,time,type,user,value` (text and value blank)         |      8 |     8 |
| rhythm | `interactive,type`                                                                 |  1,435 |     0 |
| rhythm | `type,value` (the `share-location` elements)                                       |      5 |     0 |
| rhythm | `_id,createdAt,id,isUser,message_id,session_id,text,time,type,user,value` (blank)  |      2 |     2 |

The ones left hold blank strings only; they stay a payload with no text (soft `NO_TEXT`) and `chat-reparse` leaves them alone.

**Where the image shows.** The inbox draws a file from `media_key` only. The header file is kept as `meta.legacy.mediaUrl`; `pilot/files/copy-files.cjs` selects exactly `COALESCE(meta->'legacy'->>'mediaUrl', media_key)` and then sets `media_key`, so the files copy picks the header links up unchanged. Because such a message has the file's kind (`image` / `video` / `document`) and its text as the caption, WaDesk shows image plus caption once the file is copied (before that it shows the caption). A message of kind `interactive` (no header file) is drawn as a text chip.

### Repair of chats that are already loaded: `chat-reparse`

```bash
node pilot/staging/cycle.cjs chat-reparse --client iskm            # dry run: counts only, nothing written
node pilot/staging/cycle.cjs chat-reparse --client iskm --apply    # writes (the wrapper passes --confirm-org-slug)
# direct: $CLI chat-reparse --client iskm --org-slug <slug> [--apply --confirm-org-slug <slug>]
```

It reads **only the database** (no dump, no Waboo). Rows: messages of the organization that this tool loaded (`migration.id_map`, collection `chathistory`), `direction = 'out'`, body NULL or blank, `meta.legacy.response` present, `media_key` NULL
and no `filesCopiedAt` (a file copied already is never touched). For each, the NEW parser runs on `{bot_response: meta.legacy.response}`; if it finds text or a file the row gets `body`, `kind` and `meta.legacy` (+ `mediaUrl`, `interactive`, `location`);
a payload with no text and no file is left alone and counted. Never touched: a row with a body, `created_at`, `seq`, `direction`, `sender_*`, `status`, `media_key`; no `event_outbox`, audit or notification row; `messages` has no touch trigger and no
`updated_at`, so the UPDATE is plain. User turns are not repaired (the user-turn parser did not change, and `legacy.query` does not hold the text). **Conversation:** only when the repaired message is the conversation's LAST message AND the stored
`preview` is still `previewOf(old kind, empty body)`, `preview` becomes `previewOf(new kind, new body)`; no counter depends on the body. `conversations` has a touch trigger, so that row gets `updated_at = now()` and `row_version + 1`; the uuids are
recorded in `migration.run_log` (`_chat` / `chat_reparse`) and `reconcile` does not flag `updated_at` / `row_version` for exactly those. One transaction per 100 conversations. Idempotent: a repaired row has a body; a media-only row recomputes
the same values and counts as unchanged. Output: counts, `kind old->new`, and the element key sets (keys only, never text) of what stays unreadable.
Follow-up for the images: `copy-files.cjs plan` then `copy` for the client (see its header); the header links are found under `meta.legacy.mediaUrl`.

## Update mode: bring rows that are already migrated in line with the current dump

`run` is insert-only (a document in `migration.id_map` is skipped), so what changed in Waboo after the first load (names, phones,
custom field values, owners, stages, field definitions, lists) never arrived and the verifier showed it as `ORACLE_MISMATCH`.
`update` fixes that for the steps that opt in (`HandlerSpec.update`): `contacts`, `field_sections`, `field_defs`, `field_options`,
`lifecycle`, `lifecycle_status`, `tags`, `groups`, `group_members`. Another step opts in with `update: {}` on its spec (it must write only
tables that have a uuid column; the matching is by the same deterministic uuid the loader used).

```bash
# staging: DRY RUN first (default), then --apply; needs the new dump on the server (export) and `init` once for the new column
node pilot/staging/cycle.cjs init   --client iskm          # idempotent: adds migration.id_map.written_version
node pilot/staging/cycle.cjs update --client iskm          # dry run: counts per table and per column, nothing written
node pilot/staging/cycle.cjs update --client iskm --apply  # writes; confirmation is passed as --confirm-org-slug <slug>
node pilot/staging/cycle.cjs update --client iskm --steps contacts,tags   # only some steps
node pilot/staging/cycle.cjs reconcile --client iskm       # then: ORACLE_MISMATCH for updated contacts is gone
# direct: $CLI update --client iskm --org-slug <slug> [--steps a,b] [--default-cc 91] [--batch 250] [--skip-hash] [--apply --confirm-org-slug <slug>]
```

Rules (load/update.ts):

1. For every source document whose id_map row exists, the transform output is compared column by column with the stored row
   (every column the step writes except `display_id`, read through the verifier's normalisation) and ONLY the changed columns are
   updated. Columns the migration does not write are never in the statement. Foreign keys (`owner_id`, `section_id`, ...) resolve
   through id_map as in a fresh load; custom field values are `contacts.data`, rebuilt by the same transform.
2. `updated_at` takes the source time (it is one of the compared columns). The tables' touch trigger would overwrite it with `now()`, so
   for the statements of a batch ONLY `trg_<table>_touch` is disabled (`ALTER TABLE ... DISABLE TRIGGER`, same transaction, re-enabled
   before the commit; the table is write-locked but readable for the batch) and `row_version` is bumped by hand (+ 1 per updated row).
   `contacts_normalize` keeps running. This needs the OWNER login (`MIGRATION_DATABASE_URL`). No `event_outbox`, `audit_log` or
   `contact_events` row is written: plain UPDATEs, like the rest of this tool.
3. LOCAL-EDIT RULE. A row is updated only while its `row_version` still equals the one this tool left on it
   (`migration.id_map.written_version`; NULL = never updated by the tool = the 1 the loader inserted). Anything else that updates the
   row (a user, the app, an import) bumps `row_version` through the touch trigger, so a different version means "edited in WaDesk since":
   the row is counted as `CONFLICT_LOCAL_EDIT` (the differing columns are counted per column under "left alone") and not touched. The
   UPDATE repeats the check (`WHERE row_version = ...`), so an edit racing the run is a conflict too. The rule is per ROW, not per
   column, and it is conservative: an edit of a column the migration does not own also blocks the row. A conflict stays a conflict on
   every run until someone decides (the verifier keeps showing it).
4. A document that is now soft-deleted / excluded / quarantined at the source, or no longer in the dump, is REPORTED (counted, keys
   listed, full list in `run_log` `_update` / `update:<step>`), never deleted. Exception: `group_members` removes a membership the contact
   no longer has in Waboo, only while the contact is still live and the membership row was never edited.
5. A row deleted in WaDesk since the load is counted (`row deleted in WaDesk`) and not re-created. A document not in id_map yet is
   counted (`new in the source`) and left for the normal `run`. A unique-key clash is rolled back to a savepoint and counted
   (`UNIQUE_CONFLICT`); the rest of the batch goes on.
6. A document with no usable date has the dump's `generatedAt` as its date, which moves with every export: for those `created_at` /
   `updated_at` are not compared. List memberships never rewrite their timestamps.
7. Idempotent: the second run changes 0 rows (conflicts are only counted again). The dry run prints the same counts as the apply and
   writes nothing. Output is counts and source keys, never values. The run takes the same per-client lock as `run`.
8. BROADCASTS (`campaigns`, `recipients`). The steps need the pass-1 plan, so `update` builds the same plan `run` builds, from the same dump, with the switches the run RECORDED (`run_log` `_bcast` / `options`, defaults when there is none), but writes nothing (the run's prepare hook also records options; update does not). A recipient's status and its step timestamps (`sent_at`, `delivered_at`, `read_at`, `responded_at`), error text and a campaign's status, counters, schedule and timestamps follow the dump, changed columns only. Never written: `retry_enabled` (campaign) and `retry_count` (recipient) are on the step's `update.ignore` list, and `next_attempt_at`, `retry_state`, `retry_next_at`, `retry_first_sent_at`, `retry_until` are not columns of these steps at all. `update.allow` refuses (counted `refused`) any change whose new status is not terminal for a campaign (completed / failed / cancelled) or not a delivery state for a recipient; a row that turns `failed` is written with its `send_attempts` (>= 3, the sweeper threshold) in the same statement. Campaigns that `campaign-link` already touched sit at `row_version` 2 by design; update mode counts that as untouched (not a local edit). The verifier's campaign check accepts the recorded `written_version` as `row_version` too. Because `retry_count` is not written, a changed Waboo `retry_count` stays visible as an `ORACLE_MISMATCH` on that column.
9. NOT updatable, on purpose: flows / widgets / automations (their plan derives documents and flow-state arms them), credits (immutable ledger, wallet-sync handles the balance, usage-charges-append the new charges and token rows), chat history (the plan creates channels and partitions; appending messages is a separate step). Selecting one with `--steps` is refused.
10. The verifier accepts `row_version` = the recorded `written_version` on a row the tool updated (any other version is a later edit and is
   an alarm, as before). Its independent oracle did not change: the expected final state is the same, `update` makes the target reach it.

## Contact files (`contact_files`, step `contact_files`)

A Waboo `contact_files` document is only the label of a file (`file_name`, `file_size` as a rounded display string, `file_type` as an extension, `uploaded_by` as a display name, `created_by` user id, `uploaded_at`, `downloads`, `is_deleted`); it has **no address**. The file is the `attachments` registry row with **the same `id`** (rhythm: 3 of 3 match; `source` = https address without a query, plus `directory_prefix`, `file_extension`, `file_size`). Both are read together. iskm has no contact files (its `attachments` rows are import logs, knowledge-base and message media with no target yet).

Loaded: `contact_id` (id_map; a deleted contact excludes `PARENT_EXCLUDED`, an unknown one quarantines `ORPHAN_CONTACT`), `file_name` (separators and control characters replaced; soft `FILE_NAME_CLEANED`), `storage_key` = the Waboo address (quarantined `NO_FILE_URL` when the registry has none), `file_size_bytes` only when the registry holds an exact integer, `uploaded_by` = the migrated `created_by` user (soft `UNRESOLVED_USER`), `created_at` = `uploaded_at`. `downloads`, the rounded size and the extension are dropped (no column / not exact). No outbox event, audit row or `last_activity` bump is written: this is history, not an upload.

`pilot/files/copy-files.cjs` then moves the bytes (bucket `S3_BUCKET_DOCUMENTS`) and rewrites `storage_key` to `contact-files/<org id>/waboo/<hash>/<lower-case name>`, setting `file_size_bytes` and `mime_type` from the object. What the app requires of a key (origin/main): `packages/contracts/src/crm/contact-file.ts` `safeStorageKey` (1..1000 characters, relative: no leading `/`, no backslash, no URL scheme, no `.` / `..` segment, no control character) and `apps/api/src/modules/crm/contact-files/contact-files.service.ts:73-75` (AZ-009: a key shaped `<area>/<digits>/...` must carry the caller's own workspace id, else 422). `contact-files/<org id>/...` is that per-workspace shape. The app has no reader of the file bytes for contact files yet. The verifier does not compare `storage_key` / `file_size_bytes` (the copy rewrites them); `copy-files.cjs verify` checks the objects.

## What reconcile covers now

Per-column compare of roles, users, profiles, security and role assignment against the independent oracle; exact grant sets of custom roles (missing, extra, over the Waboo ceiling,
admin-class without approver); extra-row checks (custom roles, grants, users); baseline digests now hold only what provisioning left (presets and their grants, the owner and its rows);
id_map for roles and users both ways (both user keys); the **NO-ADMIN invariant over every user** (anyone with Owner/Admin preset or an admin-class grant must be the owner or an approved
mapping; holders are listed in the report warnings); owner of every contact; `roles_version`; password scan of users, profiles, security, quarantine and run_log; seat warning against
`plans.limits.users`; the equation read = migrated + quarantined + excluded (an adopted document counts as migrated).

## Not migrated, and why

`menu_items` (old sidebar layout), `filter_query` / `mongodb_query` of the list configs (raw Mongo queries), `workspace_id`, `team_members` / `chat_limit` capacity (no team data; kept in
`users.settings.legacy.waboo`), `force_password_change` (left false), invite tokens and mails, `available_permissions` as data (only the catalogue command reads it), credits and pricing
(other builder).

## Unverified guesses (stage 2)

- The real Waboo permission keys are unknown; the map is empty. Every mapping, scope and the plan filter are untested on real data.
- Admin-class = `admin` category, `billing.* paygw.* admin.* org.* bsp.billing.* api.keys.* aiadm.keys.* partner.*` and a short list of explicit keys. The `billing` category alone is not
  (every preset holds the wallet read keys).
- Preset targets need an approver even for Manager/Agent/Viewer (stricter than the spec); the preset's own grants then apply, which can exceed what the Waboo role had.
- A plan flag nobody set is closed; a plan slug with no row leaves everything open (the app's rule). Keys of apps are always withheld (no installation exists yet).
- `joined_at` is set only for `is_email_verified` users (the spec also used the presence of a password; this tool never looks at one). `phone_verified_at` / `email_verified_at` use `modified_time`.
- `workspace_enabled: false` does NOT make a user inactive: in geta_core it is false for 2,251 of 2,882 active business users (OQ-7 answered).
- Record scope: `all`, or the map's `scope` where the key supports one (OQ-6).

## Open questions for the manager

OQ-6 do Waboo agents only see assigned chats/contacts (scope own/team)? OQ-7 Viewer or inactive for users with a missing/deleted role, and what `workspace_enabled=false` means.
OQ-8 which plan does each org get and does it cover what the roles use (run the plan-gap output before cutover). OQ-9 who reviews `permission-map.json` and `role-map.json`, and which
Waboo role (if any) is the workspace admin. OQ-10 is it acceptable that users start without a password (they use "Forgot password" on cutover day; nothing is sent).

---

# Stage 2: inbox (chat history)

**PROGRESS:** built and tested on invented data (`test/chat.spec.ts`). **Never run against a real dump**: the pilot profiles are masked, so the content shapes of `bot_response.response[]`
and friends are guesses (list below). Appending newer Waboo turns to a thread that was already migrated is built (see "Appending newer turns to a loaded thread"). No commit, no server, no Mongo was touched.

Team decision "chathistory = inbox". Collection `chathistory` only; `chathistory_view` is a derived copy and stays EXCLUDE. Broadcasts, credits, flows, `visitor_logs`
(phase 2) and `openchat_logs` (undecided) are not part of this step.

## The model

One `chathistory` document is ONE TURN (`bot_response` = outbound, `user_query_object` / `user_query` = inbound). The turns of a phone number become ONE conversation per
(channel, peer phone), never one per Waboo session (a person has many sessions: `session_id` stays on each message in `meta.legacy`). Messages are written the way the app's own
history import writes them (`inbound-ingest.service.ts` `store`, `conversations.repository.ts` `applyHistory`): `created_at` backdated to the turn, no unread, no wait, no events, no outbox.

| Target             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels`         | one `whatsapp_cloud` row per phone number id of the channel map: `status` disconnected, `external_id` = phone number id, `display_address`, **no credentials, no webhook token**, `settings {"metered": true, "legacy": {"waboo": {"client", "botids"}}}`. A channel that already exists for the number in this workspace is adopted untouched.                                                                                                                         |
| `conversations`    | one per (channel, peer). uuid = `uuidv5(client\|chat_thread\|whatsapp_cloud\|<phone number id>\|<peer>)`. Counters (`msg_seq`, `last_message_at/id`, `last_inbound_at`, `last_outbound_at`, `window_expires_at`, `preview`, `created_at`, `updated_at`, `status`, `resolved_at`) are computed BEFORE the insert; a new thread's row is never updated (`touch_row` would stamp `updated_at` and bump `row_version`). The one exception is an APPEND to a loaded thread (below). `unread_count` 0, `waiting_since` NULL, no SLA, no participants. |
| `messages`         | one per turn. `seq` = rank in the thread by `createdAt`, then `_id`; outbound is ALWAYS `sent` (a `queued` row would be RESENT by `QueuedMessageRecoveryService`), inbound `received`; `sender_kind` customer / bot / agent (`ctype=livechat`) / system (hand-over `fromAgent`/`toAgent`); media URLs only in `meta.legacy.mediaUrl` (`media_key` stays NULL: the files builder copies objects later).                                                                  |
| `message_ledger`   | one `provider_id` row per message that has a usable `meta_msg_id` (the first owner of an id; a repeat gets a soft `DUP_PROVIDER_ID`). The other messages get none.                                                                                                                                                                                                                                                                                                      |
| `migration.id_map` | `chathistory` key -> `messages` row, written in the same transaction as the rows.                                                                                                                                                                                                                                                                                                                                                                                       |

Monthly partitions of `messages` are created first, through `ensure_monthly_partition()` as the worker login for every month of [first, last] (the function is SECURITY DEFINER; the
tool checks `has_function_privilege` BEFORE it writes anything and stops with `INBOX_PARTITION_PRIVILEGE` if the login may not call it: it never falls back to owner rights).
Months are taken in the session's time zone (that is how the function reads its date argument).

## Commands and flags

```bash
$CLI run       --client iskm --channel-map /secure/iskm-channel-map.json --org-name ISKM --owner-email a@b.c       # inbox runs last
$CLI run       --client iskm --channel-map ... --dry-run                         # prints the plan (threads, per-reason counts), rolls everything back
$CLI reconcile --client iskm --channel-map ... --out out                         # same flags as the run (the options of the run are also recorded and compared)
```

| Flag                            | Default                             | Meaning                                                                                                                                                                |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--channel-map FILE`            | `<dumps>/<client>/channel-map.json` | the operator's non-secret map (below). A dump with chat and no map stops the run (and the dry run) BEFORE anything is written: `INBOX_CONFIG`                          |
| `--keep-deleted-contact-chats`  | off                                 | Q3: load the chats of contacts soft-deleted at the source, with `contact_id` NULL (soft `CONTACT_UNRESOLVED`), instead of excluding them (`CONTACT_DELETED_AT_SOURCE`) |
| `--thread-status waboo\|closed` | `waboo`                             | Q4: keep Waboo's Open/Closed, or import every thread closed                                                                                                            |
| `--no-assign-agents`            | assign                              | do not set `assignee_user_id` from the newest Waboo agent of the thread                                                                                                |
| `--window-hours N`              | 24                                  | WhatsApp customer-service window used for `window_expires_at`                                                                                                          |

### channel-map.json (written by hand; NEVER read from `chatbot_misc_config`)

```json
{
  "<waboo botid>": {
    "kind": "whatsapp_cloud",
    "externalId": "<WhatsApp phone number id, 5-32 digits>",
    "displayAddress": "+91 98xxx xxxxx",
    "name": "ISKM main"
  }
}
```

Only these four keys, only non-secret values: a key or value that looks like a credential (token, key, secret, a `EAA...` string) is refused. Several botids may name the same number
(they then share one channel and one thread per customer). `externalId` MUST be the phone number id the live WABA connection will report: `WabaChannelLinkService` adopts a channel by
(workspace, kind, external_id) and, if the number was released, by the digits of `display_address`, so both are written. A different id here gives every customer a second thread at
cutover (risk R1). The tool cannot check the id against Meta; two people should read it off the Meta business manager. A phone number id already held by ANOTHER workspace aborts the client
(`INBOX_CHANNEL_HELD`), it is not a per-row quarantine. A botid not in the map: every turn of that bot is quarantined `NO_CHANNEL`.

## Order and rules

1. Org (+ owner) -> roles -> users -> fields ... -> contacts -> ... -> **inbox** (last: it needs the contacts and users in `id_map`).
2. Cutover order (Q8): migrate the chats BEFORE the number receives live traffic in the new app (connect the number last, after the template sync). A thread that already exists in the target for
   the same number and was not created by this tool is a LIVE thread: all its documents are quarantined `THREAD_HAS_LIVE_MESSAGES`, nothing is merged. A thread with some of its messages mapped
   and some not aborts the run (`PARTIAL_THREAD`) unless the mapped ones are the START of the thread, which is an append (below).
3. Contact of a thread: newest turn first, `user.contact_id` then `context.contact_id`, through `id_map` (string id or ObjectId). A contact deleted at the source excludes the whole thread
   (Q3). Otherwise the single contact with that phone number is linked (soft `CONTACT_BY_PHONE`); several -> NULL, never guessed; none -> NULL (soft `CONTACT_UNRESOLVED`). No contact is ever created or updated.
4. Peer = the first of `user.mobile`, `context.visitor_phone`, `context.mobile_phone_number`, `user.user` that LOOKS like a phone number and that the app's `normalizePeerKey` accepts (a visitor id with a few digits is not a peer: `NO_PEER`).
   `inbox/peer.ts` is a copy of `peer-key.ts` / `message-rules.ts` (their `@crm/contracts` import cannot be resolved here); `test/chat.spec.ts` pins the behaviour and checks the app files still contain the constants it copied.
5. Duplicates: same session, message id and direction with the same content and time -> the later one is excluded `DUPLICATE_MESSAGE`; same ids but different content -> both kept (soft `DUP_ID_DIFFERENT_BODY`).
6. Quarantine codes: `NO_CHANNEL`, `NO_PEER`, `BAD_DATE` (unreadable, or outside the partition window: 10 years back to 1 year ahead of the dump), `EMPTY_MESSAGE`, `WEBCHAT_NO_CHANNEL` (Q6: `channel=website`),
   `UNSUPPORTED_CHANNEL`, `THREAD_HAS_LIVE_MESSAGES`, `APPEND_OUT_OF_ORDER` (below), plus the engine's `NUL_CHAR` / `LONE_SURROGATE`. Soft (the message still loads): `CONTACT_BY_PHONE`, `CONTACT_UNRESOLVED`, `UNRESOLVED_AGENT`, `NO_STATUS_CONV`,
   `UNKNOWN_KIND`, `SHAPE_UNEXPECTED`, `NO_TEXT`, `BOTH_DIRECTIONS`, `DUP_ID_DIFFERENT_BODY`, `DUP_PROVIDER_ID`.
7. **The seq rule (loader `inbox/plan.ts` and the independent oracle `reconcile/oracle-chat.ts` both follow it).** `seq` is 1, 2, 3 ... over the *stored messages* of a thread, in (time, document key) order. A turn takes a seq if and only if it becomes a message row: it is not quarantined (`EMPTY_MESSAGE` and the other codes), not excluded (`DUPLICATE_MESSAGE`, deleted contact) and the thread itself is loaded. One document is one turn is one message (a user query and a bot reply are two documents, never one). A turn is *empty* when it has no text (`TEXT_KEYS` string, a bare string, a number) and no http(s) url (`URL_KEYS`) anywhere in `bot_response.response[]` or in `user_query_object.value`; a `{url: null}`, a `{referral: {}}`, a value-less media type, or a contact card with only name/phones/vcard is empty and takes no seq. A payload that is not null or a blank string (a button list) is NOT empty (soft `NO_TEXT`). The oracle states this rule independently; when it truly cannot decide (text nested deeper than 3 levels) and the loader said `EMPTY_MESSAGE`, reconcile skips the seq comparison of that thread and warns UNVERIFIED, instead of raising one alarm per later turn. Test: `test/seq-rule.spec.ts`. (Found on the real ISKM load: 9 empty turns the oracle could not classify shifted its seq by +1 for 168 later turns; the loader was right.)
7. Engine changes this needed (all optional hooks, no behaviour change for the other steps): `HandlerSpec.prepare / loadOrder / group / afterInsert / fingerprint`, `TableSpec.windowCol / liveColumns`,
   `Source.readIndexed / readAt` (documents by byte position, so the load reads a thread's turns contiguously with flat memory). A batch closes only between threads; a thread bigger than `--batch` is one bigger batch.

## Appending newer turns to a loaded thread

A dump that is exported again later holds turns the first load did not have (ISKM 10,399 turns vs 9,432 loaded, Rhythm 5,629 vs 5,466). The same `run` / `--dry-run` appends them; there is no extra flag. Rules (planner `inbox/plan.ts`, loader `load/inbox.ts`, independent oracle `reconcile/oracle-chat.ts`):

1. **Which threads.** A thread is *ours* when its conversation exists under the uuid this tool derives. It is **new** (nothing mapped, no conversation: loaded whole as before), **done** (every surviving document mapped: nothing to do), **an append** (some mapped, the rest not, and the mapped ones are the first `k` documents of the thread in (`createdAt`, document key) order), **out of order** (the same, but a not-yet-loaded document sorts before a loaded one) or **partial** (anything else: mapped turns and no conversation, a conversation and nothing mapped, ...; aborts as `PARTIAL_THREAD`). "Mapped" means the document is in `migration.id_map`.
2. **Append.** Only the unmapped documents are inserted, through the same transform as a fresh load (interactive parsing, `meta.legacy.mediaUrl`, kinds, senders); their `seq` continues the thread (`k+1 ...`). In the same transaction (one batch per thread, a thread is never split) the conversation is **locked and checked** (`msg_seq`, the message count and `max(seq)` must all equal the `k` the plan counted, else `PARTIAL_THREAD` and nothing is written) and **updated once** to what the planner computes for the whole thread: `msg_seq`, `last_message_at`, `last_message_id` (id of the new last message), `preview`, `last_inbound_at`, `last_outbound_at`, `window_expires_at`, `status`, `resolved_at`, `peer_name`, `title`, `contact_id`, `assignee_user_id`, `routing_meta`. `created_at`, `peer_key`, `channel_id`, uuid and every column the loader never writes (`unread_count` 0, `waiting_since` NULL, SLA ...) are not touched.
3. **`updated_at` / `row_version` do move** for an appended conversation: `conversations` has a `touch_row` trigger and a login without owner rights cannot bypass it (same as `chat-reparse`). The uuids are recorded in `migration.run_log` `_chat` / `chat_append`, and reconcile expects exactly these to differ in those two columns and nowhere else. A conversation of a thread with nothing new is never updated.
4. **Out of order = untouched, counted, never guessed.** The thread, its messages and its conversation stay exactly as loaded; every not-yet-loaded document of that thread (also the ones that would have fitted at the end) is quarantined `APPEND_OUT_OF_ORDER` in `migration.quarantine` (counted in the equation `read = migrated + quarantined + excluded`). The run logs `WARNING: APPEND_OUT_OF_ORDER` with the thread uuids, and reconcile raises the alarm `APPEND_OUT_OF_ORDER` (the thread is not what a fresh load would make; fix by hand or drop that thread's rows and reload it).
5. **A stray row is damage, not news.** If a not-yet-loaded document of a loaded thread already exists as a message (its `id_map` row is gone), the run stops with `PARTIAL_THREAD` before it writes anything.
6. **Identity of the channel.** Threads are keyed by the phone number id of the **map** (`channel-map.json`), and so are their uuids. A channel is found by that id OR by the uuid this tool gave it, so it keeps working after the real WhatsApp number was connected and the row's `external_id` changed (the map must keep the id the threads were made under; changing `externalId` in the map re-keys every thread and quarantines them as `THREAD_HAS_LIVE_MESSAGES`). Before this rule, a map that still held the placeholder id could not find the channel at all and every loaded thread looked half loaded (ISKM 1,561 and Rhythm 1,520 `PARTIAL_THREAD`).
7. **Ledger.** A new turn whose provider id the `message_ledger` already owns (same channel) gets no ledger row (soft `DUP_PROVIDER_ID`); a loaded message keeps what it has.
8. **Idempotent.** After an append every document is mapped: a second run finds every thread done, inserts nothing, updates nothing, and adds nothing to `chat_append`. A dry run does everything inside one transaction and rolls it back.
9. **Provider id and sender.** `messages.provider_message_id` is written from `meta_msg_id` for every message this tool inserts (new threads and appends alike) when the document has a non-blank one (there is no unique key on it; uniqueness is `message_ledger`'s, whose row exists only for ids up to 512 characters). In both real dumps `meta_msg_id` is an empty string wherever it appears (ISKM 1,463 docs, Rhythm 88), so no message has one today. `messages.sender_user_id` is the migrated user the turn's `agent.id` names through `id_map` (a livechat out-turn), else NULL with a soft `UNRESOLVED_AGENT`. `messages.sender_agent_id` references `ai_agents` (a bot), not people: Waboo's `agent` is a human, so it stays NULL for every message.
10. **What reconcile says.** Before an append runs it reports one alarm `APPEND_PENDING: N loaded thread(s) lack M newer message(s)` instead of one alarm per message; after it, the state must equal what a fresh load makes (the oracle takes `id_map` as "loaded" and applies rules 1 and 4 to the dump independently). Tests: `test/chat-append.pure.spec.ts` (planner and oracle, no database) and the `append` block of `test/chat.spec.ts` (Docker).

### Repair of loaded conversations that have no contact: `chat-relink`

The loader never revisits a loaded conversation, so a thread loaded before its contact existed (or before its phone matched) kept `contact_id` NULL (staging: ISKM 695 of 1,578, Rhythm 61 of 1,573; by phone alone ISKM 281 have exactly one contact with the thread's digits, 2 have several, 412 none; Rhythm 59 / 0 / 2). Rule, the same as a fresh load and as the oracle: newest turn first, `user.contact_id` then `context.contact_id` through `id_map`; else the single contact with the thread's digits; several or none stay NULL (counted, never guessed).

```bash
$CLI chat-relink --client iskm --org-slug <slug> [--channel-map FILE]                              # DRY RUN: counts only
$CLI chat-relink --client iskm --org-slug <slug> --channel-map FILE --apply --confirm-org-slug <slug>
# staging: node pilot/staging/cycle.cjs chat-relink --client iskm [--apply]
```

- Sets `conversations.contact_id` ONLY where it is NULL and the planner resolves a contact now. A non-null link is never overwritten (counted "linked to another contact ... (left)" when the rules would pick another).
- Nothing else changes: `title`, `peer_name` and `preview` come from the turns (visitor name, last message), never from the contact, so a fresh load writes the same values already.
- `conversations` has the touch trigger: `updated_at` and `row_version` move for the linked rows only; the update and their uuids (`migration.run_log` `_chat` / `chat_relink`) are one transaction, and reconcile tolerates those two columns for exactly those uuids.
- Idempotent (a linked row is not picked again). Appends and fresh loads already use this rule (one planner), so only conversations loaded earlier need the command. Run it after the contacts are loaded, before reconcile. Test: `test/chat-relink.pure.spec.ts`.

## What reconcile covers now

`reconcile/oracle-chat.ts` is a second, simpler implementation (imports nothing from `transform/`, `inbox/` or `load/`) and `reconcile/chat.ts` checks, per client:

- the equation `chathistory` read = migrated + quarantined + excluded, a derived `chat_threads` row (oracle threads vs conversations found), quarantine digest, `id_map` exactness both ways (generic);
- oracle vs the loader's plan, document by document (loaded / excluded / quarantined, code, seq, time, ledger);
- every loaded message against the oracle: conversation (one per number, no split, no merge), channel, `seq`, direction, status (`received` / `sent` only), sender kind, `created_at` to the microsecond, provider id, body (md5);
  plus the generic per-column compare of every column the loader writes and the defaults of the ones it does not (`FINGERPRINT_MISMATCH`);
- every conversation column against the oracle (counters, window, status, resolved_at, contact, assignee, preview, `last_message_id` = id of the last message) and the defaults of the columns the loader never writes (unread 0, `waiting_since` NULL, SLA ...);
- SQL invariants per conversation: `msg_seq` = count = max(seq), min(seq) = 1, no gap, no duplicate, `last_message_at` = newest, `created_at` never goes backwards along `seq`, no empty thread;
- extra rows scoped to the organization: messages, conversations carrying the migration marker, ledger rows, channels with the marker, anything in `conversation_events` / `conversation_participants` / `conversation_notes` /
  `message_events` for migrated threads, and (baseline digest) any `event_outbox`, `notifications`, `usage_charges`, `wallet_transactions` ... row; nothing in `messages_default`; every month of the range has its partition;
- the channels the tool made (every column, no credential, uuid) and that an adopted channel exists; the ledger rows (key, message, thread, time);
- the append rules above: `APPEND_PENDING`, `APPEND_OUT_OF_ORDER`, the touched conversations listed in `chat_append`; a channel is found by its map id or its uuid (a channel re-pointed to the real number needs only to exist);
- `--allow-extra-rows` (after cutover) relaxes exactly what live traffic changes: extra messages and events, counters of live threads, receipts on migrated outbound messages (`liveColumns`), channel status.

`test/chat.spec.ts` proves it with 20 damage cases (delete / reorder / alter / move / add a message, counters, unread, contact, ledger, channel credential, outbox, event, `queued`, partition, quarantine log ...).

## Measured (invented data, laptop, Docker Postgres 16)

20,000 turns / 1,000 threads / about 14 monthly partitions, batch 500: load 34 s, reconcile 9 s, a second run that has nothing to do 0.3 s (karma: 72,209 turns, expect about 2 to 3 minutes). Invented acme dump: 61 documents -> 47 loaded in
10 threads, 11 quarantined, 3 excluded.

## Not migrated

`chatbot_misc_config` (never read), `chathistory_view`, `context.*` / `user.*` snapshots beyond the fields above (campaign / device / contact echoes; the contact already has them; counts are listed in the report), `agent` presence fields,
`entity`, per-turn delivery state (`sent` / `received` only, Q9), `conversation_events` / `message_events` / unread / SLA / participants / notes, any `usage_charges`, the files behind media URLs (a later builder), website chat (Q6),
Waboo session boundaries (only `meta.legacy.sessionId`), delivery receipts of automation / inbox sends from `whatsapp_broadcasting_data` (not joinable without the unverified key normalisation).

## UNVERIFIED guesses (confirm on a 50-document unmasked look before the first real run)

- The element shapes of `bot_response.response[]`: strings, `{text|message|body|caption|content|value|title}`, nested arrays, media in `url|link|image|video|audio|document|file|media|src`. Anything else keeps the whole payload in `meta.legacy.response`
  and gets a soft `SHAPE_UNEXPECTED` / `NO_TEXT`. Buttons and quick actions of interactive elements are read since the real dump (see "Interactive bot messages") and also stay in `meta.legacy.response`.
- `bot_response.type` / `user_query_object.type` -> `messages.kind` (text, image, video, audio, voice, document, sticker, location, contact, template, button / list / quick reply / carousel -> interactive); unknown -> `text` + `UNKNOWN_KIND`.
- `ctype=livechat` out-turns are agent messages and `agent.id` is the Waboo user id; `ctype=bot` out-turns are bot messages.
- A hand-over line (`fromAgent` / `toAgent`) is a `system` message with direction `in` (spec A 2.3) and does NOT count as a customer message for `last_inbound_at` / `window_expires_at` (a deviation from "newest `in` message": the window belongs to the customer).
- **Thread status:** the status of a thread is the `conversation_status` (`Open` / `Closed`) of its NEWEST `visitor_logs` session (one row per chat session, matched by `session_id`, recency by `last_message_time`, else `updatedAt`): that is the current state at the source. `user.conversation_status` on a chat turn is only a snapshot from when the turn was written and is often empty (Rhythm: 59 closed conversations, none of them closed on a turn), so it is the FALLBACK when no `visitor_logs` row names a status. `chat-status` (also a step of `migrate --catch-up`) applies this to conversations an earlier load wrote open: only open -> closed, `resolved_at` = the thread's last message, never reopened, never a conversation somebody resolved or reassigned in WaDesk. `user.conversation_status` is only `Open` / `Closed` (anything else imports open + `NO_STATUS_CONV`); `user.mobile` and `context.visitor_phone` are the customer's WhatsApp number; `meta_msg_id` is a WhatsApp message id.
- Buttons under a bot message (`Visit our website`, `Call now`, quick replies): Waboo's `interactive.action.buttons[].value.text` become `messages.meta.sentInteractive` (`inbox/parse.ts` `sentInteractiveFrom`: one link alone = `cta_url`, otherwise a list of titles), the shape the inbox draws; the raw object stays in `meta.legacy.interactive`. `chat-buttons` (a catch-up step) fixes clients loaded before this.
- `channel` other than `whatsapp` / `website` is `UNSUPPORTED_CHANNEL`; a missing `channel` is read as whatsapp.
- A document with no readable `createdAt` is quarantined `BAD_DATE` (no fallback to the ObjectId time): chronology is the point of a thread.
- Thread uuid uses the phone number id (not `channels.id`, as the spec said) so it survives a re-created channel.
- The agent of the thread is the newest turn that has one; with no `user` collection in the dump nothing is assigned and nothing is reported.
- The independent oracle reads only the shapes it is sure of (strings, `{text}` elements, interactive elements and `share-location`, `value` / `user_query` strings): other turns are counted as "unchecked" in the report warnings.

## Open questions for the manager (my defaults are in the flags above)

Q3 chats of contacts deleted at the source: **exclude** (`--keep-deleted-contact-chats` to load them). Q4 imported thread status: **keep Waboo's Open / Closed**; the consequence is that about 99% of karma's old threads (296 of 300 sampled sessions are Open) show in the
Open tab with `unread_count` 0 and no waiting nudge; `--thread-status closed` avoids it, agree with the client before cutover. Q6 website chat: **quarantined** `WEBCHAT_NO_CHANNEL` until a webchat channel (widget) exists, then re-run.
Q7 channel identity: **operator-written `channel-map.json`**, two people check the phone number ids. Q8 cutover order: **migrate chats before the number gets live traffic in the new app**; a post-cutover delta is not supported. Q9 per-turn delivery state: out of scope (outbound = `sent`).
Q10 media: **URL kept in `meta.legacy.mediaUrl`**, the attachments builder copies objects and sets `media_key` later (a plain UPDATE: `messages` has no touch trigger).

## Not finished

- Turns that sort before a loaded one (`APPEND_OUT_OF_ORDER`) are not merged; a thread whose Waboo contact, status or agent changed with NO new turn is not updated either (only a thread with newer turns gets its conversation row recomputed).
- Appending after cutover (live traffic in the same thread): not supported; a thread that has live messages and was not made by this tool is `THREAD_HAS_LIVE_MESSAGES`, and a migrated thread that received live messages no longer matches the plan (`msg_seq` check, `PARTIAL_THREAD`).
- `visitor_logs` cross-checks (status / assignee per session) are phase 2.
- **Delivery state (`chat-delivery`):** the chat history has no receipts, so the loader writes every outbound turn `sent`. `chat-delivery --client <c> --org-slug <s> [--apply --confirm-org-slug <s>]` reads the billing log (`whatsapp_broadcasting_data`, non-broadcast rows, keyed by the wamid = `meta_msg_id`) and moves the loaded outbound messages FORWARD from `sent` to `delivered` / `read` (a reply counts as read) / `failed` (`status`, `delivered_at`, `read_at`, `failure_code`, `failure_reason`). Never to `queued`, never back, never a message the live app already moved. The touched message uuids go to `run_log` (`_chat` / `chat_delivery`) and reconcile lets exactly those differ from `sent`. Dry run by default; idempotent.
- Nothing was run against a real dump, `iskm` or `karma`.

---

# Stage 2: broadcasts (campaigns and recipient logs)

**PROGRESS:** built and tested on invented data (`test/bcast.spec.ts`). **Never run against a real dump**: the pilot profiles are masked, so the format of `error`, the zone of `scheduled_date` and the exact status words are guesses
(list below). Not built: the template re-link (`link-templates`). The credits and the home for the 94% of `whatsapp_broadcasting_data` that is not a campaign recipient are the credits step (see "Stage 2: credits"). **Nothing in the application
schema was changed**: the spec's `legacy jsonb` column (its Q2) is NOT approved, so it is a text proposal in `proposals/legacy-jsonb.sql` and the fields it would have held are listed under NOT PRESENT. No commit, no server, no Mongo was touched.

Team decisions: "broadcast logs yes", "whatsapp broadcasting karna he", "broadcast template no migrate". `broadcast_templates` stays EXCLUDE.

## The model

| Source                                                                      | Target                                         | Rule                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `broadcasting` (campaign)                                                   | `wpcampaigns` (NOT `broadcasts`: spec D3 / Q1) | one row per campaign; `uuid = uuidv5(client\|broadcasting\|_id)`; `_id`, `id` and `broadcast_id` are all registered in `migration.id_map`                                                                                                                                                                                          |
| `whatsapp_broadcasting_data` with `source = broadcast` and a `broadcast_id` | `wp_campaign_contacts`                         | one row per recipient; `campaign_id` through `id_map`                                                                                                                                                                                                                                                                              |
| every other row of `whatsapp_broadcasting_data`                             | nothing                                        | excluded `NON_BROADCAST_SOURCE` and counted (about 23k of 36k on iskm and about 10.7k of 188k on karma are recipients). They are the billing / delivery log of automation, inbox and test sends: **a later credits builder decides their home** (join key `message_id` = `usage_charges.wamid`). The report counts them by reason. |

Order: org (+ owner) -> roles -> users -> fields ... -> contacts -> groups -> notes -> **campaigns -> recipients** -> inbox. Pass 1 (`broadcast/plan.ts`, run by the `prepare` hook of the first broadcast step) reads both collections once: the verdict of every campaign key and
the roll-up of every campaign over the recipient rows that WILL load. The campaign row is inserted with its final counters, so nothing is ever UPDATEd (`touch_row` would stamp `updated_at = now()` and bump `row_version`).

Recipient verdicts, in order: exclude `NON_BROADCAST_SOURCE` (source is not `broadcast`, or no `broadcast_id`) -> quarantine `CAMPAIGN_MISSING` (no campaign with that key, or its campaign was quarantined) -> exclude `CAMPAIGN_EXCLUDED` (its campaign is a test / deleted one)
-> quarantine `NO_PHONE` (`phone_no`, `mobile`, `mobile_phone_number` all empty) -> quarantine `NO_STATUS` (no readable step date). Campaigns: exclude `SOFT_DELETED`, exclude `TEST_BROADCAST`, quarantine `EMPTY_NAME`, quarantine `UNSUPPORTED_TYPE` (`type` other than whatsapp);
plus the engine's `NUL_CHAR` / `LONE_SURROGATE` / `DUPLICATE_KEY` / `NO_KEY`. Soft (the row still loads, one quarantine row `key#CODE`): campaigns `TEMPLATE_UNLINKED`, `SENDER_NUMBER`, `COST_FIELDS` (money as exact decimal strings), `NONTERMINAL_AT_MIGRATION`, `UNKNOWN_STATUS`,
`PENDING_AT_MIGRATION`, `COUNTER_MISMATCH` (Waboo's own counters vs the rows), `RECIPIENT_COUNT_MISMATCH`, `UNRESOLVED_USER`, `BAD_DATE`, `NO_DATE`; recipients `STATUS_CONFLICT`, `ERROR_DROPPED`, `INVALID_PHONE`, `CONTACT_BY_PHONE`, `CONTACT_AMBIGUOUS`,
`CONTACT_UNRESOLVED`, `CONTACT_DELETED_AT_SOURCE`, `BAD_DATE`, `NO_DATE`.

### Recipient status (spec 4.3, forward-only)

`status` is an object of step dates (`sent`, `delivered`, `seen`, `failed`, `replied`; a failed row also has `sent`). The row is `failed` when a failure is not matched by a later-or-equal delivered / seen / replied; otherwise the highest step wins
(`responded` > `read` > `delivered` > `sent`), with a soft `STATUS_CONFLICT` when both existed. The iskm quirk of a literal top-level key `"status.sent"` stands in for a missing `status.sent`. Timestamps are not back-filled (`seen` without `delivered` leaves `delivered_at` NULL; the
app's roll-up treats a read as delivered). `error` -> `error_message`; `error_code` = its leading 3 to 6 digits (`(#131049) ...`, `131026 ...`). `updated_at` = the newest step date (never before `created_at`).

## Safety: an imported campaign must NEVER be sent, scheduled or retried

Checked against every consumer in `apps/api/src/modules/campaigns` and pinned by `test/bcast.spec.ts`, which runs the consumers' own predicates against the loaded data and expects zero hits:

| Consumer                                                     | What it picks up                                                                                                                                                                          | How the import stays out of it                                                                                                                                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CampaignSweeperService.sweep` (every 5 s)                   | `status = 'scheduled'` with a send date: starts it                                                                                                                                        | status is always `completed` / `failed` / `cancelled`. Waboo scheduled / running / draft / paused / anything unknown becomes `--nonterminal-status` (cancelled) + soft `NONTERMINAL_AT_MIGRATION` / `UNKNOWN_STATUS` |
| `resumeStalled`                                              | `status = 'running'` with queued / pending / retryable recipients: schedules it again                                                                                                     | no `running` campaign; no `queued` / `pending` recipient                                                                                                                                                             |
| `reconcileMetaBlocks` (sweeper)                              | `status = 'failed' AND send_attempts < 3 AND next_attempt_at IS NULL` in a finished campaign; when the error is Meta's 131049 / "healthy ecosystem" it **reschedules the whole campaign** | failed recipients get `send_attempts = --failed-send-attempts` (default 3, minimum 3, refused below); `next_attempt_at` NULL                                                                                         |
| Wizard retry job (`arm` / `runDue`)                          | `wpcampaigns.retry_enabled` + a failed recipient with `retry_state` NULL / `scheduled` (error code 131049)                                                                                | `retry_enabled` is written **false** even when Waboo had it true (counted in NOT PRESENT); `retry_state` NULL everywhere; no wizard / series row                                                                     |
| Tiles (`AGG` in `campaigns.repository.ts`)                   | a recipient with ANY of sent_at / delivered_at / read_at / responded_at counts as sent                                                                                                    | a FAILED recipient carries none of the four; counters on the campaign equal the roll-up of its rows, so a later `recount` is a no-op                                                                                 |
| `QueuedMessageRecoveryService`, inbox mirror, outbox, wallet | `queued` messages, outbox rows, charges                                                                                                                                                   | no message is created (spec 7), no `event_outbox` / notification / usage charge / wallet row is written (baseline digest + explicit checks); no INSERT trigger exists on either table (pinned by a test)             |

A user can still press Resend on a completed / cancelled imported campaign (that is the product's explicit action; it needs a template, which an imported campaign does not have).

## Commands and flags

```bash
$CLI run       --client iskm --channel-map ... --org-name ISKM --owner-email a@b.c     # broadcasts run before the inbox
$CLI run       --client iskm ... --dry-run                                             # plan: counts per verdict, rolled back
$CLI reconcile --client iskm --channel-map ... --out out                               # reads the switches the run recorded (`_bcast` / `options`)
```

| Flag                       | Default     | Meaning (every default is the one recommended in spec A; each is recorded by the run and compared by reconcile)                                         |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--failed-send-attempts N` | 3           | `send_attempts` of a failed recipient (3..100; refused below 3, see the sweeper above)                                                                  |
| `--keep-test-broadcasts`   | off         | load campaigns with `test = true` (and their recipients) instead of excluding them `TEST_BROADCAST`                                                     |
| `--nonterminal-status S`   | `cancelled` | `cancelled` or `failed`: the terminal status of a Waboo status that is not completed / failed / cancelled                                               |
| `--default-cc 91`          | none        | as for contacts: a recipient number with no country code is read with it; without it such a number keeps its raw digits and gets a soft `INVALID_PHONE` |

Other decisions made without a flag (all in the code, listed so they can be argued with): `campaign_type = template`, `provider = waba`; schedule columns hold the UTC clock and `timezone = 'UTC'` (a zone-less ISO string is read as UTC, never in the machine's zone);
`run_at = last_run_at = sent_on`; `total_recipients = max(Waboo recipients, loaded rows)`; `created_by` through `id_map` (soft `UNRESOLVED_USER`); the contact of a recipient is `id_map` by string id or ObjectId, else the single contact with that phone (`CONTACT_BY_PHONE`), several -> none,
none -> none, a contact deleted at the source -> none (the phone and name snapshot stay on the row); `send_attempts = 1` on a row that was sent.

## What reconcile covers now

`reconcile/oracle-campaigns.ts` is a second implementation (imports nothing from `transform/`, `broadcast/` or `load/`) and `reconcile/campaigns.ts` checks, per client:

- the equation `read = migrated + quarantined + excluded` for both collections (generic), with the excluded rows counted by reason in the report (`## Excluded, by reason`; the listing is capped at 500 per reason), `migration.id_map` exactness both ways (every key of every campaign, the string ids of recipients), the quarantine digest;
- oracle vs the loader's plan: the verdict tally (`campaign load`, `recipient exclude NON_BROADCAST_SOURCE` ...) and the roll-up of every campaign;
- every loaded campaign and recipient: each column compared with the oracle (status, all four timestamps, error text and code, phone, name, message id, contact, campaign, send_attempts, schedule, counters, dates to the microsecond), and the columns the loader never writes still at their defaults;
- every quarantined recipient or campaign has exactly the code the oracle says; every campaign has the soft rows it is owed;
- SAFETY in SQL: no migrated campaign outside completed / failed / cancelled (`SENDABLE_CAMPAIGN`), none with retry on or a wizard / series, no recipient queued / pending / skipped or with a retry state or a next attempt (`SENDABLE_RECIPIENT`), no failed recipient with a timestamp
  (`FAILED_WITH_TIMESTAMP`) or with fewer than 3 attempts, `responded_at` iff `responded`;
- COUNTERS: the stored counters of every campaign equal the app's own roll-up over its rows, and `total_recipients >= rows` (`COUNTER_MISMATCH`);
- extra rows: any `wpcampaigns` / `wp_campaign_contacts` row of the organization that no document accounts for (`EXTRA_ROWS`), rows in `camp_retry_attempts` / `camp_test_sends` / `wa_link_clicks` / `scheduled_messages` for migrated campaigns, and (baseline digest) anything in `event_outbox`,
  `notifications`, `usage_charges`, `wallet_transactions` ...; the two tables are now bulk tables (removed from the baseline digest, held by the checks above);
- NOT PRESENT: the report's "Source fields with no target column" lists every Waboo field with no home, counted over the rows that DID load (`NOT PRESENT (broadcasts): ...`).

`--allow-extra-rows` (after cutover) relaxes exactly what live traffic changes: extra rows, the status / counters / updated_at / retry switch of a migrated campaign, the status, delivery timestamps and error of a migrated recipient. A lost or altered migrated recipient still fails.

`test/bcast.spec.ts` damage cases (every one is caught): delete / change the status of / add a recipient, `sent_at` on a failed one, a counter, the audience size, an extra campaign, a campaign flipped to scheduled / running, retry switched on, a recipient queued / armed for retry, `send_attempts` lowered, phone, contact, campaign
move, error code, a template-side column, rename, delete a campaign, the money text in the quarantine log, the soft-issue log, an `id_map` row, an outbox row, a retry attempt.

## Template link of a campaign (`wpcampaigns.template_id`)

A campaign document carries `broadcast_template_id` (the Waboo `id` of a `broadcast_templates` document), `broadcast_template_name`, `_type` and `_category`. It carries **no language and no Meta id**; the Meta id is on the recipients (`whatsapp_broadcasting_data.meta_template_id`, one value per campaign). Measured on the dumps (structure only): iskm 19 of 19 campaigns and rhythm 7 of 9 campaigns name a template that exists (same name, and the recipients' Meta id equals the template's `meta_template_id` on every one); the 2 other rhythm campaigns name a template that is not in the dump (deleted at Waboo; their recipients' Meta id matches no loaded template either). Every recipient of a campaign carries the same `template_id` as its campaign. `wp_campaign_contacts` has **no** template column, and the chat history carries no template reference at all (no key containing "templ" in either dump), so `messages.template_id` has nothing to be linked from: only the campaign is linked.

Exact rules (`broadcast/template-link.ts`; the verifier has its own copy in `reconcile/oracle-campaigns.ts`), nothing is guessed:

1. **Template id**: `broadcast_template_id` is a key of a migrated template (`migration.id_map`, collection `broadcast_templates`). If the campaign also names it, the name must be identical, else `CONFLICT`.
2. **Meta id**: the campaign's own `meta_template_id`, else the single distinct `meta_template_id` of its loaded recipients (two distinct values count as none), against `wa_templates.meta_template_id`. One row links; several rows are `AMBIGUOUS`. When 1 and 2 both find a row it must be the same row, else `CONFLICT`.
3. **Name (+ language when the campaign carries one)**: only when 1 and 2 found nothing and no Meta id is known (a known Meta id that matches no loaded template says the sent template is not loaded). Exactly one row links (soft `TEMPLATE_LINKED_VIA`); several languages are `AMBIGUOUS`.

Anything else leaves `template_id` NULL with the counted soft issue `TEMPLATE_UNLINKED` (`detail.why`: `NO_REFERENCE`, `NOT_FOUND`, `AMBIGUOUS`, `CONFLICT`). `template_id_a` / `template_id_b` stay NULL (no A/B test). A campaign has a terminal status and `retry_enabled = false`, so a linked template cannot make anything send.

**Fresh load**: the `templates` step must load before `campaigns` (it does: `STEPS` order, and `STEP_DEPS.campaigns` now lists `templates`). The loader reads `wa_templates` and the template keys of `id_map` before the first campaign is written.

**Campaigns already loaded** (template_id NULL): `campaign-link`, dry run by default.

```bash
node pilot/staging/cycle.cjs campaign-link --client iskm            # dry run: counts per rule and per reason, nothing written
node pilot/staging/cycle.cjs campaign-link --client iskm --apply    # writes (the wrapper passes --confirm-org-slug)
# direct: $CLI campaign-link --client iskm --org-slug <slug> [--apply --confirm-org-slug <slug>]
```

It reads the dump (`broadcasting`, `whatsapp_broadcasting_data`) and the database. Rows: `wpcampaigns` of the organization that this tool loaded (collection `broadcasting` in `id_map`) with `template_id IS NULL`; a campaign that already has a template is never touched (counted, and flagged when the rules would pick another). Changes only `template_id`. `wpcampaigns` has the touch trigger, so each linked row gets `updated_at = now()` and `row_version + 1`; their uuids are recorded in `migration.run_log` (`_bcast` / `campaign_link`) and `reconcile` does not flag those two columns for exactly them. The `TEMPLATE_UNLINKED` quarantine row of a linked campaign is removed; a link by Meta id or name gets `TEMPLATE_LINKED_VIA`. Idempotent. Until it is run on a client loaded before this change, `reconcile` reports `template_id expected=N target=null (run campaign-link)` for each linkable campaign.

## NOT PRESENT (no column; counted in every report; the raw dump is the archive)

Campaign (`wpcampaigns`): template name / type / category (the template itself is linked through `template_id`, see "Template link of a campaign"; the name is only a cross-check, and stays as text in the quarantine row `TEMPLATE_UNLINKED` when no template matches), sender number (`device_id` NULL; text in `SENDER_NUMBER`), audience (`filter_query`,
`mongodb_query`, `search`, `marketing_list_id`), `components`, cost fields (`billable_amount`, `refunded_amount`, `reseller_amount`: text in `COST_FIELDS`, money belongs to the credits step), retry settings (`retry_enabled`, `retry_count`, `max_retries`, `last_retry`; the app's switch is written false),
`updated_by`, `processing` / `queued` counters, telemetry. Recipient (`wp_campaign_contacts`): `amount`, `cost`, `reseller_amount`, `reseller_margin`, `cost_description`, `revert`, `reverted_at`, `refund_run_id`, `template_id`, `meta_template_id`, `template_category`, `primary_email`, `conversation_id`,
retry switches, automation bookkeeping. The Waboo counters of a campaign are kept only when they differ (`COUNTER_MISMATCH`). **The application recomputes every tile from the recipient rows, so a campaign shows the counts of the rows that exist (a karma campaign whose
log rows are mostly missing shows far fewer than Waboo did).** Waboo's `recipients` (the audience size) is kept in `total_recipients`.

Proposal P1 (`proposals/legacy-jsonb.sql`, **not applied**): one nullable `legacy jsonb` on each of the two tables would carry all of the above verbatim. It needs a migration through the `add-migration` skill and the manager's yes (Q2).

## UNVERIFIED guesses (confirm on a 50-document unmasked look before the first real run)

- `error` format: the leading 3 to 6 digits are Meta's code (`(#131049) ...`, `131026 ...`). A different format only means `error_code` is NULL; the 131049 guard does not depend on it (it is `send_attempts`).
- `scheduled_date` / `scheduled_date_dt` are in UTC (Waboo's real zone is unknown); `scheduled_now = false` with a date means a scheduled campaign.
- Status words: completed / failed / cancelled (canceled, stopped); the list of "not finished" words is a guess; anything else is `UNKNOWN_STATUS` -> cancelled.
- `broadcast_id` of a recipient equals the campaign's `broadcast_id` or `id` (the pilot profile says "likely broadcasting"); a recipient that matches nothing is `CAMPAIGN_MISSING`.
- A failed recipient has `status.failed` and no later delivery step; `sent` on a failed row only means "attempted".
- `source = broadcast` is the only recipient source (iskm: broadcast 193 / automation 93 / inbox 13 / test 1; karma: automation 245 / inbox 38 / broadcast 17 of 300 sampled); the recipient counts per client (about 23k iskm, about 10.7k karma) are extrapolated from those samples.
- A Waboo number field that is a numeric string is accepted as a number; a money field that is neither is ignored.

## Open questions for the manager (my defaults are in the flags above)

**Q1** Broadcast history under Campaigns (`wpcampaigns`) or under Broadcasts (`broadcasts`)? Default: **Campaigns** (replied state, nullable contact with a phone / name snapshot, error code; `broadcast_contacts.contact_id` is NOT NULL, which loses 5 to 13% of the rows). History then shows under `/campaigns`, not `/broadcasts`.
**Q2** May we add the nullable `legacy jsonb` column on `wpcampaigns` and `wp_campaign_contacts` (`proposals/legacy-jsonb.sql`)? Default: **no schema change**; the fields in NOT PRESENT live only in the raw archive (and, for campaigns, as text in the quarantine log). A yes needs a migration and about 8 hours.
**Q5** The 94% of `whatsapp_broadcasting_data` that is not a campaign recipient (automation / inbox / test sends: cost, refund, template category): who owns them? Default: **excluded here (`NON_BROADCAST_SOURCE`, counted), the credits builder writes `usage_charges` from them** (key = `message_id`).
**Also decide:** Waboo campaigns that were still scheduled / running / paused are imported **cancelled** (`--nonterminal-status`), never as their Waboo status; and whether a campaign without a template (history only, no Resend) is acceptable until the template sync and a `link-templates` step exist.

## Measured (invented data, laptop, Docker Postgres 16)

20,000 delivery-log rows (10 campaigns, 14,000 recipients, 6,000 rows of other sources), batch 1,000: load 8 to 11 s, reconcile 3.5 s, a second run that has nothing to do 0.3 s. Invented acme dump: 41 recipient-log documents -> 26 loaded, 7 quarantined, 8 excluded
(6 `NON_BROADCAST_SOURCE`, 2 `CAMPAIGN_EXCLUDED`); 13 campaign documents -> 9 loaded, 2 quarantined, 2 excluded. Karma (188,599 documents, about 10.7k recipients) was NOT measured; the work is linear (three streaming passes in the run, three in reconcile, memory is the set of ids plus one batch), so expect a few minutes.

---

# Stage 2: credits

**PROGRESS:** built and tested on invented data (`test/credits.spec.ts`, `credits-runs.spec.ts`, `credits-pricing.spec.ts`, `credits-volume.spec.ts`). **Never run against a real dump**: the pilot profiles are masked, so the inner keys of `credits_mapping_new.whatsapp.<category>`, the unit of a Waboo credit and the balance of the Waboo credit pool are unknown (list below).
**Nothing in the application schema was changed** and no SQL migration was added; the proposal for the parts that have no table is the text file `proposals/pricing-extras.sql` (not applied). Not built: a variant that writes the historical billing as `charged` rows (see "Why a historical charge is `free`"), posting `credits_expenses`, applying Waboo's per-category `margin`.
No commit, no server, no Mongo, nothing in `pilot/` was touched.

Team decisions: "credit-logs should migrate all", "credit-mapping new need to migrate", "credit-mapping dont need to migrate" (`credits_mapping` stays EXCLUDE), "broadcast logs yes". Pilot clients: ISKM and Rhythm Watches (Karma is dropped).

## The model

| Source                                                                                    | Target                                                       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credit_logs` (ALL rows), the counters                                                    | `ai_token_usage` (step `credit_tokens`)                      | one row per document: `provider` (`openai_api` -> `openai`, else the vendor prefix of the model, else `unknown` + soft `PROVIDER_GUESS`), `model`, `prompt_tokens` = `input_tokens`, `completion_tokens` = `output_tokens`, `total_tokens` = `tokens_used` when it is at least input + output (cached tokens may be counted in it) else their sum (soft `TOKEN_TOTAL_MISMATCH`), `billed_against = 'admin'`. The table has no source key: idempotency is `migration.id_map` (collection `credit_logs_tokens`, `target_id` = the new id), written in the SAME transaction as the row |
| `credit_logs`, the money                                                                  | `wallet_transactions` (step `credit_wallet`)                 | a spend `-round2(credits_deducted)` (type `spend`, direction `out`, `source waboo_ai`, `actor_type system`), only when it rounds to at least 0.01. The exact text of the amount, `new_balance`, `cost`, `action`, `module`, `type`, `model`, `bot_id` and the four token counters are kept in `meta.legacy.waboo`. `idempotency_key = waboo:<client>:credit_log:<_id>`                                                                                                                                                                                                              |
| the confirmed balance (`credit-opening.json`)                                             | one `admin_adjust` entry + `wallets` (created LAST)          | `opening = B + S` (B confirmed, S = sum of the spends), `balance_after` of every spend = opening minus the spends up to it (time, then `_id`), `wallets.balance = B = sum(ledger)`. The opening entry is dated one second before the first spend; `actor_type platform_operator`, `actor_label waboo-migration`, a note that names who confirmed the figure                                                                                                                                                                                                                         |
| `whatsapp_broadcasting_data`, the rows the broadcast step excluded `NON_BROADCAST_SOURCE` | `usage_charges` + `usage_charge_keys` (step `usage_charges`) | keyed by `message_id` = `wamid`, written as inert `free` rows (below). Rows of `source = broadcast` with a `broadcast_id` are the broadcast step's and are not touched                                                                                                                                                                                                                                                                                                                                                                                                              |
| `credits_mapping_new`                                                                     | `message_rates` ONLY, by the operator command `pricing-seed` | never by a client run; see "Pricing"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `credits_expenses` (1 doc on karma, none on iskm), `credits_mapping`                      | nothing                                                      | EXCLUDE (registry reasons)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Order: org (+ owner) -> roles -> users -> fields ... -> broadcasts -> **credit_wallet -> credit_tokens -> usage_charges** -> inbox, then, after the last step, the wallet row. Pass 1 (`credits/plan.ts`) reads `credit_logs` and the billing log once, from the dump alone, BEFORE the connection is opened: it gives every document its verdict, orders the postings, computes every `balance_after`
(a posted ledger row is immutable by trigger, so it has to be right at INSERT) and refuses a bad configuration with nothing written. Nothing is ever UPDATEd.

## Money rules

- **Text, never floats.** A BSON double is read as its shortest decimal text (`0.1 + 0.2` stays `0.30000000000000004`, `1e-7` becomes `0.0000001`); everything after that is BigInt arithmetic (`credits/decimal.ts`). A JSON number is refused in `credit-opening.json`.
- **Rounding rule (explicit, counted, nothing vanishes).** Half away from zero on the decimal TEXT, to hundredths (the wallet works in hundredths and the app's postings are whole hundredths): `2.675` -> `2.68`, `0.005` -> `0.01`, `0.0049` -> not a ledger row. A row whose amount had more than two fraction digits gets a soft issue `ROUNDED` (exact text, posted amount, residual) in
  `migration.quarantine`; a row under 0.01 is excluded `BELOW_LEDGER_PRECISION` (an exact `0` is `ZERO_AMOUNT`). The run prints, and reconcile warns with, the totals: rows rounded, the residual (`sum(exact) - sum(posted)`, can be negative), rows under 0.01 and their exact sum. Reconcile also proves, from the dump and from the DB,
  `exact total = posted + rounding residual + below 0.01 + over the limit` with exact integers (`CREDITS_ACCOUNTING`). The opening entry absorbs the residual: **the balance is exactly the confirmed figure**, the interior `balance_after` values differ from Waboo's `new_balance` by the accumulated rounding.
- **Limits.** `|amount| <= 10,000,000.00` (the app's `maxAmountMinor`): bigger is quarantined `AMOUNT_OVER_LIMIT`; an opening entry above it stops the run (`CREDITS_OPENING_OVER_LIMIT`).
- **Quarantine codes (wallet):** `NEGATIVE_DEDUCTION` (never guessed to be a refund), `NOT_A_NUMBER` (missing, NaN, Infinity, text), `NO_DATE`, `BAD_DATE` (outside 10 years back / 1 year ahead of the dump, the window `ensure_monthly_partition` accepts), `AMOUNT_OVER_LIMIT`, `OTHER_WORKSPACE`, plus the engine's `DUPLICATE_KEY` / `NUL_CHAR` / `LONE_SURROGATE`.
  Soft (the row loads): `ROUNDED`, `USER_UNRESOLVED` (a `user_id` that matches no migrated user is stored as NULL), `UNKNOWN_CREDIT_TYPE` (a type other than `openai_api`: the direction is NOT inferred from it, every row is a spend). Excluded and counted: `BELOW_LEDGER_PRECISION`, `ZERO_AMOUNT`, `WALLET_NOT_MIGRATED`.
  **Tokens:** `NO_DATE`, `BAD_DATE`, `OTHER_WORKSPACE`; soft `BAD_TOKEN_COUNT` (a counter that is not a whole non-negative number that fits the column is stored as 0), `TOKEN_TOTAL_MISMATCH`, `TOKEN_OVERFLOW`, `PROVIDER_GUESS`.
  **Usage:** `NO_MESSAGE_ID`, `NO_DATE`, `BAD_DATE`; excluded `DUPLICATE_WAMID` (the first row of a wamid wins: `usage_charge_keys` is unique per organization and wamid); soft `BAD_AMOUNT`, `UNKNOWN_CATEGORY`.

## Commands and flags

```bash
$CLI run --client iskm --channel-map ... --credit-opening /secure/iskm-credit-opening.json --org-name ISKM --owner-email a@b.c   # default file: <dumps>/<client>/credit-opening.json
$CLI run --client iskm ... --dry-run                      # prints "credits: N credit_logs row(s): ...; rounding ...; confirmed balance ...", rolls everything back (partitions included)
$CLI run --client iskm ... --no-wallet                    # tokens and usage charges only, NO wallet row (explicit opt-out)
$CLI run --client iskm ... --force                        # after --no-wallet, once the file exists: a step whose credit rows were all excluded is "done", --force re-reads it
$CLI run --client umbrella ... --credit-workspace-id <id> # when credit_logs holds more than one workspace_id
$CLI reconcile --client iskm --out out                    # reads the switches the run recorded (`_credits` / `options`); pass --credit-opening if the file moved
$CLI pricing-seed --client iskm [--compare-with rhythm] [--factor 0.012] [--apply] [--skip-conflicts]   # OPERATOR command, see "Pricing"
```

| Flag                       | Default                                | Meaning                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--credit-opening FILE`    | `<dumps>/<client>/credit-opening.json` | the externally confirmed balance. **Required for the wallet part when the dump has credit_logs rows: the run (dry run too) stops BEFORE anything is written with `CREDITS_OPENING_REQUIRED`**, naming the file and the alternative |
| `--no-wallet`              | off                                    | write no wallet rows (`wallet_transactions`, `wallets`); every credit document is then excluded `WALLET_NOT_MIGRATED` and counted                                                                                                  |
| `--credit-workspace-id ID` | none                                   | the one Waboo `workspace_id` whose rows load. Without it, more than one distinct value stops the run (`CREDITS_MULTIPLE_WORKSPACES`, ids shortened, counts shown); the other workspaces' rows are quarantined `OTHER_WORKSPACE`    |

### geta_core load (plan, subscription, business, role grants): core-load

Per client, after the roles step: node pilot/staging/core-opening.cjs --client C --workspace WABOO_DB --out DIR writes C-core.json (set coreFile in clients/C.json; ship copies it to dumps/C/core.json). Then node pilot/staging/cycle.cjs core-load --client C (DRY RUN) and the same with --apply.
It writes: one HIDDEN platform plan per Waboo plan code (base = the enterprise plan; only what the Waboo plan states is changed: users, segments and flows caps; forms and extra channels closed when the Waboo plan has them off); organizations.plan, org_plan_state.plan_ends_at (the next billing date) and settings.legacy.waboo business facts; one subscriptions row (gateway zoho, status active, the whole Waboo config in meta); and the grants of the CUSTOM roles the roles step already created (that step skips a loaded role), using the REVIEWED access/permission-map.json. Admin-class keys stay withheld. Waboo CRUD values are read as global_access (all), restricted_access (own) or none. Idempotent; the baseline digest of the tables it changed is re-recorded. Pricing: cycle.cjs pricing-seed is a DRY RUN only (the apply asks a person to type a phrase).

### Where the real balance comes from (geta_core), answers OQ-1

The tenant database has no wallet total. The live balance is `geta_core.workspace.credits.remaining_amounts` (INR for the pilot clients), and
top-ups are in `geta_core.reseller_credit_logs`. Do not use `credit_logs.new_balance`: it stops at the last AI deduction (ISKM: 50,984.99 on
2026-06-25 against a real 267,733.04 after a 300,000 top-up on 2026-06-30). Generate the file, never type it:

```
node pilot/staging/core-opening.cjs --client iskm --workspace <waboo db name>     # writes <client>-credit-opening.json and <client>-core.json
```

The balance moves while Waboo is live (Rhythm fell by 0.45 within an hour), so run it at cutover, right before the wallet step, and keep Waboo
sending frozen or accept the difference. `<client>-core.json` also carries the plan and subscription facts (plan_code, status, amount, billing
dates) for the plan/subscription loader, which waits for the WaDesk plan feature (see missing-in-wadesk-log.md).

### credit-opening.json

```json
{
  "amount": "1234.50",
  "currency": "INR",
  "asOf": "2026-10-08T18:30:00Z",
  "confirmedBy": "Name, where the figure came from (billing screen, invoice number ...)",
  "note": "optional"
}
```

Only these keys. `amount` is a decimal STRING with at most two fraction digits, `>= 0`; `currency` is an ISO 4217 code in capitals; `asOf` is an ISO date-time WITH a zone and must not be before the newest migrated credit row (`CREDITS_OPENING_ASOF`: a balance read earlier does not include those debits); `confirmedBy` says who and from where (3..160 characters; it is written into the note
of the opening entry on the immutable ledger). The file is the anchor: it is the balance of the Waboo credit pool at the END of the migrated credit history. `credit_logs.new_balance` is **never** used as the balance (WhatsApp debits and purchases are not in `credit_logs`); the file's sha256 is recorded by the run and reconcile fails (`CREDITS_OPENING_DIFFERS`) if it reads another one.
**The wallet unit must be the currency the workspace is billed in** (`organizations.settings.currency` when a Meta rate card exists for it, else the platform currency): this tool does not change organization settings, and a wallet in another currency would simply not be used.

## Wallet history: the full statement (`wallet-history`)

The first credits design posted ONE confirmed opening balance and only the AI charges, so a client's WaDesk statement showed 4 rows where Waboo shows thousands. Waboo's money history is all in the data and it adds up (Rhythm Watches: every top-up checkpoint Waboo logged is reproduced to the paisa), so the ledger is rebuilt from it. `wallet-history` is a step of the migrate chain, after `wallet-sync`, and of the catch-up.

| Source                                                                                                      | Ledger row                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `whatsapp_broadcasting_data`, rows that were NOT reverted                                                   | one `spend` per local day and category, "Balance Deducted For Whatsapp <Category>" (key `waboo:<client>:wa:chg:<day>:<category>`). This is Waboo's own list granularity: ISKM 2026-10-14 utility = 6 x 1.525 = 9.15 |
| the same table, `revert = true` WITH a `reverted_at`                                                        | a `spend` on the day it was charged (`...:wa:rchg:...`, "(messages reverted later)") AND a `refund` on the day it was reverted (`...:wa:rev:...`, "Balance Reverted For Whatsapp <Category>")                       |
| the same table, `revert = true` WITHOUT `reverted_at`                                                       | nothing (refused at send time: charged and given back at once). Counted in the output                                                                                                                              |
| `credit_logs` (AI)                                                                                          | one `spend` per document at FOUR decimals (0.004132 is 0.0041); same key and uuid as before, so `id_map` still points at it                                                                                         |
| core.json `walletEvents` (geta_core `reseller_credit_logs`, both directions, and tenant `credits_expenses`) | `topup` (in), `admin_adjust` with the reason (a removal), `spend` (a purchase debit). Keys `waboo:<client>:reseller:<id>` / `:expense:<id>`                                                                          |
| the live balance (core.json `workspace.credits.remaining_amounts`)                                          | the opening entry = balance minus everything above, one second before the first row (key `waboo:<client>:opening`, same uuid as before)                                                                              |

- **Day = the workspace timezone** (`workspace.timezone` of geta_core, else UTC), not UTC. Only what happened up to `core.json` `readAt` counts, so the chain ends exactly at the live balance.
- **Amounts are exact decimals at four fraction digits** (numeric(20,4)); Waboo's 1.525 / 5.956 are posted as they are, not rounded to hundredths.
- **Checks before anything is written** (`credits/history.ts`): the opening must not be negative (`HISTORY_OPENING_NEGATIVE`: the logs and the balance do not belong together) and the chain must not dive deeper than an overdraft of 1,000.00 (`HISTORY_NEGATIVE`). A small overdraft is real (Waboo lets a wallet go a few messages negative) and is kept and reported. Every top-up that Waboo logged with its balance before it is a CHECKPOINT: the output says how many match (to 1.00), judged on the individual charges, not on the daily rows.
- **Needs a fresh dump.** The dump of `whatsapp_broadcasting_data` / `credit_logs` must be as new as the core snapshot: a stale dump leaves out the charges in between and every checkpoint is off by exactly that sum (Rhythm: 15.00 after an export two days old). A catch-up exports first.
- **The write** (`load/wallethistory.ts`), one transaction, owner login, privilege flag: the ledger rows this tool owns (`waboo:<client>:...`) are replaced by the planned rows (a posted row is immutable by trigger; only a privileged session may delete one) and `wallets.balance` is set to the live balance. Rows the tool did not write (real WaDesk activity) stop the run (`WALLETHISTORY_FOREIGN_ROWS`): the rebuild is for a client that is not live on WaDesk yet. Idempotent: the same plan again changes nothing ("already complete"). Dry run by default.
- **Memory**: one date formatter per zone (a formatter per charge exhausted the 1 GB container) and the charge documents are reduced to the fields used while they are read.
- **The verifier** (`reconcile/oracle-history.ts`, imports nothing from `credits/` or `load/`) recomputes the ledger from the dump and core.json and compares EVERY row (amount, balance_after, type, time): `HISTORY_MISMATCH`, `HISTORY_EXTRA_ROWS`, `HISTORY_BALANCE`. When the record `_credits / wallet_history` exists the old one-opening-balance checks (`CREDITS_MISMATCH`, `CREDITS_EXTRA_ROWS`, `WALLET_ANCHOR`, `CREDITS_ACCOUNTING`, the wallet_transactions fingerprint and extra-row checks) are not run: they judge the other model. `test/wallet-history.pure.spec.ts` checks the planner and the oracle against each other.
- **core-opening.cjs** writes `walletEvents` and `readAt` (run it, then ship, before `wallet-history`; an older core.json without them is refused with `WALLETHISTORY_NO_EVENTS`).
- **After a rebuild** a later `run` of the first-load credits group would find another opening entry (`CREDITS_OPENING_CHANGED`); the catch-up never runs that group.

```
node pilot/staging/cycle.cjs wallet-history --client rhythm            # dry run: the plan, the checkpoints, what would be replaced
node pilot/staging/cycle.cjs wallet-history --client rhythm --apply    # the wrapper passes --confirm-org-slug
# direct: $CLI wallet-history --client rhythm --org-slug <slug> [--apply --confirm-org-slug <slug>]
```

## Safety rules

- **No double debit.** `usage_charges` rows carry `credits = 0`, `revenue_minor = 0`, `status free`, `wallet_tx_id NULL`, `currency NULL`; only `wallet_transactions` moves money, and only from `credit_logs`. Reconcile alarms `CHARGE_WITH_MONEY` on any migrated charge with money or a wallet link.
- **The app's invariant is kept and checked.** `wallets.balance = sum(wallet_transactions.amount)` per unit (what `WalletReconcileJob` checks every hour), the chain `balance_after(i) - balance_after(i-1) = amount(i)` in SQL (`WALLET_CHAIN`), no `balance_after` below zero, `reserved = 0`, one wallet, and `wallets.balance` equals the confirmed figure (`WALLET_BALANCE`, `WALLET_ANCHOR`, `WALLET_MISSING`, `WALLET_EXTRA`, `WALLET_RESERVED`).
  The wallet row is created last, only when the ledger adds up to the confirmed balance (`WALLET_LEDGER_MISMATCH` stops the run otherwise); a wallet that already exists with another balance is left untouched (`WALLET_EXISTS_DIFFERENT`); a ledger row this migration did not write stops the run (`WALLET_NOT_EMPTY`); an opening entry from an earlier run that no longer matches stops it
  (`CREDITS_OPENING_CHANGED`: a posted row is immutable, ask for a privileged delete of the old rows).
- **No side effects.** No `event_outbox`, notification, audit, `wallet_events` or `wallet_usage_months` row (the baseline digest and explicit checks hold it at 0); no INSERT trigger exists on any table written (pinned by a test); no global table is written by a client run (the worker login is refused by RLS; a test compares `message_rates`, `plan_message_margins` and `wallet_platform_log` before and after a full run).
- **Partitions.** `ai_token_usage` and `usage_charges` are partitioned: the monthly partitions of the date range are created through `ensure_monthly_partition()` first, with the same privilege check as the inbox (`CREDITS_PARTITION_PRIVILEGE`, no fallback to owner rights); a test proves nothing lands in the `_default` partitions.
- **Idempotent and resumable.** Re-runs skip what `id_map` knows (ledger rows also by their unique idempotency key); a crash rolls back the batch and the checkpoint together; a killed run resumes to exactly the result of a clean one (tested for all three steps, `midBatch` and `afterBatch`).

## Why a historical charge is `free`

Decided from the real schema (`message-billing.service.ts`, `reseller-platform.reader.ts`, `wallet-query.service.ts`): `usage_charges` has no trigger and no link to `wallets`, so writing it cannot debit anything and cannot break the hourly reconcile. But the application treats a `charged` row as money it took: the reseller P&L sums `revenue_minor` and `cost_minor` of `charged` rows, the wallet screen sums
"spent this month", and a late failed-delivery callback (`settleFailed`) REFUNDS a `charged` row into the wallet. None of that is true for a message Waboo billed before the cut-over, and the unit and scale of Waboo's `amount` are unconfirmed. A `free` row with a claimed key (`usage_charge_keys`, status `free`, pointing at the charge) is inert in all three, and a late delivered / failed callback
for the same wamid finds the claimed key and does nothing (no second charge, no refund). Waboo's billed `amount`, `reseller_amount`, `reseller_margin`, `cost`, the `revert` flag, `reverted_at` and `refund_run_id` are kept as exact text in `usage_charges.meta` (`legacy.waboo`). The price of each message is therefore NOT in the credits columns: if the product wants historical revenue in the P&L, that is a
decision (OQ-6) and a different, riskier variant (currency, scale and refund path first). `provider` is written `waba` (unverified), `to_country` NULL (derivable from the phone, not derived); the phone, contact, delivery status and error of those sends are not kept.

## Catch-up after a re-export: `usage-charges-append`

The first load is final for the ledger (a posted row is immutable and carries a `balance_after` computed from the confirmed opening balance), so after a re-export `run` refuses the credits group (`CREDITS_OPENING_CHANGED`) and the catch-up skips it. Everything else of the credits group is append-only history, and that is what this command loads. `wallet-sync` keeps the balance (one adjustment row per snapshot, `wallets.balance` = the geta_core figure); the command below never touches it.

```
node pilot/staging/cycle.cjs usage-charges-append --client iskm            # dry run: the real counts, rolled back
node pilot/staging/cycle.cjs usage-charges-append --client iskm --apply    # the wrapper passes --confirm-org-slug
# direct: $CLI usage-charges-append --client iskm --org-slug <slug> [--skip-hash] [--batch N] [--apply --confirm-org-slug <slug>]
# in the catch-up chain it is the step `usage-append`, after `wallet-sync`
```

- **What it loads.** Only source documents that are not in `migration.id_map`: the non-broadcast rows of `whatsapp_broadcasting_data` -> `usage_charges` + `usage_charge_keys`, and the `credit_logs` documents -> `ai_token_usage` (the second only when the first load ran `credit_tokens`). It runs the very same step specs as the first load (`transform/credits.ts`: `USAGE_FIELDS`, `USAGE_CONSTANTS`), so a row is identical to what a first load would have written: `free`, `credits 0`, `revenue_minor 0`, no wallet link, `category`, `source`, `wamid` key and `created_at` from the source, and Waboo's `amount`, `reseller_amount`, `reseller_margin`, `cost`, `revert` ... as exact text in `meta.legacy.waboo`. The plan (pass 1) is built from the same dump with the recorded workspace switch and the wallet part OFF, so no opening file is read and no ledger arithmetic happens. Why a charge is `free` history and not a ledger posting: see "Why a historical charge is `free`" above; the wallet row came from geta_core, never from these rows.
- **No link to resolve.** A billing-log row is tied to nothing but its `wamid` (campaign, contact, template and delivery fields are `NO_BILL` in `USAGE_FIELDS`; rows of `source = broadcast` with a `broadcast_id` belong to the broadcast step and are not read here). So nothing is looked up in `id_map`: a row that cannot be keyed or dated is a counted quarantine (`NO_MESSAGE_ID`, `NO_DATE`, `BAD_DATE`), a repeated wamid is `DUPLICATE_WAMID` (excluded, counted), a wamid the organization already holds a key for is `UNIQUE_CONFLICT` (quarantined, counted). Nothing is guessed.
- **Never touched, and proven in the same transaction.** `wallet_transactions`, `wallets`, `wallet_events`, `wallet_usage_months`, `event_outbox`, audit, notifications and every org table no bulk step owns are digested (md5 per row, the baseline digest of `load/baseline.ts` plus the two wallet tables) before and after; any difference raises `APPEND_SIDE_EFFECT` and rolls everything back.
- **All or nothing, idempotent.** One transaction for the whole append (`withTenant` inside it is a savepoint, as in `run --dry-run`); the dry run is the same code rolled back, so its counts, partitions and quarantine rows are the real ones. A second run finds every document in `id_map` and inserts nothing. The monthly partitions are ensured first, with the same privilege check as the first load. The quarantine digest is re-recorded; the first load's step rows in `migration.run_log` are re-stamped for the new dump (the `credits` options are not touched) and `_credits / usage-append` records what the last append did (reconcile prints it as `CREDITS APPEND`).
- **Refuses** (nothing written): no manifest or a dump that no longer matches it (`APPEND_DUMP_CHANGED`, unless `--skip-hash`), no organization of this client (`APPEND_NO_ORG`), the `usage_charges` step never ran (`APPEND_NOT_LOADED`: a first load is `run`), no recorded credits switches (`APPEND_NO_OPTIONS`), `--apply` without `--confirm-org-slug`.
- **The verifier.** Documents that load per the dump but are in no `id_map` are one alarm per collection: `IDMAP_MISSING: N whatsapp_broadcasting_data_usage document(s) ... (first keys, per month) ... usage-charges-append loads them` (likewise for `credit_logs_tokens`). After the append the alarm is gone and the existing row-by-row checks (`CREDITS_MISMATCH`, `CHARGE_WITH_MONEY`, `TARGET_MISSING`, `CREDITS_EXTRA_ROWS`, `TOKEN_PARITY`, the keys) cover the new rows with the same independent oracle (`reconcile/oracle-credits.ts` needed no new rule: it already judges the whole dump). The ledger part of the verifier is unchanged and still compares the wallet ledger with the plan of the CURRENT credit-opening file; when that differs from the first load's opening it reports `CREDITS_OPENING_DIFFERS` and the `balance_after` mismatches, which is the known state of a client whose balance is kept by `wallet-sync` (not changed here).
- **Tests.** `test/usage-append.pure.spec.ts` (settings, plan parity with the first load, row parity wallet on/off, inert row, the side-effect guard) and `test/usage-append.spec.ts` (database: dry run writes nothing, apply adds exactly the new charges + keys, ledger / wallet / outbox unchanged, the full reconcile passes, a second run is a no-op, a new `credit_logs` document adds a token row and no ledger row, a client that was never loaded is refused).

## Pricing: `credits_mapping_new` is a platform rate card, written by `pricing-seed` only

`message_rates` and `plan_message_margins` are GLOBAL platform tables (everyone reads, only a privileged session writes). The collection has **no client key** (fields: `name`, `code`, `dial_code`, `short_name`, `whatsapp`, `email`, `sms`, and on iskm two special documents); the iskm and karma profiles carry the same field set and the same 145 country documents (iskm 147 = 145 + a currency /
conversion-rate document + an AI-model document, karma 145), and the `_bak` / `_bkp` copies in each database show it is a rate card copied per database. **Evidence says platform-wide, not per client (OQ-3)**; the prices themselves are masked, so "identical" is not proven: `pricing-seed --client a --compare-with b` prints the key-by-key diff once both dumps exist. So the client run never touches it (registry:
EXCLUDE from the run, the reason names the command), and the command is built to be hard to misuse:

- **Dry run by default**: prints the documents read, the rate rows it would write (country x authentication / marketing / service / utility, `credits` in hundredths of the platform currency), what the table holds now (new / already equal / CONFLICT) and the NOT PRESENT counts. Writes nothing.
- `--apply` needs ALL of: the owner connection (`MIGRATION_DATABASE_URL`, a privileged session), an explicit `--factor` (what 1 Waboo price unit is in the platform currency; the dry run assumes 1 and says so, OQ-2), no conflicts (or `--skip-conflicts`, which writes only the keys that are not there), and a **typed confirmation** (`SEED <n> message_rates <client>`, read from the terminal).
  It **never overwrites**: `INSERT ... ON CONFLICT DO NOTHING`, one transaction, rolled back if any row was not inserted. Provenance: a `wallet_platform_log` row (`rates.import`, the platform's own trail for rate imports) and `migration.run_log` (`_pricing`).
- Rules: `name = other` is the default row (country `''`); `code` must be two letters (a dial code is not unique, none is guessed: `NO_COUNTRY_CODE`); a second document of a country is `DUPLICATE_COUNTRY`; a price that is not a non-negative number is `BAD_PRICE`; above 1,000,000.00 is `PRICE_OVER_LIMIT`; the config document (currency / conversion rate) is reported, the `models[]` document is skipped and its key fields are never read or printed.
- **NOT PRESENT (no table; counted in every report):** email and SMS price and margin per country, dial codes, short names and country names, AI model prices, and Waboo's `margin` of a WhatsApp category (a percentage or an absolute amount per message? the app's margin is basis points on top of Meta's cost, so it is not applied: OQ-4). Proposal: `proposals/pricing-extras.sql` (not applied; recommendation: leave
  them in the raw archive unless email / SMS billing is on the roadmap).

## What reconcile covers now

`reconcile/oracle-credits.ts` is a second implementation (own decimal reader; imports only `reconcile/oracle.ts`; a test pins the import list) and `reconcile/credits.ts` checks, per client: the loader's plan against the oracle (every posting, balance_after, token and usage count, the opening entry: `PLAN_ORACLE_MISMATCH`); every `wallet_transactions` row column by column against the oracle and the opening entry
against the CONFIRMED balance (`CREDITS_MISMATCH`, `TARGET_MISSING`, `CREDITS_EXTRA_ROWS`); the wallet invariants above; the rounding accounting; every `ai_token_usage` row through `id_map` (the table has no source key) and the token sums per month (`TOKEN_PARITY`, extra months included); every `usage_charges` row and its key; extra rows in all five tables scoped to the organization; `wallet_events` /
`wallet_usage_months` empty (`SIDE_EFFECT`); and the generic checks of `reconcile/index.ts` (the equation read = migrated + quarantined + excluded for `credit_logs`, `credit_logs_tokens` and the billing-log usage rows, `id_map` exact both ways, the quarantine digest, `FIELD_UNMAPPED` for a source field nobody mapped, the baseline digest for outbox / audit / notifications ...). The five tables are no longer in the
baseline digest (`BULK_TABLES`). The report's NOT PRESENT section lists: `cached_input_tokens`, the rounding residual, the billing-log fields kept only as text, and the counts of the pricing parts above. `--allow-extra-rows` (after cutover) relaxes exactly the live traffic: extra ledger / token / charge rows, a changed wallet balance; a lost or altered migrated row still fails.

`test/credits-runs.spec.ts` damage cases (every one is caught): change an amount, delete a ledger row, flip a direction, add an extra transaction, change `balance_after`, unbalance the wallet, delete / add a wallet, delete / edit / add / duplicate a token row, add / edit / charge / delete a usage charge, un-key a charge, add an outbox row, a wallet event or a usage month, delete an `id_map` row, delete a quarantine row,
move a ledger row to another unit, read another confirmed balance.

## Measured (invented data, laptop, Docker Postgres 16)

20,000 credit rows (15,000 ledger rows, a quarter under 0.01) + 6,000 billing rows, batch 1,000: load 19 s, reconcile 4 s, a second run that has nothing to do 0.7 s. ISKM (745 credit rows, about 12,900 billing rows): seconds.

## NOT PRESENT (counted in every report; the raw dump is the archive)

`credit_logs`: `cached_input_tokens` has no column in `ai_token_usage` (text in the ledger meta of posted rows only); `new_balance`, `action`, `module`, `cost`, `bot_id` live only in the ledger meta (rows that are not posted keep them in the raw archive); the exact amount of the rows that were rounded or under 0.01 (their text is kept for posted rows; the sum is in the report). Billing log: the billed amounts are
text in `usage_charges.meta`, not in credits / revenue columns; phone, contact, delivery status, error, template and automation bookkeeping are not kept; `to_country` NULL. Pricing: email / SMS prices and margins, dial codes, country names, AI model prices, WhatsApp margins (see above). `credits_expenses` (karma): excluded. The rows of `source = broadcast` carry `amount`, `reseller_amount` and `cost` too: the
broadcast step does not keep them and no charge is written for them (OQ-7).

## UNVERIFIED guesses (confirm on a 50-document unmasked look before the first real run)

- The balance of the Waboo credit pool and its unit: nothing in the dumps holds it. `1 credit = 1 unit of the wallet currency` is assumed only through the file (`currency`), never inferred.
- `credits_mapping_new.whatsapp.<category>` is `{price, margin}` (the profile lists the four category keys, not what is inside); a bare number is read as the price. Anything else is `BAD_PRICE`.
- `type: openai_api` is the only vendor tag; `provider = openai`. A `tokens_used` bigger than input + output includes cached tokens (it is kept as it is; the app's own meter writes `total = prompt + completion`, so the monthly cap counts it).
- `credit_logs` holds only debits (every row is a spend, nothing is inferred from `type` or sign), `user_id` is always null in the pilot data, `workspace_id` is one value per client.
- The billing-log rows with a `message_id` are WhatsApp message ids (58 to 62 characters in the profile); `provider = waba`; a `broadcast` row with no `broadcast_id` is a billing row, not a recipient.
- The time of a credit row is `created_time` (UTC instant); ordering ties are broken by `_id`.
- Waboo `amount` and `reseller_amount` are in the same unit as `credits_deducted` (not needed by the tool, written as text only).
- A zero-priced category (`service`) is a real price of 0, written as a `credits = 0` row.

## Open questions for the manager (my defaults in brackets)

- **OQ-1** Where is the authoritative balance per client, and as of when? [required input `credit-opening.json`, no derived fallback: `new_balance` is not the balance]
- **OQ-2** What is one Waboo credit (currency, scale)? [the file's `currency`; `pricing-seed` needs an explicit `--factor`; the iskm config document says `inr`, rate 88]
- **OQ-3** Is `credits_mapping_new` one platform rate card or per client? [platform-wide (no client key, same 145 country documents); run `--compare-with` on both dumps]
- **OQ-4** May we write the global `message_rates` from this project, and what does Waboo's `margin` mean? [yes, only by the operator command with a typed confirmation; margins are NOT applied; email / SMS / dial codes / model prices stay in the archive]
- **OQ-5** `credits_expenses`: a ledger entry or exclude? [EXCLUDE; a purchase is inside the confirmed balance; if it is a top-up, post it as `topup` before computing the opening]
- **OQ-6** Should historical WhatsApp billing show as revenue in the reseller P&L? [no: written as inert `free` rows with the amounts as text]
- **OQ-7** Do the billed amounts of the rows that ARE broadcast recipients need a charge too? [no: not written]
- **OQ-8** Who confirms the balance and signs `confirmedBy`? [a named person; it is written into the immutable ledger note]

---

# Stage 2: flows and chatbot widgets

**PROGRESS:** built and tested on invented data (`test/flows.spec.ts`, `test/flows-volume.spec.ts`). **Never run against a real dump**: the pilot profiles are masked, so the exact record shapes of `response[]`, the `broadcast_templates` id fields and the AI keys are guesses (list below). Not built: automations (advanced flows, see "Not built"), channel binding of a flow, the API-library re-link, the files behind widget images. No commit, no server, no Mongo was touched. **Nothing in the application schema was changed.**

Team decisions: "flows (Simple->Chatbot)", "No version history" (latest version only), "chatbot" (widgets). `journey` stays EXCLUDE (a cross-check only), `flows_version` is EXCLUDE, RAG (`document_col`) and `chatbot_misc_config` are not touched (this builder never reads `chatbot_misc_config`; a test pins it).

## The model

| Source                                                                                      | Target                                                                      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every `botid` of the dump (derived, step `flow_bots`)                                       | `flows`                                                                     | one row per bot, the converter output of the latest version: `flow_data` (normalised graph), `trigger_*` from the trigger step, `category` `Waboo chatbot`, `provider` `waba`, `flow_type` `chat`, dates from the version. **`is_published` false AND `is_active` false (the API default for `is_active` is true: overridden), `published_at` NULL, no channel bound**                                                          |
| `chatbots`, `flows` (headers), `bot_flow_version`, `bot_flow_version_data`, `bot_workspace` | adopted into the bot's flow (id_map of both keys points at it), or excluded | excluded and counted: `OLDER_VERSION`, `WORKSPACE_NOT_USED`, `DUPLICATE_NODE`, `OPT_IN_OUT` (subscription settings, not flows), `UNSUPPORTED_STEP`, `EMPTY_INTENT`, `BOT_NOT_IMPORTED`, `WEB_BOT_NO_FLOW`, `SOFT_DELETED`, `BOT_INACTIVE`, `NO_NODES`, `OTHER_CHANNEL_NO_FLOW`; quarantined: `NO_BOT_ID`, `BAD_NODE`, `UNKNOWN_TYPE`, `SECRET_IN_FLOW`, `GRAPH_TOO_LARGE`, `GRAPH_INVALID`, `CONVERSION_MISMATCH`, `PLAN_LIMIT` |
| `faq_variations`                                                                            | `keyword_replies`                                                           | `reply_type flow`, `flow_id` the bot's flow, `matching_method exact`, `status` FALSE, no `keyword_reply_contents`; the phrases comma-joined, split into rows of at most 255 characters                                                                                                                                                                                                                                          |
| `chatbots` + `chatbot_configuration` + `chatbot_theme`                                      | `chatbot_widgets` (+ `ai_chat_assistants`)                                  | ONE widget row per website bot or bot with a `whatsapp_number`; the configuration and theme documents are adopted into it or excluded `NO_WIDGET`; the AI part (model, prompt, temperature) becomes a PAUSED assistant                                                                                                                                                                                                          |

Order: org -> ... -> `flow_bots` -> headers / versions / nodes / workspace -> `faq_replies` -> `widget_assistants` -> `widgets` -> `chatbots` -> `widget_config` / `widget_theme`. Pass 1 (`flows/plan.ts`) reads the dump once, before the first row, and gives every document its verdict; the steps only look the verdict up. No UPDATE after insert (`touch_row` would bump `updated_at` and `row_version`). Engine changes this needed (all optional hooks): `Outcome` kind `adopt` may point at `flows` / `chatbot_widgets` by uuid, `HandlerSpec.read` receives the run context, `HandlerSpec.shaCollections` (a derived step's done-detection hashes every collection it reads).

## Commands and flags

```bash
$CLI run       --client iskm --org-name ISKM --owner-email a@b.c [--flow-version published|draft|newest] [--widgets-for-whatsapp-bots]
$CLI run       --client iskm ... --dry-run                 # prints "flows: N bot(s) ... plan {...}", rolls everything back
$CLI reconcile --client iskm --out out                     # reads the switches the run recorded (`_flows` / `options`)
$CLI automation-profile --client iskm                      # READ-ONLY: distinct (type, class, function, shapeId) of automation nodes, names and counts only
```

| Flag                          | Default            | Meaning                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--flow-version`              | `published`        | Q1. `published`: the published version (newest `publishedAt`), else the newest version of any status, else the `bot_workspace` draft. `draft`: the draft first. `newest`: the newest version of any status, else the draft. Passed-over versions and a non-published choice are soft issues (`VERSION_EMPTY`, `NO_PUBLISHED_VERSION`, `VERSION_AMBIGUOUS`) |
| `--widgets-for-whatsapp-bots` | off                | Q7. A WhatsApp bot with widget settings but no `whatsapp_number` also gets a widget                                                                                                                                                                                                                                                                        |
| (plan caps)                   | read from the plan | Q15. `plans.limits.flows` / `chatbot_widgets` (override first): the overflow is quarantined `PLAN_LIMIT`, never inserted past the cap. The values used are recorded and reconcile reads them                                                                                                                                                               |

## Safety rules

- Imported flows are unpublished AND inactive, always. Every consumer was read: `trigger.service` (`keywordFlow`, `liveConfigured`, enrolment), `schedule.sweeper.tickOnce`, `flow-reader`, the admin overview counters and the partial index `idx_flows_live_trigger` all select on `is_published AND is_active`. `trigger_channel_id` / `trigger_device_id` / `trigger_last_occurrence` stay NULL. No `flow_runs`, `flow_run_steps`, `flow_subscribers`, `flb_geta_publish_syncs`, `event_outbox`, notification, audit or webhook row is written.
- Keyword replies are imported with `status` false (the only reader in the app today is the translation fan-out, which scans every rule and never sends; it may stamp translations on them later).
- Widgets are imported `paused` (the public routes answer only `active`) with the allow-list `["migration-import.invalid"]`: **an EMPTY allow-list answers every origin** (`originAllowed`), so it is never left empty. The embed token is generated fresh at insert time from a CSPRNG (48 characters of `[A-Za-z0-9]`, WaDesk's `Str::random(48)`), never derived from the bot id (that id is public in the old embed snippet) and never copied; **the embed snippet on the client's site must be replaced at cutover**. The assistant is paused.
- Secrets: `ai_configuration.normalKey` / `openRouterKey` (a key with a trailing space, `"ai_configuration "`, exists at the source and is read too) are never copied; the prompt goes through `redactText`; a flow step whose text looks like a credential stops that flow (`SECRET_IN_FLOW`). Reconcile searches `chatbot_widgets`, `ai_chat_assistants`, `flows` and `migration.quarantine` for every key value of the dump.
- **Reconcile's safety check runs the consumers' own predicates over the loaded rows and expects zero hits** (`SENDABLE_FLOW`, `SENDABLE_KEYWORD`, `SENDABLE_WIDGET`, `SENDABLE_ASSISTANT`, `SIDE_EFFECT`); `--allow-extra-rows` (after cutover) relaxes exactly what people change in the app.

## What reconcile covers now

`reconcile/oracle-flows.ts` is a second implementation (imports nothing from `transform/`, `flows/` or `load/`, and does not run the converter) and `reconcile/flows.ts` checks, per client: the loader's plan against the oracle, bot by bot (verdict, steps, links, name, trigger words, widgets, FAQ rows, the node collection counted by reason); every loaded flow in the target: the graph is re-derived from the node records (**step count, link count, steps with no way in, one trigger and it is the start, every link lands on a step, the trigger leads to the right step, every source step present exactly once**), no template id where a name belongs, no credential, name / keywords / dates / category / provider; the keyword rows against the phrases; every widget column against the oracle, token shape and uniqueness, the closed allow-list; the safety probes above; extra rows (`flows`, `keyword_replies`, `chatbot_widgets`, `ai_chat_assistants` by uuid set; `keyword_reply_contents` and every run / subscriber / log table must be empty); id_map both ways, the quarantine digest and the equation (generic); the soft issues owed by the loaded rows; `ADOPT_TARGET_MISSING` is an alarm. `test/flows.spec.ts` damage cases (every one is caught): delete a flow, switch one to active, publish one, change a step, drop a link, add an extra flow, arm a trigger, change a widget colour, activate a widget, open its allow-list, shorten its token, activate / delete a keyword reply, add a keyword content, add an outbox row, put an AI key into an assistant, delete an id_map row, delete the soft-issue log. `test/flows.spec.ts` also pins the vendored converter to the web importer byte for byte (a drift test: it FAILS when `apps/web/.../wabo-import.ts` changes; re-copy the body of `flows/wabo-convert.ts`).

## Lost / NOT PRESENT (counted in every report, per flow in `migration.quarantine` `CONVERSION_LOSS`; the raw dump is the archive)

Quick actions; API actions (the Waboo `apiLibraryId`s they pointed at are listed in `CONVERSION_LOSS.apiLibraryIds`); template variables; every response after the first of a step; other languages; link buttons (a live-agent button becomes an `assign` step in exact mode, other kinds stay a button without a target); header images and texts are kept raw in the step but the editor may not show them (UNVERIFIED); list-row descriptions; steps of a subType the converter has no step for (karma: `button` 46, `phone-number` 3: `UNSUPPORTED_STEP`); opt-in / opt-out messages (subscription settings, Q9); trigger words of journeys other than the first (only the first flow's words become the trigger); journey names from the `flows` headers (only Intent / FAQ names are used); `trigger_channel_id` (bind a channel before publishing). Widgets: `active_timings`, `banned_users`, `canned_responses`, `consent_*`, OTP flags, `quick_menu`, `banner_carousel`, `notification_block`, `message_tone`, `default_messages`, `urls`, notifications ... (key NAMES per widget in `CONFIG_NOT_PRESENT`); theme font / hover / gradient / styles; images that are file references (`FILE_REF_PENDING`, the files builder); `selectedProducts`; multi-language. Templates are not migrated: a template step carries the template NAME where `broadcast_templates` gives one, empty otherwise, and every such flow has the soft issue `TEMPLATE_UNRESOLVED` (the flow still loads, inactive).

## Not built

- **Automations (advanced flows)**: built since, see "Stage 2: advanced automations" below (steps `automation_flows` / `automation_nodes`).
- **API actions**: the new `api-library` flow node (merge 4ea4deb5, table `api_library_apis`) needs the uuid of a migrated library API and has success / error ports; a Waboo action is a side-action of a step. The Waboo `api_library` collection is not migrated yet (its target is now `api_library_apis`; secret headers and function code need the encrypted-credential path, a later builder). So API actions stay a counted loss with their library ids; no flag, no schema change.
- Channel binding of a flow, `chatbot_misc_config` and channel credentials, `ai_provider_keys`, files behind widget images, `visitor_logs`, the opt-in / opt-out keyword rows (karma `workspace_settings`).

## UNVERIFIED guesses (confirm on a 50-document unmasked look)

- `response[0]` shapes beyond what `wabo-import.ts` reads, the `variables` / `components` keys of a template response, the fields of `broadcast_templates` that carry the template id (`id`, `_id`, `meta_template_id`, `template_id` are all tried) and its `name`.
- `version_id` on `flows` headers and on nodes (karma 54% / 37%): a node without it is "unversioned", a version id with no header is an "orphan version"; both rank after the versions that have a header.
- `chatbots.channel` words: `web` / `site` / `widget` = website, `whatsapp` or missing = WhatsApp, anything else has no flow. `is_active false` means "switched off" (`BOT_INACTIVE`).
- `desktop_auto_triggering` is read as `auto_open`; `button.background` / `button.text` are hex colours; `target_whatsapp_number` is stored whole (digits with the country code) and `target_whatsapp_cc` is NULL because a country code cannot be split safely.
- A FAQ phrase list is matched `exact`; `faq_variations.qid` cannot address a journey inside a flow, so the (inactive) reply starts the whole flow (`QID_NOT_ADDRESSABLE`).
- The default trigger word `hi` is the converter's, used when no Intent / FAQ word exists (`DEFAULT_TRIGGER_WORD`).
- Plan caps are read from `plans.limits` keys `flows` and `chatbot_widgets` (override first).

## Open questions for the manager (my defaults are in the flags above)

**Q1** Which version is "latest"? Default: the **published** version, else the newest, else the draft (`--flow-version`). **Q4** Automations now? Default: **no**, run `automation-profile` first. **Q7** A WhatsApp bot with widget settings: a widget? Default: **no** unless it has a `whatsapp_number` (`--widgets-for-whatsapp-bots`). **Q14** Templates: `broadcast_templates` is excluded, so template steps keep a name and wait for the Meta re-sync; settle the name match (name + language, or `meta_template_id`) before flows are published. **Q15** Plan caps: the loader quarantines `PLAN_LIMIT` instead of exceeding them. Also: who replaces the embed snippet of each widget at cutover, and who binds a channel and publishes each flow (nothing is live until a person does).

## Measured (invented data, laptop, Docker Postgres 16)

300 bots x 20 steps (6,000 step documents, 300 FAQ rows), batch 100: load about 8 s, a second run 0.2 s, reconcile about 20 s. Invented acme dump: 18 step documents -> 10 adopted, 1 quarantined, 7 excluded; 4 flows, 3 keyword rows, 2 widgets, 1 assistant.

## Dates written as "dd Mon, yyyy h:mm:ss AM" (Karma, Rhythm Watches)

Steps and versions carry a mix of BSON dates and this display string (day not zero padded, English month, AM/PM, no zone). The flow and widget steps read it as **UTC** (never in the machine's zone) and add the soft issue `DATE_ZONE_ASSUMED` to the flow; an unreadable date falls back to the next source and finally to the manifest time with `NO_DATE`; nothing throws. `chatbots.prompt` and the AI settings of `chatbot_configuration` are optional (a bot without them loads, with no assistant). `test/flows.spec.ts` pins both.

# Running some steps only (`--steps`, `--skip-steps`, `steps`)

To load features into staging one at a time, and to keep a failing feature from blocking the others:

```bash
$CLI steps                                                  # READ-ONLY: every step in load order with what it needs
$CLI run --client iskm --steps fields,access                # the organization is always ensured first (idempotent)
$CLI run --client iskm --steps contacts,group_members,notes
$CLI run --client iskm --steps broadcasts,credits --skip-steps usage_charges
$CLI run --client iskm --steps flows                        # flows need nothing from contacts
$CLI reconcile --client iskm                                # steps that never ran are listed as NOT RUN
```

Names are the handler names of `steps`, or a group: `access` (roles, users), `fields` (the dictionaries: property sections / definitions / options / dependencies, lifecycle, tags, lists, undeclared fields), `broadcasts`, `credits`, `flows` (flows, widgets, FAQ rows), `chat` (inbox). Rules:

- An unknown name is refused before anything is written (not even the organization).
- A selected step whose prerequisite is neither selected, nor already loaded for this client (a `migration.run_log` row of that step), nor absent from the dump, is refused naming it (`contacts needs users`). Example needs: contacts need the dictionaries, lifecycle, the undeclared-field step and users (owner resolution); inbox needs contacts (and the channel map); campaigns need contacts; credits need `credit-opening.json` (checked only when a credit step is selected); flows need nothing from contacts.
- The configuration a step needs (the channel map, the opening balance) is demanded only when that step is selected.
- The run records its selection in `migration.run_log` (`_steps`); a later `run` (with or without `--steps`) continues: steps already done are skipped by their own checkpoints, so staged and all-at-once runs end in the same state (tested: identical row counts, id_map digest and quarantine digest for the people + broadcasts + flows, the chat, and the credits).
- `reconcile` verifies the steps that ran in full (equation, per-column compare, extra-row checks of their tables) and lists the others under `## NOT RUN`; their collections show the disposition NOT RUN (not unaccounted, not an alarm). Their tables are in the bulk list (no baseline digest), so a step that has not run cannot alarm. A client loaded before this feature (no `_steps` record) counts as fully run.

---

# Stage 2: lead data

**PROGRESS:** built and tested on invented data (`test/leads.spec.ts`, 31 tests, 17 of them damage cases). `contact_attribution` was analysed on the REAL staging dumps (ISKM 4,542, Rhythm 2,253). **`leadrepo`, `leads` and `source_registry` were NOT exported** (the Waboo jump host key check failed and nothing was bypassed): their mapping is built from the masked profiles in `_work/migration/discovery`, and every statement about their real shapes is UNVERIFIED (list below). No commit, nothing was written to a real database, no Mongo was touched.
Team decision: "leads-ignore for now" was reversed by the user ("lead repo and all others are on hold ... make this remaining part as well").

## The collections and what they become

| Source | Target | Rule |
| --- | --- | --- |
| (derived) one document per lead collection present in the dump (`leadrepo`, `leads`), step `lead_sources` | `lead_sources` | ONE inert row each: `kind connector`, `provider_key waboo`, `status paused`, name `Waboo import: <collection>`, `external_ref waboo:<client>:<collection>`, **no token hash, no secret**, empty mapping and defaults, `raw_retention_days 365`. (A `kind webhook` source needs a token hash; a connector does not.) They count against the plan's `lead_sources` cap: two rows |
| `leadrepo` (step `lead_events`) | `lead_events` | one row per document. `external_id = leadrepo:<_id hex>` (the idempotency key `(org, source, external_id)`), `status created` (finished), `is_test false`, `contact_id` through `id_map` (string id or ObjectId, as notes and recipients resolve), no deal. `received_at = created_at = createdAt` (else the ObjectId time, else the manifest time), `updated_at = processed_at = updatedAt` (never before created: soft `DATES_SWAPPED`). `payload = { externalId, fields, attribution, device, legacy.waboo }`, scrubbed: **every key that is not a system, session, campaign or device key is a form answer and goes to `payload.fields`** (the dynamic per-client keys: event names, attendee counts, volunteer flags ...); `campaignMedium/Name/Source, source, channel, module, entry_point` go to `payload.attribution`; browser / city / country / referrer ... to `payload.device`; `session_id / botid / module_id` to `payload.legacy.waboo`. Null and empty values are dropped. A credential-named or credential-shaped key or value never reaches the payload (the shared `scrub`). `payload_expires_at` = manifest time + 365 days |
| `leads` (step `lead_events_leads`) | `lead_events` | **decided from the profile that it overlaps leadrepo** (same keys; the WhatsApp part of leadrepo carries `botid` + `module_id` like every `leads` row; leadrepo 13,025 vs leads 1,970 on ISKM, about 1,700 each on Rhythm). A `leads` document whose `session_id` is in leadrepo is excluded `DUPLICATE_OF_LEADREPO`; every other one loads like a leadrepo document under its own source (`external_id leads:<_id>`). The duplicate test is a marker added by the step's stream, so the loader and the verifier decide identically. If the overlap is total, `leads` adds nothing; if it is nil, all of it loads |
| `contact_attribution` (step `attributions`) | `contact_attributions` | one row per document, **the first touch only**: `platform = first_touch.platform`, `source_label = first_touch.source` (NOT NULL; else platform, else channel, else quarantine `NO_SOURCE_LABEL`), `campaign = first_touch.raw_utm_campaign`, `form = first_touch.module_name`, `captured_at = created_at = first_touch.captured_at` (else the document's `created_at`). `lead_event_id`, `source_id`, `adset`, `ad` stay NULL. The table is append-only (trigger): rows are only inserted |
| `medium_registry` (24), `source_registry` (26) | nothing | EXCLUDE: `lead_sources` are ingest doors, not a dictionary of UTM values, and every `first_touch.medium_registry_id` / `source_registry_id` is null on the real data |
| `contact_attribution_audit_log` | nothing | EXCLUDE (history of changes, unchanged) |

Missing contact: a lead or attribution with no `contact_id` is quarantined `NO_CONTACT_ID`; one whose contact is not migrated is `CONTACT_NOT_MIGRATED` (nothing is created for it; the raw document stays in the quarantine row and in the archive); one whose contact is soft-deleted at the source is excluded `PARENT_EXCLUDED`. No contact is ever created from a lead, and a phone is not used to guess a contact (a possible later option, as for chat).

## Real shapes found (contact_attribution, ISKM and Rhythm)

Keys: `_id, contact_id (ObjectId), source, channel, platform, module_name, module_type, first_touch (object), created_at, updated_at` (BSON dates). `first_touch`: `source, channel, platform, module_name, module_type, captured_at` plus nine keys that are null on EVERY document (`medium_registry_id, source_registry_id, raw_utm_source / medium / campaign / content / term`). One document per contact (at most one), no soft-delete flag. ISKM platforms: Geta (Import), WhatsApp (WhatsApp Direct) and seven landing pages / webhooks; Rhythm: Google Sheets (Integration), WhatsApp, Geta (Manual). The top-level touch differs from `first_touch` on about 1,052 of 4,542 (ISKM) and 657 of 2,253 (Rhythm) documents: the top level is the current touch, `first_touch` the first. 4,538 of 4,542 (ISKM) and 2,252 of 2,253 (Rhythm) contact ids exist in `contact_list`; none is deleted.

## Why imported history is inert (every trigger and consumer read)

- No INSERT trigger exists on `lead_sources`, `lead_events` or `contact_attributions` (only BEFORE UPDATE: `touch_row`, the cursor-aware source touch, the attribution append-only guard). The outbox events (`lead.created` / `lead.updated`, `contact.created` for flow enrolment) and the lead notifications are written by `LeadIngestService` inside its own transaction; this tool never calls it and writes no `event_outbox`, `notifications` or audit row (the baseline digest and `SIDE_EFFECT` hold it at 0).
- The only code that re-processes a stored event is the retry: `claim` reclaims a `failed` or stale `received` event, the admin retry takes `needs_review` / `failed` and refuses a paused source. Imported events are `created`, on a paused source with no token, so none of those paths can pick them up (`SENDABLE_LEAD`, `LIVE_SOURCE` check it in SQL).
- The retention sweep nulls `payload` after `payload_expires_at`: set to 365 days after the dump (the table's maximum), after which the app purges the form answers like any lead payload.
- `lead_events` has no plan cap; `lead_sources` is capped by the plan: two rows per client.

## Run it

```bash
$CLI steps                                             # lead_sources, lead_events, lead_events_leads, attributions; group "leads"
$CLI run --client iskm --steps leads --dry-run         # contacts must already be loaded; rolls back
$CLI run --client iskm --steps leads
$CLI reconcile --client iskm --out out
```

Order: `... contacts -> ... -> credits -> lead_sources -> lead_events -> lead_events_leads -> attributions -> inbox`. Needs: events need `contacts` and `lead_sources`; attributions need `contacts`. Idempotent (deterministic uuids `uuidv5(client|<collection>|<_id>)`, `id_map`, ON CONFLICT DO NOTHING), batched (`--batch`, default 1,000), resumable (checkpoint and rows in one transaction), a dry run rolls back.

## What reconcile covers

`reconcile/oracle-leads.ts` is a second implementation (imports only the hash and the shared scrub of `util.ts` and `reconcile/oracle.ts`; nothing from `transform/` or `load/`) and `reconcile/leads.ts` checks per client: the equation read = migrated + quarantined + excluded (generic), every document's verdict and hard quarantine code against the oracle, EVERY column of every `lead_sources`, `lead_events` (payload included) and `contact_attributions` row, the contact and source each row points at, the defaults of the columns the loader never writes, rows nobody accounts for (`EXTRA_ROWS`) and lost rows (`TARGET_MISSING`), `id_map` both ways (generic), the safety predicates (`SENDABLE_LEAD`, `LIVE_SOURCE`, `LEAD_NO_RETENTION`, `ATTRIBUTION_LINKED`, `SIDE_EFFECT`: no `lead.*` outbox event or lead notification) and the NOT PRESENT section. The three tables left the baseline digest (`BULK_TABLES`); the outbox, notifications and audit stay in it. `--allow-extra-rows` relaxes the extra-row checks only.
`test/leads.spec.ts` damage cases (all caught): delete an event, status `failed`, change the payload, another contact, another source, an activated source, a source with a token, a purged retention clock, a duplicated event, an extra source, an outbox row, a changed / linked / deleted / extra attribution, a deleted `id_map` row. Also covered: dry run writes nothing, idempotent rerun (with and without `--force`), kill between batches and inside a batch resumes to the clean result, `--steps leads` alone, missing contact / deleted contact / no contact id, a repeated primary key, dynamic keys with a secret scrubbed, BSON / ISO / epoch / unreadable dates.

## NOT PRESENT (counted in the report)

`first_touch.channel`, `.module_type`, top-level `channel` / `module_type` and the nine always-null keys (no column in `contact_attributions`); `adset` / `ad` (no Waboo field); the current touch when it differs (soft `LATEST_TOUCH_DIFFERS`); `deal_id`, `reason`, `error` of events (Waboo leads carry none); credential-looking keys of an event (names only, never values).

## UNVERIFIED guesses (confirm after the export)

1. **leadrepo and leads were not exported.** Every shape above is from the masked profile (300 sampled documents). `contact_id` is a 16-character STRING there, assumed to equal `contact_list.id` and resolved through `id_map`; if it is not, every row is `CONTACT_NOT_MIGRATED` and the dry run shows it at once. `createdAt` is missing on 13% of leadrepo (ObjectId time used).
2. `leads` overlaps leadrepo by `session_id`. Unknown until both are exported (the dry run prints the excluded count).
3. `status created` is the right "finished" value for history (the app has no import status); an imported lead looks like a live one in the UI.
4. `first_touch.module_name` is the lead form name (`form`); `first_touch.platform` the platform and `first_touch.source` the source label.
5. The 365-day payload clock is acceptable: the form answers disappear a year after the dump.
6. A paused `kind connector` source with no token is valid for every screen that lists sources (the editor may ask for a token when someone resumes it: do not resume).
7. `contacts.source` is left as the contacts step wrote it.

## Export still needed (the main conversation, once the jump host key is confirmed)

```bash
node D:\wadesk-vedant\db-migration\geta-mongodb-read-replica-prod\geta-mongodb-read-replica-prod\bin\mongo-export.cjs --db tattvavit_das_GJdvpcDL_CWDi --client iskm --to-ssh --i-confirm-server-is-staging --collections leadrepo,leads,source_registry --i-know-what-i-am-doing --reason 'lead data migration per user instruction (leadrepo, leads, source registry)'
node ...mongo-export.cjs --db www_rhythmwatches_in_WfEg6ZrU --client rhythm (same flags and collections)
```

Then `manifest --client X`, `run --client X --steps leads --dry-run` and read the counts: `DUPLICATE_OF_LEADREPO` (the overlap), `CONTACT_NOT_MIGRATED` / `NO_CONTACT_ID` (the contact link), and the dynamic keys listed as `stored-in-data`. The staging dump directory must then hold `leadrepo.ndjson`, `leads.ndjson`, `source_registry.ndjson` next to the others (the registry already lists them, so `coverage` stays clean either way).

## Questions for the manager

LQ1 Is `created` acceptable for imported history, or does the product want an import marker on `lead_events`? LQ2 Should imported form answers expire after a year (retention sweep), or does history need no expiry (a schema decision)? LQ3 Import the current (latest) touch as a second attribution row when it differs from the first (about a quarter of the contacts)? LQ4 Leads without a contact (35% of `leads`): quarantined today; is a phone match wanted? LQ5 Is a channel column wanted on `contact_attributions`?

# Stage 2: advanced automations

**PROGRESS:** built and tested on invented data that mirrors the SHAPES of the real staging dumps (`test/automation-convert.pure.spec.ts`: converter and plan, no database; `test/automation.spec.ts`: the load, the verifier and its damage cases, Postgres). The node types below were read from the real dumps on the staging server (`/opt/desk/migration/dumps/{iskm,rhythm}`, read-only; key names, types, node type names and counts only, never a value). **Not yet loaded from the real dumps** (the main conversation runs the loads). The Waboo `shapes` catalogue could NOT be exported (the jump host key check failed and was not bypassed): node types were derived from the automation documents themselves, see "UNVERIFIED".

Team decisions: "(advance -> Automation)" and "flows both simple and advanced need to be covered"; `automation_version`, `automation_node_version`, `node_execution_history` stay EXCLUDE (no history), `shapes` stays EXCLUDE (a UI shape library).

## How the two collections relate (read on the real data)

- `automation_metadata` is the DEFINITION: one document per automation with `nodes` (a map `nodeId -> {type, class, function, edges[{port, to, class, function}], nodeObjectData}`), `triggerObjects` (the trigger node ids, always one), `uiObject.cells` (a JointJS layout: `cells[].id` is the node id, `position` x / y; the links are `standard.Link` cells), `status` (`published` / `unpublished`), `is_active`, `version`, run counters (`enteredCount`, `activeCount`, `finishedCount`, `failedCount`, `goalCount`). 11 documents on iskm (2 are empty drafts), 5 on rhythm; every automationId is unique.
- `automation_journey` is the RUNTIME COPY: one row per node of the same graph (`nodeId`, `automationId`, `type`, `class`, `function`, `shapeId`, `edges`, `nodeObjectData`), plus rows the runtime adds: under every `whatsapp.send` the event triggers `sent` / `delivered` / `failed` and under every `delay.add` a `delay.completed`, each with `parent_nodeId` = the send / delay node (the definition holds them as the OUTPUT PORTS `sent`, `delivered`, `failed`, `afterDelay`). iskm: 17 rows = exactly the definition's nodes of its 8 published automations; rhythm: 61 rows = 38 definition nodes + 23 event rows. A send row also carries `child_node`, `pedges`, `events` (runtime bookkeeping).
- So **the graph is converted from the definition**. A journey row is adopted into the flow (id_map points at it) when the definition holds that node with the same class and function, excluded `DERIVED_EVENT_NODE` for the runtime's event triggers, and quarantined (`NO_DEFINITION`, `NOT_IN_DEFINITION`, `JOURNEY_DIVERGES`, `NO_NODE_ID`, `NO_AUTOMATION_ID`) otherwise. Nothing is rebuilt from the journey alone (rows without a definition are a counted quarantine; the raw dump is the archive).

## Node types found (counts)

| type | class . function | iskm definition | rhythm definition | iskm journey rows | rhythm journey rows |
| --- | --- | ---: | ---: | ---: | ---: |
| trigger | contact . field_match | 6 | 1 | 6 | 1 |
| trigger | Datematch . date_match | 2 | 0 | 2 | 0 |
| trigger | contact . added_to_list | 1 | 0 | 0 | 0 |
| trigger | google . google_sheet_events | 0 | 4 | 0 | 4 |
| trigger | whatsapp . sent / delivered / failed and delay . completed (runtime event rows) | 0 | 0 | 0 | 10 / 7 / 3 / 3 |
| condition | contact . query | 1 | 3 | 1 | 3 |
| condition | google . google_sheet_query | 0 | 6 | 0 | 6 |
| condition | list . query | 1 | 0 | 0 | 0 |
| action | whatsapp . send | 9 | 10 | 8 | 10 |
| action | contact . update | 0 | 4 | 0 | 4 |
| action | list . add | 0 | 3 | 0 | 3 |
| action | delay . add | 0 | 3 | 0 | 3 |
| action | google . save_contact_from_sheet | 0 | 4 | 0 | 4 |
| **total** | | **20** | **38** | **17** | **61** |

(iskm: the 3 nodes of the one unpublished draft that has nodes have no journey row, hence 20 definition nodes and 17 journey rows.) Ports on the edges (where an edge leaves a node): field_match `field_match`, date_match `date_match`, added_to_list `added_to_list`, google_sheet_events `row_added_or_updated`, the condition nodes `true` (there is NO false port: the automation stops), send `sent` / `delivered` / `failed` (a port may carry several edges: rhythm sends have two `sent` edges), delay `afterDelay`, save_contact_from_sheet `saved`. Field names, list ids and rule values are customer configuration and are not listed.

## The node mapping (every real node type)

`automation/convert.ts` (`MAPPING`; the pure test pins that every row of the table above is in it). **mapped** = same behaviour, **approximated** = the WaDesk node exists but not every setting, **unsupported** = an inert placeholder.

| Waboo (type . class . function) | WaDesk node | status | what is lost or assumed |
| --- | --- | --- | --- |
| trigger . contact . field_match | trigger kind `field_match` {field, operator, value} | mapped | only for ONE rule with a supported operator (`=`, `!=`, `contains`, `doesNotContain`, `beginsWith`, `endsWith`, `>`, `<`, `notNull`, `null`); several rules, OR, NOT or another operator: a `manual_enroll` trigger followed by a Condition that holds the WHOLE query (`TRIGGER_NOT_ARMABLE`, approximated: it cannot fire by itself) |
| trigger . Datematch . date_match | trigger kind `date_field_match` {field, direction, days, time, yearly} | approximated | `date_of_execution` before / after = direction, `execution_offset` read as DAYS, `execution_time` "11:00 AM" becomes `11:00`, `execution_cycle` "once" = not yearly (`DATE_SEMANTICS_ASSUMED`) |
| trigger . contact . added_to_list | trigger kind `group_join` {groupId} | mapped | the list through `id_map` (`marketing_list`); `flows.trigger_value` = the group id. Not in id_map: empty (`LIST_UNRESOLVED`) |
| trigger . google . google_sheet_events | trigger kind `manual_enroll` placeholder | unsupported | WaDesk has no "sheet row added or updated" trigger; sheet id / name / column stay in `data._waboo.config` |
| condition . contact . query | `condition` {conditions, operators} | mapped | AND / OR; a nested group becomes `conditionGroup`; `not` swaps `yes` / `no` (the Waboo `true` port leaves from `no`); operators `>=`, `<=`, `in`, `between` ... have no name in the runtime and never match (`OPERATOR_UNSUPPORTED`); `mongodb_query` is the machine copy of `filter_query` and is not kept (`MONGO_QUERY_DROPPED`) |
| condition . google . google_sheet_query | `condition` | approximated | read as a filter over CONTACT fields (UNVERIFIED: it may refer to sheet columns) |
| condition . list . query | `in_list` {listId} | mapped | the list through `id_map`; the Waboo `true` port is `yes`, there is no `no` edge |
| action . whatsapp . send | `template` {tpl: NAME} | approximated | the template NAME from `broadcast_templates` (empty when unknown, `TEMPLATE_UNRESOLVED`); body / header variables (`TEMPLATE_VARIABLES_LOST`) and URL / phone button parameters (`TEMPLATE_BUTTONS_LOST`) are lost; `sent` goes to `out`; **`delivered` and `failed` have no WaDesk event: their successors hang behind an inert node nobody reaches** (`EVENT_BRANCH_DETACHED`, counted per edge) |
| action . contact . update | one `update_contact` {field, value} per field, chained | mapped | `fields[i]` = `{<property>: {label, template, uiObject}}`; the value is the template text as written (merge-tag syntax assumed equal, UNVERIFIED) |
| action . list . add | `list_member` {action add, listId} | mapped | the list through `id_map` |
| action . delay . add | `delay` {amount, unit} | approximated | the number is read as SECONDS (86400 = 1 day, shown in the largest exact unit; UNVERIFIED, `DELAY_UNIT_ASSUMED`); `afterDelay` goes to `out` |
| action . google . save_contact_from_sheet | `sheet_contact` {sheetId, tabName, matchColumn, matchValue `{{phone}}`, map} | approximated | sheet id, tab, primary column, column -> contact field map; the Google account, `actionType` (create / update) and static values are lost (`SHEET_DETAILS_LOST`) |
| any other type / class / function | inert placeholder | unsupported | trigger: `manual_enroll`; action: an `update_contact` with NO field (the runtime skips it and goes on); condition: a `condition` with no rules (always `no`). `data._waboo` keeps `{id, type, class, function, placeholder, config}`, the config scrubbed by the shared `scrub` and capped (`CONFIG_TRUNCATED`) |
| a second or further trigger | placeholder as above | unsupported | WaDesk has ONE trigger per flow (`EXTRA_TRIGGER`) |
| no trigger node | a `manual_enroll` trigger is added, wired to the first node nothing points at | | `NO_TRIGGER` |

Other rules: node ids are `n_` + the first 12 characters of the Waboo id (the whole id on a clash); positions come from `uiObject.cells[id].position`, a grid for a node without one (`LAYOUT_MISSING`); a link to a node that is not in the map is dropped (`DANGLING_EDGES_DROPPED`); the runtime follows only the FIRST edge of a port (`runtime-graph.ts`), so extra edges are kept but flagged (`FAN_OUT_FIRST_ONLY`); a cycle is reported (`CYCLE_PRESENT`); more than 500 nodes or 2000 links is quarantined `GRAPH_TOO_LARGE` (the editor's own limits); the graph goes through the shared `scrub` (`SECRET_SCRUBBED`). Every flow gets `AUTOMATION_STATE` (status, was-active, version and the run counters, which have no column) and, when anything was lost, ONE `CONVERSION_LOSS` soft issue with the count per kind.

## The flows

One `flows` row per `automation_metadata` document (step `automation_flows`): `category` "Waboo automation", `provider` `waba`, `flow_type` `chat`, `flow_name` = the name, dates from `createdOn` / `updatedOn`, `flow_data` = `{flowNodes, flowEdges, vars, waboo: {source, status, wasActive, version, description}}`, `trigger_kind` / `trigger_config` from the shared `flbExtractTrigger` (the function the builder's save uses). Latest document per `automationId` (`OLDER_DUPLICATE`), empty drafts `NO_NODES`, deleted `SOFT_DELETED`. Step `automation_nodes` handles the journey rows. `id_map`: the `_id` and the `automationId` of the definition and every adopted journey row point at the flow. It needs the lists (the `groups` step): `--steps automations` alone is refused.

## Safety (checked against the consumers, like the simple flows)

**`is_published` false AND `is_active` false, always** (the API default for `is_active` is true: overridden; the source says published + active for most automations, that only survives in `flow_data.waboo`). Consumers read: `trigger.service` (`keywordFlow`, `liveConfigured`, `enrolLive`: `is_published AND is_active`), `schedule.sweeper` (`is_published AND is_active AND trigger_kind IN ('schedule','date_field_match')`: a date-match flow is a sweeper candidate, so it must never be live), `launch.service` / `engine.service` / `run.repository` (refuse an inactive or unpublished flow), `flow-reader`, the admin counters and the partial index `idx_flows_live_trigger`. `trigger_channel_id`, `trigger_device_id`, `trigger_last_occurrence` stay NULL (a person binds a channel and publishes). No `flow_runs`, `flow_run_steps`, `flow_subscribers`, `flow_connected_devices`, `flb_geta_publish_syncs`, `event_outbox`, notification, audit or webhook row is written, and nothing is UPDATEd after the insert. The placeholders stay inert even if somebody publishes the flow (a trigger no event fires, an update with no field, a condition that is always false).

## Run it

```bash
$CLI automation-profile --client rhythm                              # READ-ONLY: distinct (type, class, function, shapeId) with counts
$CLI run --client rhythm ... --steps fields,automations --dry-run    # fields = the lists the triggers point at; a dry run writes nothing
$CLI run --client rhythm ... --steps fields,automations
$CLI reconcile --client rhythm --out out                             # steps that never ran are listed NOT RUN, not alarms
# staging (cycle.cjs): load --steps fields,automations
```

## What reconcile proves

`reconcile/oracle-automation.ts` is a second implementation (imports nothing from `transform/`, `flows/` or `automation/`). `reconcile/automation.ts` checks: the loader's verdict (kind and code) of every metadata document and journey row against the oracle; every loaded flow in the target: columns, the node and link counts the oracle derives, exactly one trigger and it is the start, every link has both ends, every Waboo node present exactly once with the type the mapping gives, trigger kind, the group through id_map, placeholder and detached counts, placeholders inert, no credential (`scrub` finds nothing, and no token of the dump is anywhere in `flows` or `migration.quarantine`); SAFETY with the consumers' predicates (zero hits) and the side-effect tables empty; extra rows (a flow of this category no automation accounts for); id_map both ways (definition keys, `automationId`, adopted journey rows; none for excluded or quarantined ones); the soft issues owed; the equation read = migrated + quarantined + excluded (generic) with `unaccounted` 0; the NOT PRESENT line with the counts. `test/automation.spec.ts` damage cases, all caught: activate a flow, publish + activate, arm a trigger, drop a link, delete a node, change a node type, change the trigger kind, delete a flow, add an extra flow, delete an id_map row, delete a soft-issue row, put a credential into a flow.

## Expected on the real dumps (from the profile, not yet loaded)

iskm: 11 definitions -> 9 flows (2 empty drafts `NO_NODES`), 17 journey rows adopted. rhythm: 5 definitions -> 5 flows, 38 journey rows adopted + 23 `DERIVED_EVENT_NODE`. Placeholders: rhythm's 4 `google_sheet_events` triggers; detached branches: the `delivered` / `failed` edges of rhythm's sends.

## Lost / NOT PRESENT (counted per flow in `migration.quarantine` `CONVERSION_LOSS`; the raw dump is the archive)

Run counters and the whole run history (entered / active / finished / failed / goal, `node_execution_history`), versions (`automation_version`, `automation_node_version`), the JointJS layout beyond positions (ports, labels, link styling), `createdBy` / `updatedBy`, `isLocked`; template body / header variables and button parameters; the delivered and failed branches (detached); the Google account and action type of the sheet step; every further edge of a port; sheet-row triggers; any other node type (placeholder).

## UNVERIFIED guesses (confirm by looking at the real automations in the Waboo console)

- `delay` is in SECONDS; `execution_offset` is in DAYS; `execution_cycle` may have values other than "once" (a value "yearly" is read as yearly, nothing else is known); `execution_time` is the account's local time.
- `google_sheet_query` filters contact fields (not sheet columns); the single `true` port means "otherwise stop".
- A `contact.update` template uses the same `{{merge}}` syntax as WaDesk variables; the property name in `fields[]` equals the key of the migrated field.
- `whatsapp.sent` means "the template step ran" (mapped to the next edge of the template step).
- The shapes catalogue (`shapes`, 68 documents) could not be read: node types that appear only in other clients become placeholders by (type, class, function).
- WaDesk follows only the first of several edges from one port (read in `runtime-graph.ts`, not run).

## Open questions for the manager

1. Are automations in scope for these two clients (earlier plan: rebuilt by hand)? The flows are inactive, so loading them is harmless; publishing is a person's decision.
2. The `delivered` / `failed` branches (rhythm uses them) do not run in WaDesk: accept, or ask product for message-status triggers (see `_work/migration/missing-in-wadesk-log.md`).
3. Google Sheet triggers (rhythm, 4 automations): a sheet-row trigger and the Google account link are needed to make them live.
4. Plan caps: automations count as flows, but the loader does NOT enforce `plans.limits.flows` for them (unlike the simple flows).
5. Who checks each automation node by node before it is published, and who binds the channel?

# Stage 2: AI knowledge base (RAG) -> ai_training_sources

Handler `knowledge_sources` (step name `knowledge_sources`, group `knowledge`), collection `document_col`. Operator command `kb-reingest`.

## What Waboo holds, what WaDesk needs

`document_col` is **metadata only**: documentId, parentDocumentId, sourceId, sourceType, url, file_path, characters, status, createdOn (karma adds selected, isbaseurl, botid, indexIds, sourceStatus). No page text and no vectors are in Mongo (the vectors are in an external store). Decision: **vectors are never copied**; WaDesk reads the pages again with its own pipeline (`ai_training_sources`, worker `SourceIngestConsumer`, SSRF-safe fetcher). Looked at and NOT knowledge-base data: `faq_variations` (FAQ phrases, already `faq_replies` -> keyword replies), `chatbot_configuration` / `chatbot_misc_config` (AI model, prompt, temperature already go to the paused assistant by `widget_config`; keys are never copied), `openchat_logs` (a Q&A log, stays OPEN). Waboo has no stored text entries or Q&A pairs, so the WaDesk kinds `text` and `qa` are not produced.

## Mapping (exact)

| Waboo | WaDesk `ai_training_sources` |
| --- | --- |
| sourceType website (also url, web, webpage, sitemap, link) | `kind = 'url'` |
| url | `url` (trimmed as written); `label` = host + path, trailing slash removed, cut to 200 |
| (none) | `status = 'failed'`, `error = 'Not fetched yet: re-ingest'`, `tokens_estimate` NULL, no content |
| createdOn | `created_at` = `updated_at` |
| botid, sourceId, documentId, parentDocumentId, indexIds, characters, selected, isbaseurl, sourceStatus, file_path | dropped, each with a reason in the handler's `fields` map |
| (none) | `assistant_id` NULL, `user_id` NULL |

- **Workspace-wide, no assistant row.** The app lists an assistant's entries plus every entry with no assistant (`SourcesRepository.listFor`) and the AI flow node reads the same (`assistant_id = X OR assistant_id IS NULL`), so NULL is visible to every assistant and no `ai_chat_assistants` row is created here (the paused ones come from `widget_config`). The Waboo bot (karma `botid`) is therefore not kept: all bots of a workspace share the list.
- **Why `failed`, not `processing`.** The worker settles an entry only when the event `ai_training_source.requested` reaches it, and `finish` only touches `processing` rows. A `processing` row with no event would show a spinner for ever. `failed` with a clear error is honest, and WaDesk answers only from `ready` rows, so nothing half-loaded is ever used.
- **Dedupe** by (assistant NULL, address): lower-case scheme and host, no `#fragment`, no trailing slash. The earliest live `createdOn` wins (then the smaller key); the others are excluded `DUPLICATE_URL` (counted).
- **Excluded** `SOFT_DELETED`: status `deleting` / `deleted` or `is_deleted` (all 133 ISKM documents are `deleting`, so ISKM loads 0 entries; karma has 62 `uploaded` website pages; rhythm has no `document_col`).
- **Quarantined** (listed in the run report with the document): `NEEDS_REUPLOAD` (any non-website source type: no file bytes exist in the dump; the reason names the file, query string removed), `NO_URL`, `INVALID_URL` (not http/https, or over 1024 characters). Soft issue `SELECTION_NOT_KEPT` when `selected` was false.
- The load makes no outbound request and writes no `event_outbox` row.

## Re-ingest flow (operator step, after the load)

```
# dry run first: counts and host names only
node pilot/staging/cycle.cjs kb-reingest --client karma
# the real thing (cycle.cjs passes --confirm-org-slug itself)
node pilot/staging/cycle.cjs kb-reingest --client karma --apply
# or directly: tsx cli.ts kb-reingest --client <c> --org-slug <s> [--apply --confirm-org-slug <s>]
```

For the migrated `url` entries (`migration.id_map`, `document_col`) that are still `failed`, in ONE transaction it sets `status = 'processing'`, `error = NULL` and inserts the same outbox row `SourcesService.add` writes: `event_outbox (org_id, aggregate_module 'ai_training_sources', aggregate_id = entry id, event_type 'ai_training_source.requested', payload {"_meta":{...}})`. The app worker then fetches each page and sets `ready` (text, token estimate) or `failed` (the reason). Dry run by default; `--apply` needs `--confirm-org-slug` and is **refused while any WhatsApp channel of the organization is connected**. Idempotent: `ready` and `processing` entries get no second event, and only a row still `failed` is reset, so running it twice emits once; a page that failed again is retried by the next run.

**RISK:** applying makes the WaDesk worker send outbound HTTP requests to the client's own website URLs (one per entry). That is why it is not a step of `run` / `migrate` and is never started by a load. Run `reconcile` BEFORE it (or with `--allow-extra-rows` after: `status`, `error`, `tokens_estimate`, `updated_at` are live columns); the baseline digest of a load expects 0 `event_outbox` rows, so run it after verification.

## Report fields

Per run, collection `document_col`: loaded / already / excluded (SOFT_DELETED, DUPLICATE_URL, counted) / quarantined by code (NEEDS_REUPLOAD with the file name in the detail, NO_URL, INVALID_URL) / soft issues (SELECTION_NOT_KEPT, NO_DATE, BAD_DATE). `kb-reingest` prints: migrated url entries, to read, already ready, already processing, without address, pages per host, and connected channels.

## WhatsApp cutover (operator step, per client, never part of `run`/`migrate`)

A normal run leaves every WhatsApp number disconnected: the channel is `disconnected` and unlinked, the credential is sealed in `wa_provider_configs` (`pending`), no webhook of Meta reaches WaDesk, the flows are drafts (or armed by flow-state, still silent). `cutover` is the separate, explicit step that connects a number, so two systems never answer the same customers by accident. It is in `load/cutover.ts`; `cycle.cjs migrate` and `all-dry` never call it.

```
node pilot/staging/cycle.cjs cutover --client iskm                       # DRY RUN: checklist + the Meta calls, nothing written, nothing sent to Meta
node pilot/staging/cycle.cjs cutover --client iskm --check-meta          # same, plus two read-only Graph GETs per number
node pilot/staging/cycle.cjs cutover --client iskm --apply --confirm-org-slug <slug> --i-switched-waboo-off --confirm-cutover "CUT OVER <slug>" [--webhook-base https://<api host>] [--replace-existing-override]
node pilot/staging/cycle.cjs cutover --client iskm --rollback            # DRY RUN of the way back
node pilot/staging/cycle.cjs cutover --client iskm --rollback --apply --confirm-org-slug <slug> --confirm-cutover "ROLL BACK <slug>"
# or directly: tsx cli.ts cutover --client <c> --org-slug <s> [--rollback] [--check-meta] [--apply ...]
```

**The dry run** (default) prints PASS / FAIL / MANUAL / SKIP per item and writes nothing: the organization; per number a real phone number id, the channel (exists, `disconnected`, unlinked), the `wa_provider_configs` row (made by the migration, credential sealed), the route (only the direct Meta route, see below), that the sealed token OPENS with this process's key (`CREDENTIALS_ENCRYPTION_KEY`, plus `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS`; the app's CryptoService format; only "opens" is checked, the value is never shown); the latest `reconcile.md` (integrity 0, unaccounted 0, not older than `--max-report-age-hours` 48, and newer than the last run_log write of any load step); every live flow is in the set flow-state recorded; a backup `desk-pre-cutover-<client>-*.dump` under 24 h old (found by cycle.cjs on the host, the container cannot see the backups folder); the app's public webhook URL resolves (https). MANUAL items the tool cannot see: **Waboo is switched off for the number** (turns PASS only with `--i-switched-waboo-off`), the API serving the callback uses the same verify token, and the token belongs to the Meta app whose webhook is being overridden. Then it lists the exact Meta calls. A FAIL exits 1.

**The apply** needs ALL of `--confirm-org-slug <slug>`, `--i-switched-waboo-off`, `--confirm-cutover "CUT OVER <slug>"` (exact, case and spaces), and refuses (exit 3, nothing changed) while any item FAILs; cycle.cjs passes none of these for you and takes a fresh `desk-backup once pre-cutover-<client>` first. In this order, each step idempotent and logged to `migration.run_log` (collection `_cutover`, steps `verify:<id>`, `subscribe:<id>`, `mark_connected`, `flow_state`):

1. Verify every number's token with a read-only Graph call, before anything is subscribed (Cloud API, not On-Premises, the number Meta shows is the channel's).
2. Subscribe the WABA with the per-WABA callback override, the app's `subscribeDirect` sequence (atomic override; on refusal a plain subscribe and the override again 3 x 1 s). A read before (an override that is already ours is not set again; a DIFFERENT override is refused unless `--replace-existing-override`) and a read after: the number is only marked connected when Meta shows the override.
3. `wa_provider_configs`: `status connected`, `connected_at`, `last_health_at`, `meta_json` `inbound_wired true`, `inbound_checked_at`, `last_error null` (what the app's connect `persist()` writes; the credential is already sealed). `channels`: `waba_config_id`, `status connected`, `last_error null`, `business_account_id` = the WABA id, `display_address` kept (what `WabaChannelLinkService.ensure` writes for an existing channel). No audit row and no outbox event, like every other write of this tool (the app's channel-sync consumer is therefore not involved; the explicit UPDATE is the whole link).
4. flow-state, LAST (it refuses while a channel is connected, except when called from here): the flows that are live in Waboo are published and active.

The callback is never hard-coded: `--webhook-base`, else `WABA_WEBHOOK_PUBLIC_URL`, else `APP_URL` of the process, plus the app's path `/v2/public/webhooks/whatsapp` and the app's own `?k=` key (HMAC of `CREDENTIALS_ENCRYPTION_KEY`); the verify token is `WABA_VERIFY_TOKEN`, else `WHATSAPP_VERIFY_TOKEN`, else the app's derivation. Neither the `?k=` key nor the token is printed. The tool container must therefore carry the same values as the API, or `--webhook-base` / the env of the `worker` service must be set.

**Meta calls** (header `Authorization: Bearer <the number's token>`, 15 s timeout, never in a URL or a log; `v25.0` or `META_API_VERSION`, host `META_API_ENDPOINT`): `GET /{phone_number_id}?fields=id,display_phone_number,verified_name,platform_type,code_verification_status,status`; `GET /{waba_id}/subscribed_apps`; `POST /{waba_id}/subscribed_apps` with json `{override_callback_uri, verify_token}`; on refusal `POST /{waba_id}/subscribed_apps` (no body) then the same override POST up to 3 times; `GET /{waba_id}/subscribed_apps` to confirm. Rollback: `GET`, `DELETE /{waba_id}/subscribed_apps`, `POST /{waba_id}/subscribed_apps` (no body), `GET`.

**The rollback** (`--rollback --apply`, phrase `ROLL BACK <slug>`): flows back to draft (`is_published`/`is_active` false, `published_at` null) for the set flow-state armed, and that record emptied (re-run flow-state to arm again); the override removed at Meta (DELETE then a plain subscribe: a new subscription has no override, so Meta falls back to the app-level callback; the original override of the WABA, if it had one, is NOT restored, apply logs only its host); the channel `disconnected` and unlinked, the connection `pending` again. If the Meta step fails the database part still runs (WaDesk stops) and the command exits 1 telling you to remove the override in the Meta app by hand. Then switch the Waboo side back on.

After a cutover the reconcile verifier no longer holds that channel to the "as migrated" shape (`CHANNEL_CHANGED` would fire on status, link and row version); it counts only that the channel exists, as for a channel the application owns (`_cutover/mark_connected` `done`; a rollback sets it to `rolled_back`).

Not covered, said plainly: only the direct Meta route (`provider_key meta`). Numbers imported as `interakt` (the importer's default when the Waboo document names no provider) or `pinnacle` FAIL the route item: their subscription goes through the partner key and a different call (`webhook_configuration` per phone), which is not built here; connect those in the app. Nothing here has been run against Meta or a database; the HTTP layer is covered by tests with a fake `fetch`, the database writes only by reading the app's code. The rollback's "DELETE then POST clears the override" is the documented behaviour of a fresh subscription and is UNVERIFIED against live Meta (the command reads the subscription afterwards and fails loudly if the override is still there).

## Not migrated (gaps)

- Vectors and the text of the pages (re-read by `kb-reingest`); the crawl structure (parent / source ids) and Waboo's "selected" tick.
- File documents (`NEEDS_REUPLOAD`): upload the files again in WaDesk (Knowledge). Documents with no address.
- The bot link: entries are workspace-wide. `openchat_logs` stays OPEN.
- UNVERIFIED: Waboo Mongo was not reachable while this was written (ssh timeout); the shapes come from `_work/migration/discovery` (iskm 133, karma 62 documents, all website) and the non-website source type names are a guess (anything else is quarantined, never guessed into a row). The tests (`test/knowledge.pure.spec.ts`) were not run (vitest is not installed in this tree).


# Stage 2: forms, API library, webhooks, labels

Code: `transform/portables.ts`. Steps `wa_forms`, `api_library`, `outbound_webhooks`, `chat_labels` (groups `forms`, `integrations`, `labels`). Tests: `test/portables.pure.spec.ts` (NOT run: vitest/zod are not installed in this tree).

## `wa_forms` (whatsapp_flow -> wa_forms)
Source: 2 documents on iskm (`name, status, categories, template_flow, mapping_object, meta_id, clone_id, created_time, modified_time`). Row: `title` = name, `slug` = slugified name + last 6 of the id (unique per org), `status` = `draft` always, `definition_json` = `{source: 'waboo', legacyWaboo: {status, categories, template_flow, mapping_object, meta_id, clone_id}}` (scrubbed). Constants: `meta_flow_id` NULL, `provider_config_id` NULL, `published_at` NULL, `submission_count` 0.
Not carried: the Meta flow id (a form with a Meta id could be sent by flow nodes or edited at Meta; kept in `legacyWaboo.meta_id`), the published state (PUBLISHED -> soft `FORM_NOT_PUBLISHED`), and the conversion of `template_flow` / `mapping_object` to the WaDesk form definition: no code in `apps/api` builds `definition_json` from Meta Flow JSON yet, so it stays raw (soft `FORM_DEFINITION_RAW`, one per form).

## `api_library` (api_library -> api_library_apis)
Source: 2 documents on karma. Row: `name` (letters/digits/underscore, 64; a changed name gets `_<last 4 of id>`, soft `API_NAME_CHANGED`; two names equal ignoring case hit `uq_api_library_apis_name` and the second is quarantined as a unique conflict), `method` (upper case, else quarantine), `url`, `payload_type`, `headers` (`[{key, value, secret}]`), `body` (scrubbed). Constants: `variables`, `mapping_config`, `response_variables` = `[]`, `function_code` NULL, `created_by` NULL.
Not carried: values of secret-looking headers (name kept, value empty, `secret: true`, soft `API_HEADER_SECRET_BLANKED`), secret-looking query values (emptied, `API_URL_SECRET_BLANKED`), `body_config` and the variable declarations (`API_VARIABLES_NOT_CARRIED`, `API_TOKENS_UNDECLARED`), the flow nodes that call these APIs (the flow converter still counts them as CONVERSION_LOSS).

## `outbound_webhooks` (webhooks): quarantine only
`webhooks.webhook_url` is NOT NULL and the app stores it, like the secret, as a `CryptoService` blob and DECRYPTS it on the list screen; a plain value would break the whole list. This tool has no crypto, so every document is quarantined `WEBHOOK_URL_NEEDS_ENCRYPTION` (secret and headers lost, `WEBHOOK_SECRET_NOT_CARRIED`). The collection is empty on iskm, rhythm and karma (no shape seen). `webhook_logs` is never imported. To carry them: a separate operator command that holds the credentials key, like `pricing-seed`.

## `chat_labels` (chatlabels -> tags + conversation_tag): quarantine only
Empty on all three clients (no shape seen) and conversations are keyed by phone number in the inbox step, not by Waboo id, so a label cannot be tied to a conversation exactly: every document is quarantined `LABEL_LINK_UNVERIFIED`. When data appears: reuse a `tags` row by case-insensitive name (citext, unique per org), then link through the inbox thread key.

Staging checks: `node pilot/staging/cycle.cjs dry --client iskm --steps wa_forms`, `... --client karma --steps api_library`, and `--steps outbound_webhooks,chat_labels` (expect 0 documents).


# Stage 2: FAQ knowledge ("RAG FAQ") -> faqs, faq_variations, faq_settings

Handler `faq_knowledge` (step `faq_knowledge`, groups `faq` and `flows`), a DERIVED step like `flow_bots`. Code: `flows/faq.ts` (the builder, pure), `transform/faq.ts` (the step), `load/faq.ts` + the hook in `load/flows.ts` (settings rows), `reconcile/faq.ts` (verifier). Tests: `test/faq.pure.spec.ts` (no database: `node node_modules/vitest/vitest.mjs run --config vitest.pure.config.ts test/faq.pure.spec.ts`, 13 tests passed here) and `test/faq.spec.ts` (needs the Docker database AND a schema with the FAQ migrations; NOT run: this checkout's `packages/db/migrations` stops before them).

## Widget link and launcher look (the Customize tab of a migrated bot)

A widget of a bot that became a flow is written with `flow_id` (the flow) and `customized_at` (= its `updated_at`), because the bot's Customize and Deploy tabs read the button by `flow_id`: without it they find no widget and open on the defaults of a new bot (ripple, popup on, text button, 60 px mobile gap, the keyword as the message). `widgets` therefore depends on `flow_bots`. The launcher JSON also carries the button type (`button_type` / `launcher_type` / theme `button.button_type`: icon or text), the animation (`widget_animation`: bounce, ripple, none), the popup (`tooltip`: on or off, top or side, text; OFF unless the source says on) and each part of the desktop and mobile placement the source states (a missing part keeps the application's default for that part only). A value the tool does not recognise keeps the default and is listed as the soft issue `LAUNCHER_LOOK_UNRECOGNISED`. UNVERIFIED: the source key names above are read from the discovery notes, not from a dump; check them against the key names in `CONFIG_NOT_PRESENT` of a real run. FAQs built only from Intent records carry the soft issue `INTENT_ONLY`, so each paused FAQ can be traced to its source.

## Source and target

- Source: `faq_variations` `{_id, botid, qid, phrases[]}` (iskm 1, rhythm 5, karma 16 documents) plus the bot's `bot_workspace` records of type Intent / FAQ, which hold what the phrases belong to: the question (`question`, else `query`, a string or a list), an `intent` label, a `journey` `{qid, name, nodeId}` when the question starts a flow, or an inline `response[]` (the same message objects the flow steps use) when it answers itself. The shapes come from `_work/migration/discovery` (the counts fit: karma FAQ 18 + Intent 6 records, 10 with a journey and 14 with a response; rhythm FAQ 5 + Intent 3). Mongo was unreachable, so the grouping rule below is a reading of the shapes, not of values (see UNVERIFIED).
- Target (WaDesk on main: migrations `20261114090000_faq_core`, `20261114090100_faq_permissions`, `20261116090000_faq_flow_node_verify`, `20261118090000_faq_per_flow`): `faqs`, `faq_variations`, `faq_settings`. `faq_match_logs` is not migrated and stays empty.
- Why a second step on the same collection: the registry holds ONE handler per collection, so `faq_variations` stays registered to `faq_replies` (the inactive keyword replies, unchanged; the flows verifier's oracle still expects them) and `faq_knowledge` is a virtual step with its own `id_map` collection `faq_knowledge` (the same pattern as `flow_bots` next to `chatbots`). Both run in the standard chain; a client that does not want the keyword replies can `--skip-steps faq_replies`.

## One question = one FAQ

Intent / FAQ records of a bot that share a `qid` (top-level, else `journey.qid`) are ONE FAQ, with the `faq_variations` documents of that `qid` (or of a record's `journey.qid`) attached. An Intent that starts a journey shares the qid of that journey's steps; an FAQ that answers inline has its own. An FAQ record with no `faq_variations` document is migrated too (karma has 18 FAQ records and 16 variation documents). Intent records alone are flow trigger words and stay that (they already become the trigger of the flow).

| Waboo | WaDesk |
| --- | --- |
| the flow the bot became (`flow_bots`) | `faqs.owner_flow_id` (FAQs are per flow). No flow for the bot (WEB_BOT_NO_FLOW, BOT_INACTIVE, NO_NODES ...): quarantined `NO_OWNER_FLOW`, the plan's code in the reason |
| first `question` (else `query`) string of the records, whitespace collapsed | `faqs.question`, and the same text as ONE `faq_variations` row with `source = 'question'`: the application keeps its own question as a variation so a match reads one table (and rewrites it when the question is renamed); without it the FAQ would not match its own wording |
| the other question strings, then every `phrases[]` string | `faq_variations` rows, `source = 'import'`, `embed_state = 'pending'`, `embedding` / `embedding_model` / `embedded_at` NULL, `embed_attempts` 0 |
| inline `response[]` (text; HTML turned into lines; a file as caption + link; an interactive message as body + footer) | `answer_type = 'text'`, `answer_text`, parts joined with a blank line, credential-looking parts `[redacted]` (ANSWER_REDACTED), buttons lost and counted (ANSWER_PARTS_LOST), at most 4096 characters |
| no `response`, a `journey` | `answer_type = 'flow'`, `flow_id` = the owner flow, `flow_node_id` NULL. The journey inside the flow CANNOT be addressed (the finding of the keyword replies, QID_NOT_ADDRESSABLE): the FAQ starts the whole flow from its trigger. Check each one before enabling. (Pointing `flow_node_id` at the converted first node of the journey is possible later; it is deliberately not guessed.) |
| both a `response` and a journey | the text wins, soft ANSWER_ALSO_FLOW |
| createdAt / updatedAt of the records (earliest / latest) | `created_at` / `updated_at` through `times()`; a display date "dd Mon, yyyy h:mm:ss AM" is read as UTC (DATE_ZONE_ASSUMED); only when no record has a date, the ObjectId time of the variations document |
| (none) | `status = 'paused'` always; `category`, `threshold_override`, `created_by`, `flow_node_id` NULL |
| (none) | `faq_settings`: one row per flow that owns at least one migrated FAQ, `enabled = false`, the other columns at the table defaults (threshold 0.450, min_margin 0, log_queries true, verify off). A settings row that already exists is never touched |

Dropped with a reason in `fields`: `records`, `soft`, `problem` (builder bookkeeping). The Intent `intent` label and the journey `name` are not stored (no category is invented).

## Limits the application enforces (from `FAQ_LIMITS` / `FAQ_PLATFORM_DEFAULTS` on main, counted in UTF-16 units like the zod schemas)

question 500 (over: quarantine `QUESTION_TOO_LONG`), answer 4096 (over: quarantine `ANSWER_TOO_LONG`, never cut), variation 500 (over: dropped, soft VARIATION_TOO_LONG_DROPPED with the count), 60 variations per FAQ with the question included (the rest dropped in order, soft VARIATIONS_CAPPED), 500 FAQs per flow (the rest quarantined `FAQ_LIMIT`). The platform operator can change the last two in the platform config; the tool uses the defaults. Phrases that repeat ignoring case and spacing are merged silently (uq_faq_variations_text).

## Quarantine (never guessed)

`NO_OWNER_FLOW`, `NO_QUESTION` (no record names the question: phrases alone are not a question; this includes a `faq_variations` document whose qid matches no Intent / FAQ record), `NO_ANSWER` (no inline response and no journey), `QUESTION_TOO_LONG`, `ANSWER_TOO_LONG`, `FAQ_LIMIT`, plus the loader's `UNIQUE_CONFLICT`.

## The same question twice in one flow

`uq_faqs_question` is unique per flow on `lower(btrim(question))`. In load order (first appearance in `bot_workspace`) the first keeps its text; a later one is numbered ("Hours? (2)", "Hours? (3)"), its own wording stays as a variation, and the soft issue QUESTION_DUPLICATE_RENAMED is recorded. Nothing is merged and nothing is lost; merge or reword before enabling.

## Embeddings, and what makes the vectors appear (read from the worker on main)

No vector is copied (Waboo's are in an external store and a different model) and this tool makes NO outbound call and writes NO `event_outbox` row. The application's `FaqEmbedWorker` (`faq-embed.worker.ts`, imported only by the WORKER process through `FaqKnowledgeWorkerModule`) runs `@Interval(5000)`, asks `orgsWithPending` (`SELECT DISTINCT org_id FROM faq_variations WHERE embed_state = 'pending' AND embed_attempts < 5`) and embeds batches of 64. It needs no event and does NOT look at `faq_settings.enabled`. It does need: the worker process running with Redis, the platform embedding model on the allow-list, and an OpenRouter key that `AiKeyResolver` finds for the organization (its own key under AI keys, or the shared platform key). **Without a key every attempt fails and a variation turns `failed` after 5 attempts (about 25 seconds)**; the screen shows it with a Retry (`retryFailed`), so set the key first or press Retry afterwards. Until a variation is `ready` it cannot match semantically.

## Enabling FAQ after review (a person, in WaDesk)

1. Open the flow's FAQ screen: read each FAQ (question, answer, variations), merge the numbered duplicates, check every flow-answer FAQ (it starts the whole flow, not the journey).
2. Make sure the AI key exists and the variations are `ready` (Retry for `failed`).
3. Activate the FAQs (status `paused` to `active`) and switch the flow's FAQ answering on (`faq_settings.enabled`). Nothing in this tool does either, for any client.

## Not carried

Vectors; `faq_match_logs`; per-journey addressing (`flow_node_id` stays empty); the Intent `intent` label and journey `name`; buttons and list rows of an interactive answer; phrases beyond the limits above. Everything counted is in `migration.quarantine` (collection `faq_knowledge`; soft issues as `<key>#CODE`).

## Order, steps, new clients

After the flow steps (`faq_knowledge` needs `flow_bots`). `cycle.cjs migrate` and `pipeline.cjs run` select every registered step by default, so a NEW client picks it up with no flag. What can stop it: (1) the target must have the four FAQ migrations: preflight check b fails with `table faqs: MISSING` on a server that is behind main, and check a fails the other way round (`applied migration(s) with no file here`) when the bundle is built from a checkout that lacks them, so build from a checkout that contains them; (2) the bot must have become a flow (otherwise NO_OWNER_FLOW, counted); (3) the new bundle must be built and shipped before the dry run; (4) FAQs are not a plan limit (the per-flow cap above is the application's own).

Staging: `node pilot/staging/cycle.cjs dry --client iskm --steps flows` (the group includes `faq_replies` and `faq_knowledge`; a dry run has nothing loaded, so the flow steps it depends on must be selected too), then the real run through the usual `migrate` / `load`, then `reconcile`. New alarms: `FAQ_VARIATIONS_MISMATCH`, `FAQ_SAFETY`, `FAQ_SETTINGS_MISSING`, `EXTRA_ROWS` (faq tables). After people start using FAQ, reconcile with `--allow-extra-rows`, which turns the paused / pending / disabled checks off.

## UNVERIFIED

- The grouping key (top-level `qid`, else `journey.qid`) and that an FAQ answers inline through `response[]` are read from the discovery shapes (field frequencies), not from values. If the qid of a `faq_variations` document matches no record, the document is quarantined `NO_QUESTION` (counted, nothing guessed), never attached to a wrong question.
- That the inline `response[]` of an FAQ record uses the element shapes of the flow steps (string value, `{text, url}` value, `interactive`).
- The platform limits (500 FAQs per flow, 60 variations) are the defaults; an operator may have changed them on staging.
- `test/faq.spec.ts` was written against the fixtures of `test/flows-fixtures.ts` and was not run (no Docker database here; vitest ran the pure tests only). `test/portables.pure.spec.ts` had a failing assertion BEFORE this work.
- `pilot/staging/raw-writes.json` was already out of date for `flows`, `plans`, `role_grants` and `subscriptions` (hand-written SQL of other work in `load/`): only `faq_settings` was added by this step; regenerate with `tsx pilot/staging/raw-writes.ts` when that work lands.

# Migrating a new client (what the admin panel runs)

One command per client, no hand-run repair: `node pilot/staging/pipeline.cjs --db <waboo database> --mode load` (the panel spawns exactly this; `--mode dry` stops after the dry run), or `node pilot/staging/cycle.cjs migrate --client <key> --db <waboo database> --yes-load-into-staging --with-dry-run`.

**Config of a new client, derived (read-only), nothing typed:** `core-opening.cjs` reads `geta_core` (organization name, plan facts, the confirmed wallet balance); `wa-numbers.cjs` reads the tenant database through the read-only kit and writes the **channel map with the real WhatsApp phone number id, display number and name**, keyed by the botid of the chats (it selects `chatbot_id`, `phoneID`, `display_number` / `whatsapp_no`, `display_name` of the live `META_WHATSAPP_CONFIG` documents and `distinct botid` of `chathistory`; never the access token). A botid is paired by `chatbot_id`; a workspace with one botid and one number is paired without it; anything ambiguous is NOT guessed. Only when no live number exists does `new-client` fall back to the old PLACEHOLDER map, and the pipeline then puts a `WARNING:` line in the report summary (every chat of that botid is quarantined `NO_CHANNEL` until a person sets the real one). The map is written once, by `new-client`, which never overwrites; `cycle.cjs loaded-check` (read-only count of `migration.run_log`) refuses to create a config for a client that already has rows on staging, because its conversation keys were derived from the old map. The WhatsApp credential (token) is still imported separately with `pilot/credentials/import-whatsapp-credentials.cjs` (no tokens in the map or in any output).

The chain (`MIG_STEPS`): `export, ship, preflight, dry, backup, load, files, core-load, wallet-sync, flow-state, reconcile, report, complete`.

| Command | In a fresh-client chain? | Why |
| --- | --- | --- |
| `load` (all steps) | yes | templates before campaigns, the parser reads interactive messages, the planner links contacts and campaigns to their template |
| `files` (copy + verify) | yes | media of the freshly loaded messages |
| `core-load`, `wallet-sync` | yes (when the client has a `coreFile`) | plan, subscription, wallet at the current balance |
| `flow-state` | yes | publishes the flows that are live in Waboo |
| `update` | NO | a fresh load already reads the current dump; only for edits made after a load (catch-up) |
| `chat-reparse`, `chat-relink`, `campaign-link` | NO | repairs for rows loaded by older code; a fresh load uses the fixed code |
| the loader's append of newer chat turns | automatic | part of `load` on a re-run |
| `kb-reingest` | NEVER in the chain | the WaDesk worker makes outbound requests to the client's site: needs approval |

**Automatic:** every step above, the backup, the dry-run gate, `init` when the migration schema is absent, the verification below. **Needs a human:** `kb-reingest` (approval), the WhatsApp token import and the cutover (see "WhatsApp cutover"), the real owner e-mail (the config uses `owner-<slug>@desk.wabo.ai`), the plan review (the pilot loads `enterprise` unless the config says otherwise), any `WARNING:` about a missing WhatsApp number. **Verification the chain prints:** `dry status: OK (rolled back: true, unaccounted: 0)`, per-step counts, reconcile (`unaccounted`, `alarms`, `integrity`), `report` (files copied back), and the final `{"event":"report","green":...}` line for the panel.

A preflight with only WARNs proceeds: `cmdPreflight` succeeds on exit 0 and the preflight exits 1 only on a FAIL. Check `a` (migrations) reports "database ahead of this checkout" as a WARN; the schema check `b` decides whether it matters.

# Catching up an already-loaded client

When the live Waboo data moved on between two runs: `node pilot/staging/pipeline.cjs --db <waboo database> --mode catchup` or `cycle.cjs migrate --client <key> --db <db> --yes-load-into-staging --catch-up`. Needs the client's existing config. The chain: forced `export`, `ship`, `preflight`, `dry`, `backup`, `load` (new rows; steps that tolerate a re-run; chat appends newer turns), `update` (edits made in Waboo since the load; locally edited rows are left), `files`, `core-load` (snapshot refresh) + `wallet-sync`, `usage-append` (the new billing-log charges and token rows, see "Catch-up after a re-export"), `reconcile`, `report`, `complete`. Refused in a catch-up: the whole `credits` group is skipped in `load` (a second wallet opening would be a second balance; `wallet-sync` adds one ledger row for the difference instead, `usage-append` adds the charges) and `flow-state` is not run again; `--steps` is refused. Stop after the dry run to look first: add `--stop-after dry`.

Panel note: the panel's parser (`WMIG_STEP_NAMES` in `packages/contracts/src/waboo-migration/index.ts`) accepts only `export, preflight, backup, dry, load, core-load, flow-state, reconcile, report`, and `WMIG_MODES` only `dry, load`. `update`, `files` and `wallet-sync` run but emit no event; `--mode catchup` is CLI-only until those lists get the new names.
