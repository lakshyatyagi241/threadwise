---
name: wadesk-verify-parity
description: >-
  Prove a ported feature behaves like WaDesk by running both side by side and
  recording evidence per acceptance criterion. Use this whenever someone says
  "verify WD-XXX", "does it match wadesk", "compare with wadesk", "parity
  check", "is this feature really done", "mark verified", "check my
  implementation against the reference", or before moving a tracker row from
  done to verified and before a PR that completes a feature. Produces
  docs/wadesk-port/parity/<domain>.md and classifies every difference as
  intended or a defect.
---

# Verify parity against the running WaDesk

Passing tests prove the code does what _you_ understood. This proves it does what _WaDesk_ does. Run it after
`wadesk-e2e-tests` are green.

## Setup

1. Reference app: invoke `wadesk-run-reference` (`start.sh`), log in as the seeded admin. It runs on a local test
   DB; do not connect real channels, send real messages, or use real payment details.
2. Our stack: `pnpm infra:up`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev` (+ `pnpm dev:worker` if the feature is async),
   the web app when it exists. Use a seeded org and staff user.
3. Anything that needs a live provider session (WhatsApp QR pairing, real sends, real gateway callbacks) cannot be
   compared live. Compare those through payload fixtures and the code path described in the entry, and say so in the file.

## Procedure

For **each Given/When/Then and each UX item** of the entry:

1. **Reference:** perform it in WaDesk (browser, or `curl` with the session) and capture what happened: the visible result
   (text, states, disabled/hidden controls), the request/response shape, the rows it wrote or changed (read-only
   `SELECT` on the reference DB: `mysql -uwadesk -pwadesk_local_pw wadesk`), side effects (jobs, mails, webhooks, audit/log rows).
2. **Ours:** perform the same input, capture the same things (API response as problem+json or data envelope, rows via SQL under
   the app role, audit row, outbox event, queue job, UI).
3. **Compare** field by field. Only three outcomes are legal:
   - `same` — equivalent behavior.
   - `intended` — differs on purpose. Allowed reasons: an architecture rule (cursor pagination instead of page numbers/totals,
     uuid ids, hard delete + audit instead of soft delete, problem+json errors, optimistic locking, tenant scoping/RLS,
     idempotency keys, permission keys instead of role names), or a deliberate fix of a WaDesk bug (`QUIRK` in the entry).
     Write the reason.
   - `defect` — anything else. Fix it, re-run, and record the final state; do not leave defects in the file as history.
4. Write the row in `docs/wadesk-port/parity/<domain>.md` (create it from the template below if absent).

Edge cases to always exercise on both sides: empty state, validation failure per rule, limit/plan gate reached,
lacking permission, duplicate submit, a second tenant trying to see the row, deletion of a row that other rows reference.

## File template `docs/wadesk-port/parity/<domain>.md`

```markdown
# Parity evidence — <domain>

WaDesk 1.7.0 vs our commit <sha>. Verified by <owner> on <date>.

## WD-<CODE>-<NNN> — <title>

| #                                                                                                                        | Criterion / UX item         | WaDesk observed                               | Ours observed                       | Result   | Note / reason          |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------- | ----------------------------------- | -------- | ---------------------- |
| 1                                                                                                                        | Given ... When ... Then ... | POST x -> 302, row inserted with status=draft | POST /v2/x -> 201, row status=draft | same     |                        |
| 2                                                                                                                        | List paginates              | page=2 shows next 15                          | cursor load-more, limit 50          | intended | cursor pagination rule |
| Evidence: request/response snippets, SQL results (trimmed, no personal data). Screenshots go on the PR, not in the repo. |
```

## Finish

- Any `defect` fixed and re-verified; every `intended` row has a reason that maps to a rule or a recorded QUIRK.
- Inventory entry corrected if WaDesk turned out to behave differently from what it says.
- `tracker.py set WD-XXX-NNN verified --pr <n>` (see `wadesk-parity-tracker`).
- Stop the reference app when done: `bash .claude/skills/wadesk-run-reference/scripts/stop.sh`.
