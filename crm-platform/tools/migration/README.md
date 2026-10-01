# Legacy Geta migration

**Status: planned. Nothing here is built yet, deliberately** — the open
questions about the legacy system change the
design, and building before they are answered wastes the work.

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

| Data               | Approach                                                    |
| ------------------ | ----------------------------------------------------------- |
| Contacts           | **Full.** `contacts.legacy_id` holds the source id          |
| Contact properties | Mapped into `data` JSONB via a field mapping                |
| Lifecycle stages   | Mapped to `lifecycle_stage` with an explicit value map      |
| Chat history       | **~90% best effort.** Raw export archived to S3 first       |
| Conversations      | Rebuilt as one thread per contact per channel               |
| Automations        | **Rebuilt by hand. Not migrated.**                          |
| Users / roles      | Recreated. Passwords cannot migrate (different hash scheme) |

The 10% chat-history gap was accepted in the requirements discussion because
the underlying chat data is unstable. It is only acceptable **because the raw
export is archived** — the data still exists, it is just not indexed in the new
system.

## Intended layout

```
tools/migration/
  README.md          this file
  extract/           read the legacy database, write raw JSONL to dumps/
  transform/         legacy shape -> new shape, with an explicit field map
  load/              COPY into the new database, idempotent on legacy_id
  reconcile/         source count vs loaded count vs skipped-with-reason
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
- Loads are **idempotent on `legacy_id`** — `ON CONFLICT (org_id, legacy_id) DO
UPDATE`. A re-run must be safe, because there will be re-runs.
- Loads run as the **owner** (`MIGRATION_DATABASE_URL`) in privileged mode,
  because they write across tenants.
- The reconciliation report is produced **before** cutover, not after.
- Automations are rebuilt manually. Migrating definitions between two different
  engines produces automations nobody understands — and an automation that
  misfires sends real messages to real candidates.

## Open questions — answer before building

- [ ] How much chat history actually matters? If search over old chats is rare,
      "archive only, do not migrate" may be the better trade.
- [ ] Is there a stable conversation identifier in the legacy system?
- [ ] Which automations are actually live today, versus merely defined?
- [ ] What write-freeze window is acceptable to the business?
- [ ] How long must the legacy system stay readable after cutover?
