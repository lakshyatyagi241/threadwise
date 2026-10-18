# ADR-0030: Workspace closing state: a 30-day, export-only window before deletion

- **Status:** proposed (the product decisions D3 and O6 of the storage spec are approved by the owner, 2026-10-18; the session design below needs a security review before phase S6 builds it)
- **Date:** 2026-10-18
- **Deciders:** Lakshya (approved D3 and O6); security review to confirm the export-only session
- **Builds on:** [ADR-0028 (workspace inactivity lifecycle)](0028-workspace-inactivity-lifecycle.md). Spec: [storage-quota-and-archival.md](../specs/storage-quota-and-archival.md) sections 10.3, 11 and 15 (phase S6, backlog BL-300). Nothing in this ADR is implemented.

## Context

The owner's decision D3: when a workspace is cancelled it gets an **export window** of 30 days, then its data is deleted, and a legal hold wins over deletion.

Today, ADR-0028 already deletes an owner-deleted workspace 30 days after the owner pressed delete (`status = 'deleted'`, `deleted_at`, erased by `LifecycleService`, stopped by a
legal hold). That gives the 30 days. What is missing is the **window**: a `deleted` workspace cannot sign in at all, so its people cannot take their data out during those
30 days, and the data export that exists (`workspace-export.service.ts`) is three CSV files (contacts, conversations, messages) and no files. A "30-day export window" that nobody can
enter is only a delay.

Two more facts shape the choice. Subscription renewal and packs must stop at closure without ending the data. And a held workspace must not be erased, so the platform is
left holding its files, which have a cost that must be visible (spec 10.3, O6).

## Decision

**1. A closing sub-state, not a new top-level status.** `organizations.status` stays `active | suspended | archived | deleted`. Closing is `status = 'deleted'` plus a new
`closing_until timestamptz` (= `deleted_at + 30 days`) and `closed_by`. A workspace is "closing" while `status = 'deleted' AND closing_until > now()` and nothing has erased it.
`closing_until` is the same clock ADR-0028's erase already waits for; one number drives both, so the export window can never be shorter or longer than the time to erasure.
The owner can **cancel the closure** on any day of the window (status back to `active`, `closing_until` cleared, billing resumed by the owner, not automatically).

**2. Export-only sign-in for the owner and admins.** While closing, only a user holding the workspace owner flag or the system role `admin` can sign in, and the session is a
distinct type, `export_only`: it can call the export endpoints, the "cancel closure" endpoint and read-only account facts, and **nothing else**. Every other route refuses it
with a stable code before any controller runs (a guard on the session type, default deny). No send, no upload, no webhook, no API key use, no integration callback acts for a
closing workspace; the worker skips it for sends, campaigns, flows and the AI. Public surfaces (the widget, forms, the REST API keys) answer as for a suspended workspace.

**3. A real files export.** The closing screen offers the existing CSV files plus a **files export**: a zip built by a worker (queue `workspace-export`), covering the
workspace's counted files (call recordings, inbox media, mail attachments, contact files, training files, team chat attachments) with a manifest, mailed as a
short-lived link, counted in no quota, rate limited (one build at a time per workspace) and size capped with a clear message above the cap (the operator can raise it).
Held subjects' files are included for the workspace's own admins: a hold stops deletion, not the owner's access to their own data.

**4. Reminders** at days 0, 15, 25 and 29 (the reminder pattern and the `org_lifecycle_log` of ADR-0028), naming the date of deletion and how to export or cancel.

**5. Erasure at the end, and holds win.** At `closing_until` the existing erase runs (purge queue empties both buckets and the registry, counters vanish with the organization;
financial sales records follow ADR-0028's 8-year rule). If a workspace-level or subject legal hold is active (`org_has_active_legal_hold` or the operator `legal_hold`), **the erase
does not run** (O6): the workspace stays frozen, all its hot objects move to the cold tier (cost bounded and visible on the operator's "held closed workspaces" list with the hold's category
and `review_at`), and erasure resumes when the hold is released. There is no partial erase of only the non-held data.

## Consequences

- Sign-in code gains a second session type with a default-deny route guard. That is the security-sensitive part and the reason this ADR needs a review before S6: a bug there either
  leaves a closed workspace able to act (sends, uploads) or locks the owner out of their own export.
- ADR-0028's `deleted` today means "cannot sign in"; this changes it to "export only until `closing_until`". The sign-in refusal for `deleted` becomes conditional on the window.
- Plan lapse and pack end do **not** use this state (spec 10.2): they never delete anything.
- A closing workspace still counts in the operator's storage view (its hot bytes fall to zero only when erased or archived to cold).
- Backups are unchanged and still disclosed (privacy spec G6).

## Alternatives considered

- **A new `closing` status value.** Clearer in queries, but every `status = 'deleted'` check (and the erase sweep) would need to learn it, and two clocks could disagree.
- **Let a closing workspace sign in normally.** Simplest, but it keeps sending messages and uploading files for 30 days after the owner said they were leaving; the window must not be a loophole.
- **Email the export instead of a sign-in.** No new session type, but it moves the whole export (possibly gigabytes, personal data) through mail and gives the owner no way to cancel the closure.
- **Erase only the non-held data when a hold exists.** Cheaper to keep, but it destroys the context a hold exists to preserve and is a legal-advice question we should not decide in code (O6).

## Open for the review

The session lifetime of `export_only` (proposed: the normal access token lifetime, no refresh beyond `closing_until`), whether a second factor is required to start the files export, and the
size cap of the zip.
