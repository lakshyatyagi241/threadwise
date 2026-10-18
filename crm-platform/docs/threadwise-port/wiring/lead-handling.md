# Wiring map: lead handling (LH, extension)

Scope of this map: the per-workspace lead handling settings (uncontacted leads, automatic follow-ups, duplicate leads), `contacts.uncontacted_since`, and every action that
reads or writes them. Spec: [specs/lead-followup-settings.md](../../specs/lead-followup-settings.md). API: [api/lead-handling.md](../../api/lead-handling.md). Not in the Reference
platform; recorded in [parity/contacts-attributes-tags.md](../parity/contacts-attributes-tags.md) (section "Lead handling"). Backlog BL-290 to BL-293.

## Data

| Id          | What                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-001 | `contacts.uncontacted_since timestamptz` (null = contacted), partial index `idx_contacts_org_uncontacted`; `contacts_touch()` keeps `row_version` when only this column (or `last_activity_at`) moves |
| WIRE-LH-002 | `lead_followup_settings (org_id, section, config jsonb, updated_by, row_version)`, PK `(org_id, section)`, sections `uncontacted`, `follow_ups`, `duplicates`; RLS forced; a missing row = defaults   |

## Settings

| Id          | Setting (section `uncontacted`)            | Reader                                                                 |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| WIRE-LH-003 | `clearOn.contactButton`                    | `ContactTouchService.touch(.., 'contact_button')`                      |
| WIRE-LH-004 | `clearOn.message`                          | `ContactTouchService.touch(.., 'message')`                             |
| WIRE-LH-005 | `clearOn.automation`                       | `ContactTouchService.touch(.., 'automation')`                          |
| WIRE-LH-006 | `clearOn.activity`                         | `ContactTouchService.touch(.., 'activity')`                            |
| WIRE-LH-007 | `markNew.manual`, `.import`, `.leadSource` | `ContactTouchService.markNew` / `markNewMany`                          |
| WIRE-LH-008 | `onReassign`                               | `ContactTouchService.afterReassign`, `marksOnReassign` (set-based SQL) |

## Hook points (who calls the touch service)

| Id          | Caller                                                                                                                                                                                                                   | Source / method     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| WIRE-LH-010 | `POST /contacts/:id/touch`, called by the web when Call, Message, e-mail, SMS or WhatsApp is pressed (contact page, quick view, list row actions)                                                                        | contact_button      |
| WIRE-LH-011 | `CallLogEntriesService.write` (manual log, mobile ingest, telephony, click-to-call) when `callReachedContact`                                                                                                            | contact_button      |
| WIRE-LH-012 | `MessageDispatchService.markSent` for a `sender_kind = agent` message (inbox, e-mail, SMS, every channel)                                                                                                                | message             |
| WIRE-LH-013 | `ConversationsService.recordOutbound` with a `senderUserId` (message) or source `flow`, `campaign`, `broadcast` (automation)                                                                                             | message, automation |
| WIRE-LH-014 | `CampaignEvents.contactStatus` (status `sent`), `BroadcastDispatchService` (recipient `sent`)                                                                                                                            | automation          |
| WIRE-LH-015 | `ContactActivitiesService.create`, `ContactNotesService.create`, `ContactMeetingsService.create` (user actor only)                                                                                                       | activity            |
| WIRE-LH-016 | `ContactsService.createOrMatch` (user = manual, api key / channel partner = lead source; Sheets add-on = import), `ContactImportEngine` (import), `resolveOrCreateByIdentity` with origin `lead` or `form` (lead source) | markNew             |
| WIRE-LH-017 | `ContactsService.update` (owner), `setAssignee`, `ContactBulkRepository.setOwner`, `OwnerReassignRepository.moveContacts`, `ContactAssignmentEngine` (not `restoreContacts`)                                             | afterReassign       |
| WIRE-LH-018 | `PUT /contacts/:id/uncontacted`, `POST /contacts/bulk/uncontacted` (a person, by hand)                                                                                                                                   | manual              |

## Consumers of the marker

| Id          | Consumer                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-020 | `GET /contacts` (`uncontactedSince`, filter `uncontacted`), bulk selections, segment field `uncontacted`, `GET /contacts/stats` (`uncontacted`)                                        |
| WIRE-LH-021 | Web: dot in the list name cell, chip in the record header and quick view, "Uncontacted" view and quick chip (only while the stats count is above zero), More menu item, bulk More menu |
| WIRE-LH-022 | Audit `contacts` (`uncontactedSince`, `cause`), outbox `contact.uncontacted_changed`; personal-data registry: no new personal data                                                     |
| WIRE-LH-023 | Settings screen `/uncontacted-leads` (tile `uncontacted-leads`, section Automation, gate `admin.settings.manage`, shortcut from `/contacts`); help guide `uncontacted-leads`           |

## Not wired (recorded)

Contacts created by an inbound message, the WhatsApp Business address-book sync and telephony are not in the three creation methods, so they never start uncontacted. A
conversation message sent by a bot that is not a flow, campaign or broadcast (first reply, FAQ, consent keyword) is not a person contacting the lead and never clears the marker.

## Step 2: automatic follow-ups (BL-291)

| Id          | What                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-030 | `tasks.kind` (`task` or `follow_up`), `chk_tasks_source` gains `auto`, unique index `uq_tasks_open_follow_up (org_id, contact_id) WHERE kind = 'follow_up' AND status = 'open'`                                             |
| WIRE-LH-031 | `lead_followup_settings` section `follow_ups`: `updateWhen.none/overdue/today/future`, `defaultDate`, `defaultTime`; reader `FollowUpService.applyAfterTouch` (called by `ContactTouchService.touch` in the same savepoint) |
| WIRE-LH-032 | `TasksService.openFollowUp / setFollowUpIn / completeFollowUpIn / deleteFollowUpIn / workspaceZone`: the only writers of a follow-up task (audit, outbox, `task.assigned`, reminder re-arm)                                 |
| WIRE-LH-033 | `FollowUpService.set / snooze / done / clear` behind `PUT, POST, DELETE /contacts/:id/follow-up...` (contact scope; creating needs `record.tasks.create`)                                                                   |
| WIRE-LH-034 | `TaskDueSweepService` stamps and announces a dated follow-up like any task (`task.due`); a someday follow-up has no `due_at` and is never claimed                                                                           |
| WIRE-LH-035 | `GET /contacts` (`nextFollowUp`, filter `followUp`, shared by bulk selections and export), `GET /contacts/stats` (`withFollowUp`); web: header row, list column, filter, views, More menu, task badge                       |
| WIRE-LH-036 | Settings screen `/follow-ups` (tile `follow-ups`, section Automation, gate `admin.settings.manage`, shortcut from `/contacts`); help guide `follow-ups`                                                                     |

Not wired (recorded): the follow-up filter is not a segment field, so "Save as segment" does not carry it (BL-294); a follow-up for a deal or a company; per-user defaults (BL-293); skipping closed days with the business hours.

## Step 3: duplicate leads (BL-292)

| Id          | What                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-040 | `lead_followup_settings` section `duplicates`: `mode` (`merge` default, `create_new`), `noteOnMerge`; reader `LeadHandlingSettingsService.duplicatesIn`, writer `PUT /lead-handling/settings/duplicates` |
| WIRE-LH-041 | `LeadIngestService.resolveContact`: a match with `mode = create_new` (and not a test lead) goes to `createSeparate`, which calls `ContactsService.resolveOrCreateByIdentity({ duplicateOf })`            |
| WIRE-LH-042 | `resolveOrCreateByIdentity` with `duplicateOf`: skips the identity and stored-number lookups, creates the contact, and adds the identity only when nobody holds it (the original does)                   |
| WIRE-LH-043 | `LeadIngestService.leaveTimelineNote`: `lead_duplicate` on a separate contact, `lead_merged` on a merge when `noteOnMerge`; both `source = system`, written through `ContactActivitiesRepository`        |
| WIRE-LH-044 | `fillContact(.., separate)`: a separate contact's phone or e-mail that another contact holds is not a conflict (no "needs review")                                                                       |
| WIRE-LH-045 | Settings screen `/duplicate-leads` (tile `duplicate-leads`, section Automation, gate `admin.settings.manage`, shortcut from `/contacts`); help guide `duplicate-leads`                                   |

Not wired (recorded): a per-lead-source rule; lead-form submissions and other creation paths that already match by identity (they merge as before); moving the identity to the newest contact.
