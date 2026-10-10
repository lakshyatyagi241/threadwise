# Parity: developer-rest-api-v1 (API)

How the customer REST API, the Developers console and the developer docs compare with Reference. Behavior is paraphrased; nothing here is
copied from the reference. Spec: [inventory](../inventory/developer-rest-api-v1.md). Wiring: [wiring map](../wiring/developer-rest-api-v1.md).
API reference: [docs/api/developer-rest-api-v1.md](../../api/developer-rest-api-v1.md).

## Status

- Built and tested: key console (create, list, revoke), bearer-key authentication, per-key rate limit, envelopes, scopes, plan gates, `/me`,
  `/usage`, contacts, contact groups, deals, flows, templates (partial), broadcasts, campaigns, scheduled messages, messages, media,
  conversations, devices, the OpenAPI document, the Developers console page and the public docs page.
- Blocked on other domains (recorded in the tracker as `blocked`): auto-replies (TW-API-038 to 043, the auto-reply-keywords domain has
  only a schema) and webhooks (TW-API-140 to 148, the integrations domain has only the two tables).
- Partial: template create and update (no location pin, no carousel; stored as a draft), template send (body variables only), template
  header-media upload (guard runs, file not used), single send of a location (recorded as text), Twilio-engine senders (no channel kind).

## Twin runs (Playwright, Reference against ours)

Our API and web ran from this worktree on the scratch database `api_scratch` (never the shared `crm`); every key the run made was revoked.

| Run                                            | Sides           | Result                                                      |
| ---------------------------------------------- | --------------- | ----------------------------------------------------------- |
| Developer docs page (TW-API-149), 29 scenarios | Reference and ours | no defect; 122 same, 8 intended, 2 structure items reviewed |
| API without a key (TW-API-001), 19 scenarios   | Reference and ours | pass; 178 same, 5 intended                                  |
| API with a key (TW-API-001), 243 scenarios     | ours only       | all executed, nothing to compare against                    |
| Developers console (TW-API-151), 38 scenarios  | ours only       | 3 minor findings left (below)                               |

First pass found 14 defects; all were fixed and re-run: contact phone composition lost digits for a national number that starts like its
country code; non-numeric `per_page` was refused instead of clamped; `/me` and `/usage` exposed our 30 plan keys instead of Reference's five;
deal errors named `ownerId` and used our codes; a wrong method answered 404 instead of 405; CORS refused other origins; the OpenAPI text
carried internal feature ids and raw group headings; the console had a stuck spinner on a failing list call, a name field without
`required`, a badge below contrast, small tap targets.

Left open, all console and minor: the shell's unlabelled `aside` and second breadcrumb `nav` trip an axe landmark rule (shell, not this
page); two tap targets under 24 px in the shell breadcrumb; the slow-create scenario could not slow the request (a manual probe shows the
button disabled with a busy label while the request runs).

## Not verified against the running Reference

The keyed API twin and the console twin need a signed-in Reference workspace, which this run did not use (account creation and password entry
on the reference are the user's to do). So these ours-side results rest on the reference source and the inventory, not a live comparison:
every keyed endpoint, key mint, revoke and the one-key rule, lowercase `bearer` (ours accepts the scheme in any case; Reference is expected to
refuse it), empty and text bodies, a 2 MB body, rate-limit headers under load, the plan gate on deals, permission-denied and cross-tenant
cases with two real workspaces, and the failed-attempt lockout. To finish: register a fresh Reference workspace and run
`parity.sh run apps/web/e2e/developer-rest-api-v1/parity/TW-API-001.twin.mjs --workers 1` and the `TW-API-151` spec with
`THREADWISE_EMAIL`/`THREADWISE_PASSWORD` and the `PARITY_*` variables set.
Also not run: any real WhatsApp send (sends are queued to a stubbed channel in tests), webhook delivery (not built).

## Intended differences (each is a decision, with the reason)

### Keys and console (TW-API-001 to 005, 010, 151)

| Difference                                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The number of live keys comes from the plan limit `api_keys` (seeded 1, 5, 20), not a fixed one                                                                                                                                                                   | The plan domain already owns the number; Free keeps Reference's one. Open question for the owner: force 1 everywhere                                                                                         |
| Creating a key is serialised per workspace; Reference's check and insert could both pass                                                                                                                                                                             | Race fix                                                                                                                                                                                                  |
| A key mint and a revoke write an audit row and an outbox event                                                                                                                                                                                                    | Reference left no trace; platform rule                                                                                                                                                                       |
| The console needs `api.keys.read`, `create`, `revoke` (Owner and Admin hold them) and the plan feature                                                                                                                                                            | Reference let any member open it, though its menu showed it to admins only; the menu's rule is now the server's                                                                                              |
| Keys are looked up by prefix and compared in constant time (sha256), not looked up by hash                                                                                                                                                                        | Same secrecy, no timing oracle; argon2 on every call would be a CPU lever                                                                                                                                 |
| `last_used_at` is written at most once a minute per key                                                                                                                                                                                                           | Reference rewrote one row on every call                                                                                                                                                                      |
| A failed-authentication throttle per address (30 a minute)                                                                                                                                                                                                        | Reference had none; security hardening                                                                                                                                                                       |
| Scopes are enforced when a key has any; a key with none is full access, as in Reference                                                                                                                                                                              | Reference never read them; a console key made without touching "Restrict this key" has none, so it stays full access                                                                                         |
| The console create form has "Restrict this key" (off by default) with a scope picker; the key list shows a "Full access" badge on a key without scopes, or "Restricted" and its scope names; `POST /v2/developer/keys` takes an optional `scopes` list (AUTH-073) | Security hardening: a console key can be limited to what an integration needs, and a full-access key is never silent. The default is Reference's full access. See Round 3 in `auth-registration-security.md` |
| The key console answers uuids, cursor lists; the raw key is returned by create only and never stored in the idempotency cache                                                                                                                                     | Platform conventions; the secret must not sit in Redis for a day                                                                                                                                          |
| Lowercase `bearer` is accepted                                                                                                                                                                                                                                    | The HTTP scheme name is case-insensitive                                                                                                                                                                  |
| Console: one card per active key, the create form is hidden while the cap is reached; base URL from the web app's API origin; quickstart greets the workspace by name; "Back" goes to Settings                                                                    | Plans can allow several keys; the web app has no Reference menu or brand constant                                                                                                                            |

### Envelope, errors, paging (TW-API-007)

| Difference                                                                                                                                    | Reason                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ids are uuids                                                                                                                                 | Platform rule: internal ids never leave                                                         |
| Lists are cursor based: `meta` is `limit`, `next_cursor`, `has_more`; `page` is refused with a message naming the cursor; there is no `total` | Platform rule (no offset, no COUNT); `per_page` and `limit` are clamped to 1 to 100 like Reference |
| Every validation failure is HTTP 422 in the `{ error }` envelope, with `details` per field in Reference's snake_case                             | Reference redirected without `Accept: application/json` and used a different body there (bug fix)  |
| Unknown route and wrong method answer in the envelope (404, 405 with `Allow`)                                                                 | Reference answered HTML or Laravel's default body                                                  |
| An unreadable JSON body without a key answers 422, Reference 401                                                                                 | The body parser runs before authentication on this platform                                     |
| Plan errors are 403 `plan_feature_disabled` and 402 `plan_limit`                                                                              | Reference's codes, kept                                                                            |
| `/api/v1` and the OpenAPI document answer every origin with no credentials                                                                    | Reference's behavior, kept without widening the staff policy                                       |

### Resources

| Area       | Difference and reason                                                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account    | `credits` are minor units as a string with a `currency` field (money rule); `plan.id` is the plan slug; `/me` `limits` and `/usage` `meters` carry Reference's five meters with its key names                                                                                                                                      |
| Contacts   | Creating a contact whose phone or email already belongs to one returns that contact (201, `meta.created: false`) instead of a duplicate; `source` is `api`; an unparseable phone is 422; extra columns and group membership are written in a second transaction of the same request; `PATCH` is an alias of `PUT`               |
| Groups     | A name that exists (any case) answers 200 with the existing group (`meta.existing`); colour must be `#RRGGBB` (a database check; Reference took any text)                                                                                                                                                                          |
| Deals      | No admin bypass of the plan gate (keys have no role); a first-placement timeline row on create; an owner must be an active member (422 on `owner_user_id`); a lost reason is kept only on a lost deal; delete also returns `id`                                                                                                 |
| Templates  | Create answers status `draft`, Reference stored it as approved (only Meta approves here); 422 `tpl_no_connection` without a WhatsApp number; an approved template cannot be edited (409); names are stored normalised; category is the Meta category in lower case; send answers 202 with a queued `message_id` and a null `wamid` |
| Flows      | Subscriber counts cover every subscriber, not the page; enrol returns `failure_reason`                                                                                                                                                                                                                                          |
| Broadcasts | `schedule_at` is read in its `timezone` (default UTC) where Reference ignored it; unparseable values are 422, not 500; a paused broadcast can be stopped; broadcast refusals are 422 with a reason, a plan limit is 402                                                                                                            |
| Campaigns  | Stop covers running and paused (wire `stopped` is our cancelled); a stopped campaign can be deleted; create returns the stored row with zero counts as Reference does                                                                                                                                                              |
| Scheduled  | Lead time 2 minutes (Reference 1); plan feature, limit and wallet checks run at scheduling time; with no `device_id` the newest connected device is used                                                                                                                                                                           |
| Messages   | A send waits up to 3 seconds for the worker and answers `sent` or `pending`; the real `failure_reason` and `error_code` are returned; media links are key-authenticated and short lived; `device_id` allows 64 characters; threads are per channel and number; a send to a new number creates a contact                         |
| Docs       | The spec uses a `{{brand}}` token replaced when served; the page's filter hides endpoint cards as well as links; code blocks have no syntax colours; sample responses come from the spec; the rate-limit pill states the real per-key limit (Reference said none)                                                                  |

## Defects accepted as risks (decide before release)

- A template or send that reaches the chat pipeline can leave a contact behind when the plan limit or a closed channel refuses it at enqueue time.
- The per-template daily send cap is not implemented on `POST /templates/{id}/send`.
- A campaign without `template_id` or `flow_id` is accepted (as Reference) and fails at send time.
- The campaign quota counts live rows, so deleting a campaign reopens quota (Reference counted a ledger).
- Campaign list and statistics do not persist the "all recipients done" status that the campaign detail read does.
- A broadcast stop sets `cancelled` and the sender stops at its next pass; recipient rows stay `pending` (as Reference).
- Reads for messages, conversations and devices query their tables directly under RLS because no service lists them for a key.
- A national contact number written with a country code without a plus (`91`) and starting with those digits is taken as already carrying it (Reference compares the same way).

## Foreign files edited (additive, for the owners to review)

- `broadcasts`, `campaigns`, `scheduled-queue-warmer`, `flow-runtime-engine`: barrel and module `exports:` lines only (vedant).
- `wallet-message-billing`: exports `WalletQueryService` (own domain).
- Kernel seams: `common/filters/problem-exception.filter.ts` (a renderer registry), `main.ts` (attach the docs service; CORS delegate for the
  customer API), `app.module.ts` (module registration), `packages/contracts/src/index.ts`.
- Tests of other domains updated because the key guard now delegates to a shared service: `plan-feature-routes.spec.ts` and
  `route-permission-coverage.spec.ts` (a new controller decorator counts as public).
- `ownership.json`: inventory marked written; the docs page routes and messages added to this domain's zone.
- `help-center/pending.json` and `settings-planned.ts`: the entries this feature replaced were removed.

## Outbound webhooks (TW-API-140 to 148): the workspace's Webhooks screen

Built: the Settings > Integrations > Webhooks tile (it was a "Soon" placeholder), `GET/POST/PATCH/DELETE /v2/webhooks`, `POST /v2/webhooks/:id/test`, `GET /v2/webhooks/:id/deliveries`, signed delivery through the queue with retries, and the delivery log. Evidence: API unit 14 (`test/unit/outbound-webhooks`), API e2e 7 (`test/e2e/outbound-webhooks`), web 245 in the touched areas, and the Playwright twin `apps/web/e2e/outbound-webhooks/parity/TW-API-140.twin.mjs` (tile, form validation, add with events and secret, test send, delivery log, switch off, delete; accessibility clean).

| Where          | Reference                                                      | Here                                                                                                                                                                                                                                   | Reason                                                                               |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| URL check      | any URL, no SSRF check, redirects followed                  | https only, no credentials in the URL, must resolve to public addresses (checked at save and again at every send), redirects not followed                                                                                              | TW-API-141 rule 6 (flagged for the port)                                             |
| Plan and role  | the API path skipped the plan feature, the cap and any role | needs `webhooks.manage` to change and `webhooks.read` to look; the `outbound_webhooks` plan feature and the `webhooks` cap apply                                                                                                       | TW-API-141 QUIRK, closed                                                             |
| Secret and URL | encrypted                                                   | encrypted; the secret is never returned, the screen shows "Signed"                                                                                                                                                                     | same                                                                                 |
| Events         | 17 names, values not validated                              | the 11 events the product already records (contact created, updated, deleted, tag added, opted in; deal stage changed; task created, assigned; template status; device status; conversation reopened); unknown names are refused (422) | the message and broadcast delivery events of Reference's catalogue have no producer yet |
| Delivery       | inline in the request or after it, no queue, 3 tries        | one queued job per (event, endpoint), 6 tries with exponential backoff from 10 s, a 4xx other than 408/429 is not retried, 10 s timeout, only the first kilobyte of the answer is kept                                                 | TW-API-144 and 147 port notes                                                        |
| Signature      | HMAC with brand-prefixed headers                            | `X-Webhook-Signature: sha256=` HMAC of `<timestamp>.<body>`, with `X-Webhook-Id` (stable across retries), `X-Webhook-Event`, `X-Webhook-Timestamp`                                                                                     | TW-API-146                                                                           |
| Delete         | the delivery log stayed behind                              | the log goes with the endpoint                                                                                                                                                                                                         | TW-API-142 QUIRK                                                                     |
| Edit           | n/a                                                         | last write wins: the endpoint's health counters change its row version on every delivery, so a version check would reject nearly every edit                                                                                            | recorded in the contract                                                             |

Not built here: the `/api/v1/webhooks` REST routes (TW-API-140 to 142 on the API-key side; the screen's routes are staff-side), the message and broadcast delivery events (TW-API-145 producers), and the Instagram/inbox `outbound_webhooks` subsystem. The `webhooks` plan cap already counts both tables.
