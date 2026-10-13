# Data subject request (DSAR) runbook

Interim manual procedure until the rights service (BL-143) exists, and the process the service will automate. Design:
[privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 4.5. Not legal advice; deadlines need counsel
confirmation.

## Who answers

- A person asking about data a **workspace** holds about them (a contact, lead or customer of a business using the platform): the
  workspace is the controller and answers; we give the workspace the tools. If such a person writes to us, forward to the workspace
  owner and tell the requester we did so (decision D11).
- Staff users asking about their own account, and billing/security data: we answer.

## Clock

Day 0 is receipt. Default target: complete within 30 days (GDPR, one month; some US states allow 45 days, other regimes differ). Log
receipt date, verification date, due date. Escalate at 15 and 25 days.

## Steps

1. **Log** the request: type (access, export, rectification, erasure, restriction, objection, portability, consent withdrawal), channel,
   who, workspace.
2. **Verify identity** proportionately. Contact: reply from the same channel identity (send a one-time code to the WhatsApp number or
   the email on file); never reveal whether the identity exists until verified. Staff: logged-in session or email confirmation.
3. **Find the data** using the module register
   [wiring/privacy-and-data.md](../threadwise-port/wiring/privacy-and-data.md). Run the finder per contact id across every listed
   table and storage prefix.
4. **Decide exceptions:** invoices and payment records (statutory retention), consent proof (legitimate interest in proof; anonymise),
   open disputes, legal hold. Write the reason.
5. **Execute**
   - Access/export: contacts card, messages, notes, files, leads, orders, call logs and recordings, consent ledger (the ledger export:
     `GET /v2/contact-consent/...`, see [contact-consent.md](../api/contact-consent.md)). Deliver as an archive over a verified channel,
     expire the link in 7 days.
   - Erasure: today deleting a contact does not remove messages, files, recordings, leads, orders or call logs (spec gap G2). Until
     BL-143, an operator-run script per table is needed; do not run ad hoc deletes without review. Replace identifiers on records you
     must keep with a token.
   - Rectification: edit the contact; the audit log records the change.
   - Withdrawal/objection: record a `withdrawn` event for every channel and purpose the person names.
6. **Storage and caches:** queue file deletes for media, contact files and recordings; confirm the purge queue drained.
7. **Backups:** erased data remains in backups for up to 14 days local and up to 12 months off-site
   ([backup-restore.md](../runbooks/backup-restore.md)). Say so in the reply. Keep an **erasure log** (subject token, date, tables) and
   re-run it after any restore.
8. **Sub-processors:** if the data was sent to an AI or other vendor that retains it, send their deletion request (register:
   [subprocessor-register.md](subprocessor-register.md)).
9. **Reply** within the clock with what was done and what was kept and why. Keep the proof (counts per table, timestamps, no personal
   data) for the retention period of the erasure log (platform-owned, ADR-0028 pattern).
10. **Close** and record lessons; if the registry missed a table, add it to the wiring register.

## Template replies

To be written with counsel: acknowledgement, identity check, extension notice, refusal with reason, completion.
