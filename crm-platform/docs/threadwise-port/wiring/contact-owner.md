# Wiring map: contact owner (CON, extension)

Scope of this map: `contacts.owner_id`, everything that writes it and every screen or endpoint that reads or filters by it.
Inventory: [contacts-attributes-tags.md](../inventory/contacts-attributes-tags.md) (TW-CON-009, 010, 019). API: [docs/api/contacts-attributes-tags.md](../../api/contacts-attributes-tags.md).
Reference has only a creator, `contacts.user_id` ("creator/owner; NULL for system-captured"), which no screen shows; an owner you can see, filter by and
change is an extension recorded in [parity/contacts-attributes-tags.md](../parity/contacts-attributes-tags.md) (section "Contact owner"). The leave and
delegation design is [specs/contact-owner-leave-and-delegation.md](../../specs/contact-owner-leave-and-delegation.md).

## Data

| Id           | What                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-OWN-001 | `contacts.owner_id` (bigint, nullable, composite FK `(org_id, owner_id)` to `users`, SET NULL), index `idx_contacts_org_owner` (migration `0004_crm_contacts`); API shape `ownerId` (user uuid or null) |
| WIRE-OWN-002 | Record scope `own` / `team` is a condition on `owner_id` (`contactScopeCondition`); the owner is therefore also who sees a contact                                                                      |

## Writers of an owner

| Id           | Writer                                                                            | Where                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-OWN-003 | Contact form (add, edit)                                                          | `POST /contacts` (`ownerId` omitted = creator, `null` = nobody), `PATCH /contacts/:id` (sent only when changed); `components/contact-form-modal.tsx` |
| WIRE-OWN-004 | Contact profile "Change owner"                                                    | `PATCH /contacts/:id` with `ownerId` and `rowVersion`; `components/owner-control.tsx`                                                                |
| WIRE-OWN-005 | Bulk Update dialog, ticked rows                                                   | `POST /contacts/bulk/update` (`values.ownerId`), explicit ids                                                                                        |
| WIRE-OWN-006 | Bulk Update dialog, "select all N matching", and the shortcut on the Owner filter | `POST /contacts/bulk/owner` (selection = ids or filter, `ownerId`); owner only                                                                       |
| WIRE-OWN-007 | `POST /contacts/assignee` (older ids-only route)                                  | kept; same scope rule; no screen uses it                                                                                                             |
| WIRE-OWN-008 | Lead sources, forms, inbox capture, CSV import                                    | `ContactsService` callers pass `ownerId` or leave it: import stamps the importer; auto-assignment rules are BL-013 (not built)                       |

## Readers and filters

| Id           | Consumer                                                            | Where                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WIRE-OWN-009 | List filter                                                         | `GET /contacts?ownerId=` (one person), `ownerIds=a,b` and `unassigned=true` (several people and/or nobody); one SQL builder (`contactConditions`) for list, tiles, bulk, export |
| WIRE-OWN-010 | Hub toolbar "Owner" menu, URL `?owner=<ids and none>`               | `components/contacts-toolbar.tsx`, `lib/filters.ts`, `api/contacts.ts` (`contactFilterBody`)                                                                                    |
| WIRE-OWN-011 | Owner column (hidden by default), also in the segment members table | `lib/columns.ts`, `components/contacts-list.tsx`, `components/contacts-readonly-table.tsx`; names from `GET /contacts/assignees`                                                |
| WIRE-OWN-012 | Picker data                                                         | `GET /contacts/assignees` (`record.contacts.read`): active people with `canAssign` for the caller's update scope; `api/owners.ts`                                               |
| WIRE-OWN-013 | Segments: the `owner` field (equals, in, not in, is empty)          | rule builder `features/segments`, compiler `segment-compiler.ts`; "Save as segment" turns `ownerIds` / `unassigned` into rules (`contactFilterToRules`)                         |
| WIRE-OWN-014 | CSV export                                                          | column `owner_email` (empty when unassigned); the importer ignores it                                                                                                           |
| WIRE-OWN-015 | Audit and events                                                    | single edit: audit delta + `contact.updated`; bulk owner: one audit row (`ownerId: {old, new}`) and one `contact.updated` (`ownerId`, `previousOwnerId`) per contact moved      |
| WIRE-OWN-016 | Companies and deals own the same way (their own screens)            | `companies.owner_id`, `deals.owner_id`; not changed here                                                                                                                        |

## Gaps recorded (not lost)

- Sort by owner: not offered (needs the person's name from another table and has no index). Header is not a sort button.
- CSV import mapping of an owner email column: Reference has none; recorded as follow-up (BL-111).
- Update of stage, status or custom properties for "all N matching": the bulk update endpoint takes ids only; the dialog offers only the owner there.
- Owner on leave, delegation, auto-assignment: BL-112 / BL-013, design in the spec above.
