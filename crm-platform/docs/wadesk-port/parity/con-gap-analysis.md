# CON (contacts, attributes, groups, deals): route-level gap analysis

Source: `_work/manifests/routes.json` (WaDesk route table), `schema/table-map.md`, and the existing `apps/api/src/modules/crm/*` controllers.
Method limit: only route names, tables and controller names were available. The WaDesk source code, Documentation and database are not on
this machine, so request/response shapes, validation and edge cases below are NOT yet verified. Treat every "covered" as "a route exists".

## Contacts (`ContactsController`, `Api/V1/ContactController`, `Api/App/ContactGroupController`)

| WaDesk route                                     | Our API (v2)                                | State                                       |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------- |
| GET/POST `contacts`, GET/PUT/DELETE `contacts/{id}` | `contacts` list, create, get, patch, delete | exists                                      |
| POST `contacts/bulk-delete`                      | `contacts/bulk/delete`                      | exists                                      |
| POST `contacts/bulk-group`                       | none                                        | missing                                     |
| POST `contacts/bulk-tag`                         | `tags/attach` (check bulk semantics)        | partial                                     |
| POST `contacts/bulk-export`                      | none                                        | missing                                     |
| POST `contacts/import`, `import-preview`, GET `sample-csv` | none                              | missing                                     |
| POST `contacts/dedupe`                           | none                                        | missing                                     |
| GET/POST `contacts/{id}/tags`, DELETE `.../tags/{tagId}` | `contacts/:id/tags` get and delete, `tags/attach` | exists (verify)                      |
| `api/v1/contacts` (public REST API, API-key auth) | none (API domain `api`)                    | missing, belongs to the developer-API domain |
| `api/app/contacts`, `get-contacts` (mobile)      | none (MOB domain)                           | missing, belongs to the mobile-API domain   |
| Extras we have and WaDesk lacks                  | assignees, field-history, notes, files, meetings, activities, saved views | keep, not in WaDesk |

## Contact groups (`contact-groups`, `api/v1/contact-groups`, `api/app/contact-groups`)

WaDesk: list, create, update, delete, bulk-delete. Table `contact_groups` is drafted in `20261001103500_con_wadesk_schema.sql`.
Our API: no module. **Missing entirely** (also needs the contact-to-group membership table).

## Attributes (`AttributesController`; table `attributes` and `contact_custom_fields` map to our `fields` registry, ADR-0017)

| WaDesk route                  | Our API                          | State  |
| ----------------------------- | -------------------------------- | ------ |
| GET/POST `attributes`, PUT/DELETE `attributes/{id}`, GET `attributes/api/list` | `fields` list, create, patch, delete | exists (verify types, system attributes, validation) |

## Tags

WaDesk has two tag surfaces: contact tags (via `ContactsController`) and inbox conversation tags (`team-inbox/api/tags`, owned by the inbox domain).
Our API: `tags` module exists. Conversation tagging waits for the inbox domain.

## Deals and pipelines (`DealsController`, `Api/V1/DealController`; tables `deals`, `deal_activities`, `pipelines`, `pipeline_stages`)

WaDesk (14 web routes plus 5 REST): list, create, show, update, delete; stage move; mark won; mark lost; add activity; complete task;
reports; stages JSON; settings; contact search. Our API: no deals or pipelines module (domain `deals-pipelines`, inventory not written).
**Missing entirely.**

## Contact-form messages

`POST contact` (public form) and `admin/contact-messages*` belong to the marketing-site / admin domains, not CON.

## Suggested order

1. Contacts gaps: bulk-group, bulk-tag, bulk-export, import (preview, commit, sample CSV), dedupe.
2. Contact groups module (migration is already drafted).
3. Attributes parity pass (compare types, system attributes, validation against WaDesk behaviour).
4. Deals and pipelines (new module: pipelines, stages, deals, activities, won/lost, reports).
5. Public REST `api/v1/*` and mobile `api/app/*` later, as thin layers on the services above (API and MOB domains).

## Needs the WaDesk source or running app

Request/response shapes, validation rules, CSV import rules, dedupe logic, the deals report maths, plan limits on contacts and the
`QUIRK` list per feature. None of these can be written from the route table alone.
