# Parity evidence: channel-email (Gmail mailboxes)

Reference 1.7.0. Inventory: [inventory/channel-email.md](../inventory/channel-email.md) (TW-MAIL-019 to 030 are what this build delivers; 001 to 018
describe Reference's MailTrixy bridge and are **not** ported). Plan: [plan/channel-email-build.md](../plan/channel-email-build.md). API:
[docs/api/channel-email.md](../../api/channel-email.md). Wiring: [wiring/channel-email.md](../wiring/channel-email.md). Runbook:
[runbooks/google-mail-setup.md](../../runbooks/google-mail-setup.md).

Evidence is automated and backend only. **Nothing was run against a real Google or Gmail account**: the OAuth endpoints and the Gmail API are a local stand-in
(`apps/api/test/e2e/channel-email/fake-gmail.ts`) written from Google's documentation, so what is proved is our code against that description. A live run
needs the platform's Google OAuth client and a test user (runbook) and is listed under open issues. The web is another session's.

- `apps/api/test/unit/channel-email/*.spec.ts`: header and address parsing (RFC 2047, groups, quoted commas), Gmail payload parsing (multipart/alternative,
  charsets, attachments by id and inline, `cid` images, no Message-ID, no payload), skip rules (draft, spam, trash, sent), automated detection, HTML sanitising (scripts,
  handlers, links, remote and `cid` images, the 64K cap, hostile input size), MIME build (threading headers, cc/bcc, encoding, header injection), the signed state
  (round trip, forged, expired, other purpose, the Calendar state not verifying here), the sync decisions and the whole `MailSyncService` against a fake Gmail
  (backfill, history paging, cap and leftover, 404 repair, outage, refusal, poison mail, lapse, needs_reauth).
- `apps/api/test/e2e/channel-email/mailboxes.e2e.spec.ts`: the consent URL, the callback (sealed tokens, channel creation, outbox, audit), reconnect, plan limit
  (route and callback), `wrong_account`, denied / missing scope / no refresh token, bad states, not configured, rename with row version, sync now, disconnect and
  reattach, permissions, the plan gate, tenant isolation.
- `apps/api/test/e2e/channel-email/mail-sync.e2e.spec.ts`: the quiet backfill, two mails of one thread in ONE conversation with the contact linked by email, reopen,
  redelivery, automated mail, attachments and their download (and its refusals), the size cap, history 404 repair, outage and heal, a 401 refreshed once, a reply
  from the inbox (threading headers, cc, bcc, subject, thread id, idempotent), no re-import of our own sent mail, a retry finding what it already sent, refusals in
  our words, `invalid_grant` -> `needs_reauth` and reconnect, and the lapse of the add-on (sync, sweep and send closed, data kept).

## Intended differences from Reference

| #   | Reference                                                                                             | Threadwise                                                                                                                                                                                                        | Why                                                               |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Email is a bridge to a separate product (MailTrixy): link a mailbox that exists there, it pushes mail | **Native Gmail**: the workspace connects its own Google account by OAuth; the platform reads and sends through the Gmail API. No MailTrixy client, no shared secret.                                              | Owner decision (plan, decision 1); TW-MAIL-018 is not ported.     |
| 2   | One mirror row per MailTrixy account in `workspace_email_accounts`                                    | New table `mail_mailboxes` (sealed tokens, sync cursor, status, last error). `workspace_email_accounts` is left untouched.                                                                                        | The bridge's table has no place for tokens or a cursor.           |
| 3   | One conversation per MailTrixy conversation                                                           | **One conversation per Gmail thread** (`peerKey t:<threadId>`), title = the first subject and never overwritten, contact linked by the sender's address.                                                          | The inbox's thread model; replies on a resolved thread reopen it. |
| 4   | Plain text plus a 64 KB HTML copy in message meta                                                     | Sanitised HTML (64K characters) beside the plain text, cc/bcc, headers, attachments in the object store, **remote images blocked** until an agent asks.                                                           | TW-MAIL-026.                                                      |
| 5   | Mail history is imported on link and repaired by a manual per-row Sync                                | First sync stores 7 days **quietly** (no unread, no notifications, no automation); a sweep every 60 s keeps it current with `history.list`; a lost cursor (404) is repaired by re-reading the last days, quietly. | Nothing in Reference schedules a sync.                            |
| 6   | Auto-replies and bounces were not told apart                                                          | `automated` is detected (Auto-Submitted, Precedence, List-Id, bounces, no-reply) and stored on the message; the inbox never feeds it to automation.                                                               | First slice of TW-MAIL-032.                                       |
| 7   | Unlinking a mailbox                                                                                   | Disconnect revokes at Google, wipes the tokens and **keeps the conversations** (channel read-only); reconnecting the same address reattaches them.                                                                | Plan decision 6.                                                  |
| 8   | No mailbox limit                                                                                      | Plan limit `email_mailboxes` (default 3), counted over connected mailboxes (disconnected ones free their place); feature `email_channel` is a paid add-on.                                                        | Spec; the Forms add-on model.                                     |
| 9   | Email flows, email campaigns, mailbox-scoped auto-reply rules                                         | **Not in this build** (IMAP/SMTP, Microsoft, personal mailboxes, Gmail push, outbound attachments, signatures are later). Automated mail is the only thing kept out of automation.                                | Scope of the plan.                                                |
| 10  | An attachment of any type was a MailTrixy link                                                        | Files go through the chat media policy: a type it refuses, a file over 10 MB, or past 25 MB per mail is **not stored** and listed with `tooLarge: true`.                                                          | Safety; the contract has one flag for "not stored".               |

## Known limits (not defects)

- Only mail that reaches the **INBOX** is synced (a filter that skips the inbox, spam, trash and drafts are not). Mail sent from Gmail itself is not imported.
- A mailbox with more than about 1,000 new messages in one run stores the oldest `MAIL_SYNC_MAX_MESSAGES` (100) per run and continues on the next; a backfill reads the
  newest 1,000 messages of the last 7 days.
- A mail the pipeline cannot store (a bug) is counted and skipped, so one bad mail never blocks a mailbox; the hub shows "N messages could not be stored".
- Google's 7-day refresh-token limit while the OAuth app is in **Testing** (runbook) shows up as `needs_reauth` after a week.
- The 60 s poll is not Gmail push (TW-MAIL-033, later).

## Status of each feature (backend)

| Feature     | Status       | Notes                                                                                                                                                     |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TW-MAIL-019 | backend-done | Mailbox model, list, rename. The hub screen is the web session's.                                                                                         |
| TW-MAIL-020 | backend-done | Connect by Google OAuth (signed state, public callback, outcomes).                                                                                        |
| TW-MAIL-021 | backend-done | Backfill, incremental sync, 404 repair, ledger idempotency, backoff. Not run against live Gmail.                                                          |
| TW-MAIL-022 | backend-done | Reply with threading headers, cc/bcc, thread id; idempotent on the client id. New message to a contact is not built (thread starts from a customer mail). |
| TW-MAIL-023 | backend-done | Several mailboxes per workspace, plan limit, reattach. Per-mailbox defaults are the web's.                                                                |
| TW-MAIL-024 | seam-done    | One channel per mailbox through the inbox's existing channel filter; the switcher and From selector are the web's.                                        |
| TW-MAIL-025 | backend-done | One conversation per thread, contact by email identity.                                                                                                   |
| TW-MAIL-026 | backend-done | Sanitised HTML, cc, headers, attachments and their download.                                                                                              |
| TW-MAIL-027 | not built    | Rich composer, attachments out, signatures (P1, later). cc/bcc/subject extras are done.                                                                   |
| TW-MAIL-028 | backend-done | `needs_reauth`, `error` with a reason, reconnect, Sync now.                                                                                               |
| TW-MAIL-029 | backend-done | `GoogleMailConfig` reads the `googleMail` settings group with the env fallback; the console page is the integration packaging's.                          |
| TW-MAIL-030 | backend-done | Keys `mail.mailboxes.read/manage`, feature `email_channel`, limit `email_mailboxes`.                                                                      |

## Browser checks (Playwright), `/email` hub

Reference has no native email screen (it lists linked MailTrixy mailboxes in its Devices table), so there is nothing to twin-compare. Instead:

- `apps/web/e2e/channel-email/hub.spec.ts` against the running stack: 5 pass (hub and usage meter, Connect Gmail with Google configured asks the API, setup guide, Soon cards for IMAP and Microsoft, `?email=denied` outcome). Two checks skip by design on any one stack (provider-not-ready needs Google unset, a connected mailbox needs a first sync). With the platform Google env set, `POST /v2/email/mailboxes/connect` returns a real `accounts.google.com` URL carrying the `gmail.readonly` and `gmail.send` scopes, offline access and the callback redirect (no sign-in was completed).
- Ours-only page probes (`e2e/channel-email/parity/adhoc-email-hub.twin.mjs`: load, a11y, responsive, keyboard, degraded, auth, perf): 25 same, 0 blocker or major. One real defect found and fixed: the "Not connected" and "Soon" pills failed colour contrast (muted text on a muted background). Two minor findings remain and come from the shared shell, not this screen: two 19-20px links in the Settings breadcrumb (`settings-hub`) and two shell landmarks without distinct labels.
- Inline pictures: a mail's `cid:` pictures are pointed at the attachment route in the thread frame, which may load pictures from its own origin only; remote pictures stay blocked until "Load images".
