# Real-data pilot runbook (one client at a time)

Clients: **ISKM** (db `tattvavit_das_GJdvpcDL_CWDi`, client key `iskm`) and **Rhythm Watches** (db `www_rhythmwatches_in_WfEg6ZrU`, client key `rhythm`). Karma is dropped.
Do one client end to end, then the next. Nothing here writes to Mongo or to any real Postgres.

Status of the tooling in this folder: tested only against a fake `ssh` and invented documents. Nothing was ever run against the replica or the jump host (see "Not yet proven" at the end).

## 0. Before you touch anything

1. **Jump host key.** The SSH host key of the jump host changed. Its owner must confirm the new fingerprint out of band first. `bin/mongo-export.cjs` keeps `StrictHostKeyChecking=accept-new`
   (same as `mongo-eval.cjs`): a CHANGED key makes ssh fail, the exporter prints the OpenSSH message and exits **4**. See "Host key warning" below.
2. **Dump folder** (customer PII lands here). All of these must be true; `--i-confirm-encrypted-volume` is your statement that they are:
   - on an **encrypted volume** (BitLocker / FileVault / LUKS), local disk, not a network drive, not OneDrive / Dropbox / Google Drive / iCloud / Box, not inside any git repository (the exporter refuses all of those);
   - the **holders are named** (people, not roles) for the dump and for the scratch Postgres; nobody else gets a copy;
   - you know how it will be **deleted securely** afterwards (section 11);
   - the `manifest.json` **hashes will be recorded OUTSIDE the folder** (ticket or signed note).
3. Disk: the scratch Postgres refuses to start with less than 4 GB free on C: (hard floor 3 GB). Check `docker system df` first.
4. Nothing from the dump goes into tickets, chats or logs. Run logs and reports hold keys and counts only.

Shorthand used below (run from `D:\wadesk-vedant\crm-platform\tools\migration`):

```bash
KIT="D:/wadesk-vedant/db-migration/geta-mongodb-read-replica-prod/geta-mongodb-read-replica-prod"
DUMPS="E:/secure/waboo-dumps"          # EXAMPLE: your encrypted, local, non-synced, non-git folder
CLIENT=iskm; DB=tattvavit_das_GJdvpcDL_CWDi      # or: rhythm / www_rhythmwatches_in_WfEg6ZrU
CLI="node node_modules/tsx/dist/cli.mjs cli.ts"
export SOURCE_DUMPS_DIR="$DUMPS"
```

## 1. Smoke export (a few documents; proves the path, nothing real is trusted)

```bash
node $KIT/bin/mongo-export.cjs --db $DB --client $CLIENT --out "$DUMPS" --i-confirm-encrypted-volume \
  --collections contact_list,user --limit 20
```

Check: exit 0, counts line per collection, `<out>/<client>/<c>.ndjson` has `{"$oid":..}` / `{"$date":{"$numberLong":..}}` forms (canonical), the `user` file has **no** `password*` field.
Delete the smoke files (or use `--force` on the real export, which re-exports everything). A `--limit` export never runs the manifest and is never used for a real run.

## 2. Real export

```bash
node $KIT/bin/mongo-export.cjs --db $DB --client $CLIENT --out "$DUMPS" --i-confirm-encrypted-volume \
  --registry-classes MIGRATE,MIGRATE_LATER --max-gb 2 --tolerance 0
```

- Lists the collections once (fixed template), keeps those whose registry disposition is in the given classes, **skips** the denylist (`chatbot_misc_config`, `auth_logs`, `webhook_logs`, every registry EXCLUDE) and `system.*`, never exports an UNKNOWN collection.
- Per collection: `<name>.ndjson.part` -> rename on success; `.export/<name>.json` (count, bytes, sha256, stripped-key count); `.export/run-<ts>.log` (counts only). A re-run **skips** collections whose file and record still match; `--force` re-exports.
- Count check: documents written must equal a fresh `countDocuments()` in the same session. Mismatch = exit **3** and no final file. The replica may lag: `--tolerance N` (absolute documents) accepts a small difference and says so.
- Exit codes: 0 ok, 1 failure, 2 refused, 3 count mismatch, 4 host key, 5 `--max-gb` exceeded.
- `user` is projected server-side (`password`, `passwordHash`, `password_hash`, `hashed_password`, `hash`, `salt` never leave the database server) and credential-named keys (password, token, secret, api key ...) are removed on the jump host before printing.
- `--collections a,b` exports exactly those (still denylist-checked). Denylisted collections only with `--i-know-what-i-am-doing --reason "<15+ chars>"` and the data owner's approval; they are then credential-stripped too. `chatbot_misc_config` is read by nobody: the channel map (section 4) is written by hand.
- On success (no `--limit`, no failure) it runs the migration tool's `manifest` command itself; with `--no-manifest` it prints the exact command instead.

## 3. Manifest and coverage

```bash
$CLI manifest --client $CLIENT          # counts, bad lines, sha256 -> $DUMPS/$CLIENT/manifest.json
$CLI coverage --client $CLIENT          # every collection vs the registry; exit 1 on UNKNOWN
```

Record the `manifest.json` sha256 values **outside** the dump folder now. An UNKNOWN collection stops the line: decide MIGRATE / EXCLUDE / GAP / OPEN in `registry/index.ts` (other builders own that file).

## 4. Prerequisites the loader will not guess

- **Channel map** (inbox / chathistory): hand-written `$DUMPS/$CLIENT/channel-map.json`, `{ "<waboo botid>": { "kind": "whatsapp_cloud", "externalId": "<phone number id>", "displayAddress": "+91 ...", "name": "..." } }`. Non-secret values only; two people read the phone number id off the Meta business manager (a wrong id gives every customer a second thread at cutover). Without it a dump with chat stops the run. Format and rules: README, "channel-map.json".
- **Role map** (users / roles): `access/role-map.json`, per client; no entry = custom role with only REVIEWED, in-plan, non-admin-class grants. Presets need `approvedBy` + `evidence`; Owner is never mapped. List what is unmapped first:

  ```bash
  $CLI permission-catalogue --client $CLIENT --out out     # unmapped Waboo permissions grant nothing
  ```

  `access/permission-map.json` entries apply only with `status: REVIEWED` + `reviewedBy`. They are empty until the manager signs (OQ-9): roles will load with no grants until then. That is by design.

- Org inputs for the run: `--org-name --org-slug --org-plan --owner-email --owner-name` (the organization is never imported from Mongo).

## 5. Scratch Postgres

```bash
node pilot/scratch-db.cjs up        # refuses < 4 GB free on C:; applies all repo migrations; writes pilot/.scratch.env (git-excluded)
node pilot/scratch-db.cjs status
set -a; . pilot/.scratch.env; set +a   # TARGET_DATABASE_URL (worker login), MIGRATION_DATABASE_URL (owner)
$CLI init                           # migration schema (id_map, quarantine, run_log), idempotent
```

## 6. Dry run, 7. Reconcile, 8. Read the report

```bash
$CLI run --client $CLIENT --dry-run --org-name "..." --org-slug $CLIENT --org-plan growth --owner-email a@b.c --owner-name "A B" --default-cc 91
```

Everything runs in one transaction that is rolled back. Read the plan: quarantined and soft-issue counts must be explainable. Reconcile needs loaded rows, so the first reconcile happens after step 9.

## 9. Real load into the SCRATCH database, then reconcile

```bash
$CLI run --client $CLIENT --org-name "..." --org-slug $CLIENT --org-plan growth --owner-email a@b.c --owner-name "A B" --default-cc 91
$CLI reconcile --client $CLIENT --out out        # exit 0 required; writes out/$CLIENT/reconcile.{json,md}
```

Read `out/$CLIENT/reconcile.md`: the non-migrated key list, field-level issues, NOT PRESENT sections, the equation `read = migrated + quarantined + excluded` per collection. Quarantine review:

```sql
SELECT reason_code, count(*) FROM migration.quarantine WHERE source_client = 'iskm' GROUP BY 1;
```

Never point `TARGET_DATABASE_URL` at anything but the scratch database in the pilot (the tool refuses non-local hosts without `--allow-target-host` and, to write, `--confirm-db-name`).

## 10. Per-feature completeness report

See "completeness-report generator" below. Until it is built, read `reconcile.md` per collection and fill the table in section 12 by hand.

## 11. Teardown (secure delete)

```bash
node pilot/scratch-db.cjs down      # docker rm -f -v + docker volume rm + deletes .scratch.env
docker ps -a --format '{{.Names}}' | grep waboo-pilot ; docker volume ls -q | grep waboo-pilot   # both must print nothing
docker volume ls -f dangling=true -q | wc -l                                                      # must equal the count from before step 5
```

Then securely delete `$DUMPS/$CLIENT`, `out/`, and, if it was created for this job, the encrypted volume's key material (shred / crypto-erase; a plain recycle-bin delete is not enough). Confirm the manifest hashes are stored outside the folder.

## Host key warning (exit 4, "Host key verification failed" / "REMOTE HOST IDENTIFICATION HAS CHANGED")

1. Stop. Nothing was exported. Do **not** retry in a loop.
2. Get the jump host's current fingerprint from its **owner** by a channel other than this machine's ssh (call, signed note).
3. Compare with `ssh-keygen -lf <(ssh-keyscan -t ed25519 <host>)` style output only after the owner has confirmed it is expected.
4. Only when it matches, remove the old line with `ssh-keygen -R <jump-host>` and let `accept-new` record the new key on the next run.
5. **Never** use `-o StrictHostKeyChecking=no` or `UserKnownHostsFile=/dev/null`, here or anywhere else; the exporter has no such option and tests assert it is never passed.

## 12. Feature -> collection -> command -> proof it is complete

Source: `_work/migration/team-points.md` Part A, status read from `registry/index.ts` and the README. "proof" is what makes the feature complete for the pilot. **NOT BUILT** = no handler yet (MIGRATE_LATER / GAP / OPEN): the exporter can still take the raw collection (class MIGRATE_LATER), the loader does nothing with it, and `coverage` / `reconcile` report it as not migrated.

| Team point (Part A)                                                 | Collection(s)                                                                                                   | Command(s)                                 | Proof it is complete                                                                                                                       | Status                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| contacts (all)                                                      | `contact_list`                                                                                                  | export, `run`, `reconcile`                 | read = migrated + quarantined + excluded; per-column oracle compare; `contacts.legacy_id` = Mongo `_id`; owner of every contact            | built                                                              |
| contact properties / fields / options / dependencies                | `contact_properties_fields`, `_field_options`, `_field_dependancy_mapping`, `_field_options_dependancy_mapping` | same                                       | every `contacts.data` key has a `fields` row; credential-named properties excluded and counted                                             | built                                                              |
| contacts: status and stages need confirming                         | `contact_lifecycle_stages`                                                                                      | same                                       | rows in `status_options`; the stage/status mapping is an OPEN QUESTION for the manager                                                     | built, mapping unconfirmed                                         |
| tags                                                                | `contact_tag`                                                                                                   | same                                       | `tags` rows = source rows (no source of contact-tag links found in samples)                                                                | built                                                              |
| marketing list (new one contains group)                             | `marketing_list`, `contact_list.marketing_list`                                                                 | same                                       | `contact_groups` + `contact_group_members` match the oracle                                                                                | built                                                              |
| contact notes                                                       | `contact_notes`                                                                                                 | same                                       | `contact_notes` rows = source rows                                                                                                         | built                                                              |
| certain number fields should be decided                             | (property definitions of phone-like fields)                                                                     | none                                       | decision record from the manager                                                                                                           | OPEN decision, not a tool step                                     |
| chathistory = inbox                                                 | `chathistory` (+ channel-map.json)                                                                              | export, `run`, `reconcile`                 | read = migrated + quarantined + excluded; threads/messages/ledger vs oracle; `WEBCHAT_NO_CHANNEL` / `NO_CHANNEL` quarantine reviewed       | built; shapes of `bot_response.response[]` UNVERIFIED on real data |
| do we need to authenticate WhatsApp again (setup difference)        | none (channels created with no credentials)                                                                     | `reconcile`                                | channels rows `disconnected`, no token; **yes, WABA must be reconnected** after cutover                                                    | by design                                                          |
| chatbot misc config (most important)                                | `chatbot_misc_config` (tokens, OAuth, OpenAI keys)                                                              | exporter REFUSES it                        | channel map written by hand from Meta business manager; nothing read from this collection                                                  | NOT BUILT (and deliberately not exported)                          |
| roles                                                               | `roles`, `available_permissions` (catalogue only)                                                               | `permission-catalogue`, `run`, `reconcile` | exact grant sets vs oracle; no admin-class grant without approver; `roles_version`                                                         | built, UNREVIEWED until the manager signs the maps                 |
| user roles, no admin role for user                                  | `user`                                                                                                          | export (projection), `run`, `reconcile`    | NO-ADMIN invariant over every user; password scan of users/profiles/security/quarantine/run_log is clean; only `--owner-email` holds Owner | built                                                              |
| permissions same for plan making                                    | `available_permissions`, `roles`                                                                                | `permission-catalogue`                     | unmapped list is empty or accepted; keys outside the org plan are filtered and counted                                                     | built, awaiting review                                             |
| auth tables in mongo check                                          | `user`, `roles`, `auth_logs`                                                                                    | `coverage`                                 | `auth_logs` shows EXCLUDE; `user`/`roles` as above                                                                                         | built                                                              |
| authlogs (don't)                                                    | `auth_logs`                                                                                                     | `coverage`; exporter refuses               | disposition EXCLUDE; excluded count in the report                                                                                          | by design                                                          |
| broadcast logs (yes), whatsapp broadcasting (yes)                   | `broadcasting`, `whatsapp_broadcasting_data`                                                                    | export, `run`, `reconcile`                 | both equations; no sendable campaign/recipient in SQL; counters = roll-up; `NON_BROADCAST_SOURCE` rows counted                             | built                                                              |
| broadcast template no migrate                                       | `broadcast_templates`                                                                                           | `coverage`; exporter skips                 | EXCLUDE; `template_id` NULL, template name listed under NOT PRESENT; needs a template re-sync plan                                         | by design                                                          |
| sms-broadcasting no                                                 | `sms_broadcasting_data`, `email_broadcasting_data`                                                              | `coverage`                                 | EXCLUDE                                                                                                                                    | by design                                                          |
| credit-logs migrate all                                             | `credit_logs`                                                                                                   | none yet                                   | would need: every row loaded (no sampling) and totals equal                                                                                | NOT BUILT (MIGRATE_LATER)                                          |
| credit-mapping no / credit-mapping new yes                          | `credits_mapping` (EXCLUDE), `credits_mapping_new` (later, target OPEN, not a wallet)                           | `coverage`                                 | `credits_mapping` EXCLUDE; `credits_mapping_new` waits for a target decision                                                               | NOT BUILT                                                          |
| file-manager (all data, find where)                                 | `file_manager`, `attachments`, `contact_files`                                                                  | none yet                                   | needs a table (GAP: no file-library table) and a copy of the objects to our store                                                          | NOT BUILT, needs product decision                                  |
| flows: simple -> chatbot, advanced -> automation                    | `flows`, `flows_version`, `bot_flow_version`, `bot_flow_version_data`, `bot_workspace`, `automation_*`          | none yet                                   | would need: latest version only; flag on the single `flows` table                                                                          | NOT BUILT (MIGRATE_LATER)                                          |
| no version history                                                  | `automation_version`, `automation_node_version`, `bot_flow_version*`                                            | `coverage`                                 | version collections EXCLUDE (latest only)                                                                                                  | by design                                                          |
| journey table should be involved                                    | `journey` (EXCLUDE, cross-check of `bot_workspace`), `automation_journey` (later)                               | none yet                                   | cross-check against `bot_workspace` once flows are built                                                                                   | NOT BUILT                                                          |
| RAG (how to migrate)                                                | `document_col` (GAP), `faq_variations` (later)                                                                  | none                                       | needs a manager decision; no table                                                                                                         | NOT BUILT, GAP                                                     |
| medium registry phase 2, visitor log phase 2                        | `medium_registry`, `visitor_logs`, `visitor_logs_view`                                                          | none yet                                   | phase 2                                                                                                                                    | NOT BUILT (MIGRATE_LATER)                                          |
| open chatlogs ?                                                     | `openchat_logs`                                                                                                 | `coverage`                                 | OPEN, reported on every run                                                                                                                | OPEN decision                                                      |
| system.profile ?                                                    | `system.profile`                                                                                                | exporter never exports `system.*`          | EXCLUDE                                                                                                                                    | by design                                                          |
| company and deals no; leads ignore                                  | `company_*`, `deals`, `deal_*`, `leads`                                                                         | `coverage`                                 | EXCLUDE                                                                                                                                    | by design                                                          |
| entry points, export history, import history, contact progress      | `entry_points`, `export_history`, `import_history`, `import_contacts_progress`                                  | `coverage`                                 | EXCLUDE                                                                                                                                    | by design                                                          |
| field history no; node execution history no; shapes no              | `field_history`, `node_execution_history`, `shapes`                                                             | `coverage`                                 | EXCLUDE                                                                                                                                    | by design                                                          |
| project / project config / workspace setting no; source registry no | `project`, `project_configuration`, `workspace_settings`, `source_registry`                                     | `coverage`; org comes from `--org-*`       | EXCLUDE                                                                                                                                    | by design                                                          |
| webhook logs no; backup file no; temp no                            | `webhook_logs`, `meta_callbacks*`, `*_bak/_bkp/_backup`, `temp_*`                                               | `coverage`; exporter skips                 | EXCLUDE (patterns for backup and temp)                                                                                                     | by design                                                          |

## completeness-report generator (design only, NOT built)

Goal: one table per client, one row per feature (the rows of section 12), each with
**migrated N / quarantined N / excluded N / not present N / unaccounted 0**.

Input (read only, all produced by the existing run): `out/<client>/reconcile.json`, `$DUMPS/<client>/manifest.json`, the registry (`resolve()`), and `migration.id_map` / `migration.quarantine` counts through the worker login.

Algorithm, per feature = a list of source collections (the feature map is a small JSON file, `pilot/feature-map.json`, one entry per row of section 12; reviewed by a human, not inferred):

1. `read` = manifest `docs` for each collection of the feature (the file the loader actually read); `0` if the collection is absent from the dump (then the row says "not present in source", count 0).
2. `migrated` = number of `migration.id_map` keys for those collections; `quarantined` = rows of `migration.quarantine` for them (hard rejects, by reason code); `excluded` = excluded-by-rule counts in the run log (e.g. `NON_BROADCAST_SOURCE`, deleted contacts, test broadcasts); soft issues are a separate informational column.
3. `not present` = source fields with no target column, from the reconcile section "Source fields with no target column" (a count of fields and of documents carrying them, not of documents).
4. `unaccounted` = `read - migrated - quarantined - excluded`. The report fails (exit 1) on any value other than 0, and on any feature whose collection disposition is MIGRATE_LATER/GAP/OPEN but has `read > 0`: those rows print `read N, migrated 0, NOT BUILT` so a missing handler is visible, never silently green.
5. Denylisted / EXCLUDE collections: `excluded = read` only if the dump contains them (it should not); the row shows "refused at export" and `read 0`.
6. Output: `out/<client>/completeness.md` (+ `.json`), counts and keys only. Also prints the reconcile exit code and the manifest sha256 of each input so the report is tied to one dump.

Cross-check it by hand once per client: the sum over features of `read` must equal the manifest total minus collections the feature map marks as "not exported by design".

## Not yet proven (needs the real replica)

- That mongosh on the jump host exposes `EJSON.stringify(doc, { relaxed: false })` with the canonical forms used here, and that `print()` of a ~16 MB document is not truncated.
- `getCollectionNames()`, `countDocuments({})` and `find().sort({_id:1})` privileges of the read-only Mongo user, and real cursor timeouts on very large collections (sorted by `_id` on a replica).
- Real ssh behaviour: the exact text of the host-key message on the user's OpenSSH build, `ServerAliveInterval` behaviour, a dropped connection halfway through a big collection (the code treats it as a failed collection; resume restarts that collection from zero).
- The real field names of the Waboo `user` password hash (the projection lists `password`, `passwordHash`, `password_hash`, `hashed_password`, `hash`, `salt`; the in-script stripper catches any credential-named key and the count is in the export record).
- The real shapes of `chathistory`, `broadcasting` and the other documents (the README lists the UNVERIFIED guesses).
