# Lead handling settings: uncontacted leads, automatic follow-ups, duplicate leads

Status: design, then built in three steps (BL-290, BL-291, BL-292). Product extension: nothing here exists in the Reference platform
(parity note: `docs/threadwise-port/parity/contacts-attributes-tags.md`, section "Lead handling").

The owner's reference screenshots (a lead-management app's Settings pages: Follow Ups, Uncontacted Leads, Duplicate Leads) give the
idea only. This design adapts it to our contacts, tasks, lead sources, owners, record scopes, 21 locales, plan gating, audit and RLS.

**Hard rule of this work: no behaviour change for any workspace until it turns a setting on.** Every setting that would change data
defaults to OFF, existing contacts are untouched (no backfill), and the duplicate-lead default is the code's current behaviour.

**One product, many niches** (`project_generic_multi_niche_product`): a doctor says Patients, a store says Customers. New copy never
bakes a noun into a sentence: labels live in message keys of the existing `contacts-attributes-tags` namespace
(`contacts-attributes-tags.leadHandling.*`), written as whole sentences with the default noun "contact", so the persona vocabulary
overlay (`docs/specs/persona-profiles.md` 7.4) can rebind them later. Code, routes, columns and events say `contact`/`lead` only
technically. Candidate overlay bindings are listed in section 9.

## 1. What exists today (investigation, `origin/main` 7508a315b)

| Area | Today |
| --- | --- |
| Follow-up / next action on a contact | None. No column on `contacts`. Tasks can link a contact (`tasks.contact_id`) and call logging can create one task together with a call (`followUp`, source `manual`). The only "needs follow up" thing is a web preset view (quiet for 7 days, `lastActivityAt`) |
| Tasks | `tasks` table (`status` open/done, `due_at`, `reminded_at`, `assignee_id`, `contact_id`, `source` manual/deal/ai/api/flow). `TasksService.createIn(tx)` for callers that own a transaction. The due sweep (`TaskDueSweepService`, every minute) stamps `reminded_at` and emits `task.due`; the notifications module consumes it. Moving `due_at` re-arms the reminder. A task without a due date is never reminded |
| "Contacted" state | None. `contacts.last_activity_at` is bumped by notes, activities, meetings, files, call logs, customer messages and staff replies and does not say who touched whom, so it cannot mean "contacted" |
| Timeline | `contact_activities` (free-text `activity_type`, `source` user/system/bot), plus notes, meetings, files in their own tables. Only the user-written paths emit events, none carries the contact id in its payload |
| Outbound staff message | `POST /inbox/conversations/:id/messages` -> `enqueueOutbound` -> worker `MessageDispatchService.markSent` (provider accepted). `messages.sender_kind` is `agent`/`bot`/`system`/`broadcast`; human = `agent` with `sender_user_id`. No outbox event exists per outbound message by design. Email goes through the same path. A saved reply fills the composer and is sent as an ordinary text, so a typed text and a saved reply are not distinguishable |
| Automation sends | Campaigns emit `campaign.contact_status_updated` per recipient. Broadcast and flow sends emit nothing per recipient (broadcast mirrors a `broadcast` message into the inbox; flows record a `bot` message with `source: flow`) |
| Calls | `CallLogEntriesService.write` (manual log, mobile ingest, telephony, click-to-call) emits `call.logged`; `call.click_to_call.placed` fires when a call is placed. The contact page Call/Message buttons only open a `tel:` link, a WhatsApp call or chat; nothing records the click |
| Owner change | Five independent writers: `ContactsService.update`, `ContactsService.setAssignee`, `ContactBulkRepository.setOwner` (set-based SQL), `OwnerReassignRepository.moveContacts` (leave batches; its restore sweep moves them back) and `ContactAssignmentEngine` (auto-assign). Only a DB trigger is shared (`stamp_owner_change`, sets `owner_changed_at`) and it cannot tell a restore from a reassign |
| Contact creation | `ContactsService.createOrMatch` (staff UI, public API, Sheets add-on), `resolveOrCreateByIdentity` (inbound messages, lead ingest, telephony, mobile), the CSV import engine, forms builder submit. `contacts.source` and the `contact.created` payload (`via`, `origin`) tell them apart only roughly. There is no phone-book import |
| Lead ingest dedupe | `LeadIngestService.resolveContact`: identity-first (email, then phone via `contact_identities`, then stored normalised values). A match is ALWAYS merged: blanks are filled, nothing curated is overwritten, the owner is kept, a tag and an attribution touch (`lead_attributions`) are added, consent only if the lead carries proof, `lead.updated` is emitted. A new person creates a contact. A separate contact for the same phone or email is impossible today because `contact_identities (org_id, kind, value)` is unique and every create path looks the identity up first |
| Contacts list | Cursor list; filters are one shared shape (`contactFilterShape`) feeding list, stats, bulk "select all matching", export and segments; web presets (`preset-views.ts`) and quick chips (`QUICK_PRESETS`); columns in `lib/columns.ts` |
| Settings | Hub tiles from `features/<domain>/settings.ts`; typed per-workspace documents live in one-row-per-org tables (`call_logging_settings`, `contact_consent_settings`, `compliance_settings`), read with defaults when the row is absent, written with `row_version` + audit + outbox in one transaction. `platform_settings` is global and not used |
| Permissions | `admin.settings.manage` exists in `permission_defs` (Owner and Admin presets) and no controller uses it. A new tenant key would be unknown to `provision_workspace_presets` and to custom roles, so this work adds none |

## 2. Decisions

### 2.1 Settings storage: `lead_followup_settings`

One table, one row per (workspace, section): `org_id`, `section` (`uncontacted` | `follow_ups` | `duplicates`), `config jsonb`,
`updated_by`, `row_version`, `updated_at`. RLS forced, `touch_row`. A missing row = the defaults in `@crm/contracts`
(`lead-handling/settings.ts`), merged per field, so a new knob never needs a data migration. Per section rows (not one document)
so the three screens never 409 each other. Reads and writes need `admin.settings.manage` (Owner and Admin). Writes follow the
`contact_consent_settings` pattern: first save has no `rowVersion`, later saves must send it (409 `ROW_VERSION_CONFLICT`), audit
row with a field delta and outbox `lead_handling.settings_changed` in the same transaction. No cache: the hooks read one primary-key
row per event, which is cheaper than a stale answer after the owner flips a toggle.

### 2.2 Uncontacted: `contacts.uncontacted_since timestamptz NULL`

Null = contacted (every existing contact, no backfill). A timestamp = uncontacted and since when (sort "oldest waiting first", future
response-time reports). One column instead of a boolean plus a date. Partial index
`(org_id, uncontacted_since) WHERE uncontacted_since IS NOT NULL`. `contacts_touch()` is extended so a change of this column alone
keeps `updated_at` and `row_version` (like `last_activity_at`): a reply sent by a colleague must not 409 someone's open edit form.
The flag changes by: a setting (creation, reassign), a contact action (clears), or a person (manual). A transition writes an audit
row (`uncontactedSince`, `cause`) and the outbox event `contact.uncontacted_changed {uuid, uncontacted, cause}`; it does NOT emit
`contact.updated`, so no customer flow starts because a flag moved.

Settings (`uncontacted`), defaults:

| Key | Default | Meaning |
| --- | --- | --- |
| `clearOn.contactButton` | on | Click Call, SMS, Email or WhatsApp on a contact; a logged or placed outbound call (or an answered one) |
| `clearOn.message` | on | A staff member's message, template, saved reply or file from the inbox that the provider accepted (typed text and saved replies are the same thing to the server) |
| `clearOn.automation` | on | A campaign, broadcast or flow send reached the contact (not first-reply, FAQ or consent-keyword bots: those are not a person contacting the lead and would clear the marker the moment a lead arrives) |
| `clearOn.activity` | on | A staff member adds a timeline activity, note or meeting |
| `markNew.manual` | off | A staff member creates the contact in the app |
| `markNew.import` | off | CSV import and the Sheets add-on |
| `markNew.leadSource` | off | Lead sources (webhook, Meta lead ads, portals), forms and API-key integrations, when a new contact is created (a lead that merges into an existing contact never flips it) |
| `onReassign` | `keep` | `keep` or `mark`: an owner change (single, bulk, leave batch, auto-assign) marks the contact uncontacted; a restore after leave never does |

The four `clearOn` toggles default on because clearing only acts on contacts that are already uncontacted, and those exist only after
the workspace opts in or someone marks one by hand: with defaults, no contact ever changes. Inbound-message contacts, WhatsApp
address-book sync and telephony-created contacts are not in `markNew` (the reference lists three methods; so do we).

### 2.3 Follow-up: a task of kind `follow_up`, no contacts column

`tasks.kind text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','follow_up'))` and a partial unique index
`(org_id, contact_id) WHERE kind = 'follow_up' AND status = 'open'`: a contact has at most one open follow-up, its **next
follow-up**, and it is a real task, so the task list, due reminders (`task.due`), notifications, scopes and audit already work and no
parallel reminder system exists. A denormalised `contacts.next_follow_up_at` would need a sync trigger on tasks and a second
"someday" column; a join (lateral, served by the unique index) is always consistent. States of a contact: none (no open follow-up),
someday (open, `due_at` null, never reminded), overdue, today, upcoming (in the workspace zone). Auto-created tasks use
`source = 'auto'` (added to the source CHECK). The generic task API cannot set `kind`; follow-ups are written through
`PUT /contacts/:id/follow-up` and the automatic rules. The task title is `Follow up` (an editable task title, not a localised UI string;
the web shows a localised "Follow-up" badge on kind `follow_up`); the contact is the link, so no noun is stored.
Settings (`follow_ups`), defaults:

| Key | Default | Meaning |
| --- | --- | --- |
| `updateWhen.none` | off | Contact has no follow-up (a someday follow-up counts as none: it has no date) |
| `updateWhen.overdue` | off | Follow-up is overdue |
| `updateWhen.today` | off | Follow-up is due today |
| `updateWhen.future` | off | Follow-up is due after today |
| `defaultDate` | `{ kind: 'days', days: 3 }` | `days` 1-365 (presets 1 day, 3 days, 1 week = 7, 1 month = calendar month; custom N days), `someday` (open task without a date) or `none` (the open follow-up is completed, nothing new) |
| `defaultTime` | `09:00` | Alert time (`HH:mm`, 24 h stored, shown as hour, minute, AM/PM by locale) |

Time zone: the follow-up is a reminder for the staff member, so the day and the alert time are read on the **workspace** zone
(`organizations.settings.timezone`), not the contact's zone (`contacts.timezone` stays for quiet hours of messages TO the contact).
`due_at` = calendar day (workspace zone, DST-safe, pure helper) + `defaultTime`. Business-hours / holiday skipping is not applied
(the reference counts calendar days); noted as a possible later option. Assignee: the contact's owner, else the person who contacted.
A per-user override is not built: the repo has no per-user preference store (BL-271, BL-230 are the same gap); workspace defaults only,
recorded as BL-293.

### 2.4 Duplicate leads: `duplicates` section

`mode`: `merge` (default, the current behaviour) | `create_new`. `noteOnMerge` (default off): add a timeline entry "Lead from <source>
merged into this contact" (off by default because a new timeline row also bumps `last_activity_at`, which would change what existing
workspaces see). It applies to the lead ingest path (webhook, Meta lead ads via the ingest port, portals), which is what the
reference calls "external lead source integrations"; forms builder submissions keep their own identity-first flow and are not touched.
`create_new` inserts a separate contact for a lead whose phone or email already belongs to one: the new row
carries the typed phone/email, takes an identity only when nobody holds it (the contested identities stay with the original, so inbound
messages keep routing to the original and Remove duplicates can merge them later), counts against the plan's contact cap, emits
`contact.created`, and leaves a timeline entry "Possible duplicate of ..." on the new contact. Merge rules are the current ones (blanks
only, first-touch `source` kept, a new `lead_attributions` touch each time, consent only with proof, owner kept). Idempotent on the
lead event: a redelivery hits the event claim (`duplicate` result); a retry of a stored event that already holds a contact reuses it.

## 3. Hooks: who applies the settings

One service, `ContactTouchService` (`apps/api/src/modules/crm/lead-handling/`), exported by the crm barrel. A call is synchronous, in
the caller's transaction, wrapped in a savepoint with the error swallowed and logged: a failure here must never fail a message,
a call log or a contact create. It reads the settings rows once per call and does nothing (no write) when the contact has no flag and
no rule matches.

| Trigger | Where | Applies |
| --- | --- | --- |
| contact button | new `POST /v2/contacts/:id/touch {channel}`, called by the web when Call, Message, e-mail, SMS or WhatsApp is activated (contact page, quick view, list quick actions); `record.contacts.update` + the contact's scope | clearOn.contactButton, follow-up |
| outbound call | `CallLogEntriesService.write` when a person handled it and it did not fail or reach a wrong number (an outbound call counts even unanswered, like the button; an inbound call counts when answered) | clearOn.contactButton, follow-up |
| staff message | `MessageDispatchService.markSent` when `sender_kind = 'agent'` (and a user id) | clearOn.message, follow-up |
| automation | `CampaignEvents.contactStatus` (`sent`) and the broadcast dispatch (recipient `sent`) call the service in their own transaction; the flow sender and campaign mirror reach it through `ConversationsService.recordOutbound` (source `flow`, `campaign`, `broadcast`) | clearOn.automation, follow-up |
| timeline | `ContactActivitiesService.create`, `ContactNotesService.create`, `ContactMeetingsService.create` (user-written only) | clearOn.activity, follow-up |
| create | `ContactsService.createOrMatch` (actor user = manual, api key = lead source), the import engine, the Sheets add-on (import), lead ingest and forms submit on `created` | markNew.* |
| reassign | after the owner update in the five writers; not the restore sweep | onReassign |
| manual | `PUT /contacts/:id/uncontacted`, `POST /contacts/bulk/uncontacted` (ids or filter, max 5,000 / 50,000) | sets or clears |

Idempotency and precedence. Clearing and marking are state sets (running twice is the same state). The follow-up rule looks only at the
current state and the computed `due_at` is deterministic (day + time), so a redelivered touch recomputes the same instant and writes
nothing. The four follow-up toggles describe mutually exclusive states, so they never conflict. A touch first clears uncontacted,
then evaluates the follow-up; they are independent. A person's own future follow-up is replaced only if `updateWhen.future` is on
(the owner's explicit choice). Manual always wins over a rule at the moment it is made; a rule never runs because of a manual
follow-up edit.

## 4. API (all `/v2`, problem+json, `Idempotency-Key` on writes)

Step 1: `GET /lead-handling/settings` (all sections, each with `rowVersion`), `PUT /lead-handling/settings/uncontacted`
(`admin.settings.manage`); `POST /contacts/:id/touch`, `PUT /contacts/:id/uncontacted`, `POST /contacts/bulk/uncontacted`
(`record.contacts.update`); contact list filter `uncontacted=true`; `ContactResponse.uncontactedSince`; segment field
`uncontacted`. Step 2: `PUT /lead-handling/settings/follow-ups`; `PUT|DELETE /contacts/:id/follow-up`, `POST
/contacts/:id/follow-up/done|snooze` (`record.contacts.update`, creating needs `record.tasks.create` only for a person, not
for the rules); `ContactResponse.nextFollowUp {taskId, dueAt, someday, assigneeId}`; contact filter `followUp=overdue|today|upcoming|someday|none`
and `followUpFrom/To`; `TaskResponse.kind` and a `kind` list filter. Step 3: `PUT /lead-handling/settings/duplicates`.

## 5. UX

- **Settings** (Settings hub, section Automation, shortcut from the Contacts gear menu): tiles "Uncontacted leads", "Follow-ups",
  "Duplicate leads", gated `admin.settings.manage`; each page is the consent-settings pattern (toggles, radio groups, Save/Discard,
  row-version conflict alert). Follow-ups: four toggles, default date radio (1 day, 3 days, 1 week, 1 month, custom N days, someday,
  no follow-up), alert time. Plan gating: none (core contacts feature).
- **Uncontacted**: a quiet dot-and-text marker in the list row name cell, a chip in the record header (next to the stage), the quick
  view, a smart view "Uncontacted" and a quick chip, "Mark as contacted / uncontacted" in the
  record "..." menu and in the bulk bar. Hidden entirely when nobody is uncontacted (no empty chrome).
- **Follow-up**: a "Next follow-up" row in the record header / left column (date, overdue in red, "Someday", "Set follow-up"), with
  Done, Snooze 1 day / 3 days / next week, Change date; a list column and smart views "Follow-up today", "Overdue", "Someday".
- All strings are keys in `messages/<21 locales>/contacts-attributes-tags.lead-handling.json` (tile copy in `settings.json`), help guides
  `lead-handling-*.md` (en + ar), list/record guides updated. RTL and keyboard follow the existing screens.

## 6. Data, RLS, privacy

New table with `org_id`, forced RLS, `tenant_isolation`, `touch_row`. New columns `contacts.uncontacted_since`, `tasks.kind` are not
personal data (no registry entry needed; `registry.spec.ts` is run). The duplicate timeline text names the lead source, never the
person's identifiers. Audit rows for every settings write and every flag or follow-up transition. Record scopes: the touch, mark and
follow-up endpoints reuse the contact scope check; list filters go through the shared scope condition; the rules run as the workspace's
system actor after the caller's own permission already allowed the action.

## 7. Migrations (hand written, RLS-checked)

- Step 1 `20261231090200_lead_handling_uncontacted.sql`: `contacts.uncontacted_since`, index, `contacts_touch()` replaced, `lead_followup_settings`.
- Step 2 `20261229090100_lead_handling_follow_ups.sql`: `tasks.kind`, `chk_tasks_source` gains `auto`, the unique open follow-up index, a contact lookup index.
- Step 3: no migration (the section value is allowed from step 1).

## 8. Tests

Unit: settings defaults and merge, pure rules (which touch clears what, follow-up state machine, default date and zoned alert time
incl. DST and month ends, create-method mapping). Real-Postgres e2e per step (own testcontainers): defaults change nothing; each
touch kind with its toggle on and off; idempotent redelivery; scopes (a member outside the contact's scope gets 404 and no change);
tenant isolation (another workspace's settings and contacts untouched); permissions (403 without `admin.settings.manage`);
reassign vs restore; the follow-up task, its reminder (`task.due`) and the unique open follow-up under concurrency; lead ingest
merge vs create_new, no consent from a merge, idempotent retry. Web: settings screens (render + save + conflict), list marker, chip,
filters, menu action, bulk action, follow-up header actions; i18n key parity across 21 locales. Browser check with Playwright on a
private stack, screenshots in `_work/parity/lead-followup-settings/`.

## 9. Candidate persona vocabulary bindings

`leadHandling.page.uncontacted.title`, `.description`, `leadHandling.uncontacted.chip`, `leadHandling.view.uncontacted`,
`leadHandling.followUp.title`, `leadHandling.duplicates.title`, and the radio labels "Create a new contact" / "Merge into the existing
contact". Sentences inside dialogs keep the default noun until the overlay phase 2.

## 10. Not built (recorded)

BL-293 per-user follow-up defaults; skipping closed days with business hours; per-lead-source duplicate rule; follow-up reminders by
message to the contact (appointment reminders are a separate persona feature); a response-time report on `uncontacted_since`.
