# ADR-0015: Migrating off the legacy Geta system

- **Status:** proposed
- **Date:** 2026-09-16
- **Source:** requirements discussion, 2026-09-15

## Context

The existing platform ("Geta") is a Python/uWSGI application
(`geta-core/src/Resource/ContactModule`, `geta-core/src/Chatbot`). It has
`SubmitContacts.py` exposed as a write API, `LifecycleStages.py`,
`ContactProperties.py`, a chatbot and an inbox.

Positions taken in the discussion:

- the existing system cannot be optimised further; a rewrite was agreed
- two engineers is enough to do it
- contacts migrate in full
- chat history migrates at roughly **90%**, with ~10% accepted as an error
  margin because the underlying chat data is unstable
- raw data is retained so anything missing can be pulled out on request
- **automations were flagged as the risky part**

## Decision

### Scope

| Data                               | Approach                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Contacts                           | **Full.** `contacts.legacy_id` holds the source id; unique per org |
| Contact properties / custom fields | Mapped to `data` JSONB via a field mapping                         |
| Lifecycle stages                   | Mapped to `lifecycle_stage`, with an explicit value map            |
| Chat history                       | **Best effort (~90%).** Raw export archived to S3 first            |
| Conversations                      | Rebuilt as one thread per contact per channel                      |
| Automations                        | **Rebuilt by hand. Not migrated.**                                 |
| Users / roles                      | Recreated; passwords are not migratable (different hash scheme)    |

### Sequence

1. **Archive first.** Full raw export of the legacy database to S3, verified,
   before anything is transformed. This is what makes the 10% acceptable — the
   data still exists, it is just not indexed in the new system.
2. **Dry run into a scratch database.** Produce a reconciliation report: source
   count, loaded count, skipped with reasons.
3. **Review the skips.** Every skipped row gets a reason. "Unknown" is not a
   reason.
4. **Cutover.** Freeze writes on the legacy system, run the final delta, switch
   DNS/clients.
5. **Keep the legacy system readable** (not writable) for an agreed period.

### Why not dual-write

A dual-write window means both systems accept writes and both must converge.
With unstable chat data and no shared id space, convergence is unverifiable.
A short freeze is honest and testable; dual-write is neither.

### Automations

Rebuilt manually, in the new workflow engine, with a written inventory of what
the legacy system did. Migrating automation definitions between two different
engines produces automations nobody understands and nobody can debug — and an
automation that misfires sends real messages to real candidates.

## Consequences

### Positive

- `legacy_id` makes reconciliation a `JOIN`, and makes re-runs idempotent.
- Archiving first turns "we lost 10% of chat history" into "10% is not indexed,
  and here is the export".
- Rebuilding automations forces an inventory of what actually runs — which is
  valuable independent of the migration.

### Negative

- Cutover requires a write freeze. The window must be agreed with the business.
- ~10% of chat history will not be visible in the new inbox. Users must be told
  before cutover, not after.
- Everyone's password is reset at cutover.
- Rebuilding automations by hand is real, unglamorous work that is easy to
  underestimate.

## Open questions

- [ ] How much chat history actually matters? If search over old chats is rare,
      "archive only, do not migrate" may be the better trade.
- [ ] Is there a stable identifier for conversations in the legacy system?
- [ ] Which automations are actually live today, as opposed to merely defined?
- [ ] What is the acceptable freeze window?
- [ ] Do we need the legacy system readable after cutover, and for how long?

## Implementation

`tools/migration/` holds the plan and will hold the extractor/transformer/loader
when this moves from proposed to accepted. Nothing is built yet, deliberately —
the open questions above change the design.
