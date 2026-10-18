# Wiring map: lead handling (LH, extension)

Scope of this map: the per-workspace lead handling settings (uncontacted leads, automatic follow-ups, duplicate leads), `contacts.uncontacted_since`, and every action that
reads or writes them. Spec: [specs/lead-followup-settings.md](../../specs/lead-followup-settings.md). API: [api/lead-handling.md](../../api/lead-handling.md). Not in the Reference
platform; recorded in [parity/contacts-attributes-tags.md](../parity/contacts-attributes-tags.md) (section "Lead handling"). Backlog BL-290 to BL-293.

## Data

| Id         | What                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-001 | `contacts.uncontacted_since timestamptz` (null = contacted), partial index `idx_contacts_org_uncontacted`; `contacts_touch()` keeps `row_version` when only this column (or `last_activity_at`) moves |
| WIRE-LH-002 | `lead_followup_settings (org_id, section, config jsonb, updated_by, row_version)`, PK `(org_id, section)`, sections `uncontacted`, `follow_ups`, `duplicates`; RLS forced; a missing row = defaults |

## Settings

| Id         | Setting (section `uncontacted`)                  | Reader                                                                 |
| ---------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| WIRE-LH-003 | `clearOn.contactButton`                          | `ContactTouchService.touch(.., 'contact_button')`                      |
| WIRE-LH-004 | `clearOn.message`                                | `ContactTouchService.touch(.., 'message')`                             |
| WIRE-LH-005 | `clearOn.automation`                             | `ContactTouchService.touch(.., 'automation')`                          |
| WIRE-LH-006 | `clearOn.activity`                               | `ContactTouchService.touch(.., 'activity')`                            |
| WIRE-LH-007 | `markNew.manual`, `.import`, `.leadSource`       | `ContactTouchService.markNew` / `markNewMany`                          |
| WIRE-LH-008 | `onReassign`                                     | `ContactTouchService.afterReassign`, `marksOnReassign` (set-based SQL) |

## Hook points (who calls the touch service)

| Id         | Caller                                                                                         | Source / method          |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| WIRE-LH-010 | `POST /contacts/:id/touch`, called by the web when Call, Message, e-mail, SMS or WhatsApp is pressed (contact page, quick view, list row actions) | contact_button |
| WIRE-LH-011 | `CallLogEntriesService.write` (manual log, mobile ingest, telephony, click-to-call) when `callReachedContact` | contact_button |
| WIRE-LH-012 | `MessageDispatchService.markSent` for a `sender_kind = agent` message (inbox, e-mail, SMS, every channel)      | message                  |
| WIRE-LH-013 | `ConversationsService.recordOutbound` with a `senderUserId` (message) or source `flow`, `campaign`, `broadcast` (automation) | message, automation |
| WIRE-LH-014 | `CampaignEvents.contactStatus` (status `sent`), `BroadcastDispatchService` (recipient `sent`)                  | automation               |
| WIRE-LH-015 | `ContactActivitiesService.create`, `ContactNotesService.create`, `ContactMeetingsService.create` (user actor only) | activity            |
| WIRE-LH-016 | `ContactsService.createOrMatch` (user = manual, api key / channel partner = lead source; Sheets add-on = import), `ContactImportEngine` (import), `resolveOrCreateByIdentity` with origin `lead` or `form` (lead source) | markNew |
| WIRE-LH-017 | `ContactsService.update` (owner), `setAssignee`, `ContactBulkRepository.setOwner`, `OwnerReassignRepository.moveContacts`, `ContactAssignmentEngine` (not `restoreContacts`) | afterReassign |
| WIRE-LH-018 | `PUT /contacts/:id/uncontacted`, `POST /contacts/bulk/uncontacted` (a person, by hand)                         | manual                   |

## Consumers of the marker

| Id         | Consumer                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-LH-020 | `GET /contacts` (`uncontactedSince`, filter `uncontacted`), bulk selections, segment field `uncontacted`, `GET /contacts/stats` (`uncontacted`)          |
| WIRE-LH-021 | Web: dot in the list name cell, chip in the record header and quick view, "Uncontacted" view and quick chip (only while the stats count is above zero), More menu item, bulk More menu |
| WIRE-LH-022 | Audit `contacts` (`uncontactedSince`, `cause`), outbox `contact.uncontacted_changed`; personal-data registry: no new personal data                       |
| WIRE-LH-023 | Settings screen `/uncontacted-leads` (tile `uncontacted-leads`, section Automation, gate `admin.settings.manage`, shortcut from `/contacts`); help guide `uncontacted-leads` |

## Not wired (recorded)

Contacts created by an inbound message, the WhatsApp Business address-book sync and telephony are not in the three creation methods, so they never start uncontacted. A
conversation message sent by a bot that is not a flow, campaign or broadcast (first reply, FAQ, consent keyword) is not a person contacting the lead and never clears the marker.
