# API: deals, pipelines, the board, the timeline and reports

Domain `deal` (WD-DEAL-001 .. 047). Base path `/v2`. Errors are `application/problem+json` with a stable `code` and a `requestId`;
the codes this domain adds are `DEAL_*` in `@crm/contracts` `common/errors.ts`. Request and response shapes live in
`packages/contracts/src/deals-pipelines/`. Live docs: `/docs`. Every id on the wire is a uuid. Decisions where the port differs
from WaDesk: "Port decisions" in `docs/wadesk-port/inventory/deals-pipelines.md`.

All routes need a staff bearer token, the plan's **sales pipeline** (`422 PLAN_FEATURE_LOCKED` otherwise, reads included) and the
capability in brackets. "scope" means the caller's record scope (`all`, `team`, `own`) is applied to the deal's **owner**: a deal
outside it is `404`, never `403`. Literal paths (`board`, `reports`, `tasks`, `order`) are registered before `:id`.

Money is a decimal **string** in major units of the deal's own currency (`"100.50"`), never a number; the decimals follow the
currency (JPY none, KWD three, everything else two), the cap is 99,999,999. A list of totals is always **per currency**; add
`convertTo=USD` to also get one converted figure (rates from the `currencies` table; a currency with no rate is named in
`unconverted` and `converted` is `null`, never guessed at 1.0).

## Capabilities

| Key                       | Scope | Grants                                                                |
| ------------------------- | ----- | --------------------------------------------------------------------- |
| `record.deals.read`       | yes   | list, get, board, timeline, tasks                                     |
| `record.deals.create`     | no    | create a deal                                                         |
| `record.deals.update`     | yes   | edit, move, win, lose, reopen, add to the timeline, complete tasks    |
| `record.deals.delete`     | yes   | delete a deal                                                         |
| `record.deals.report`     | yes   | `GET /deals/reports`                                                  |
| `record.pipelines.read`   | no    | pipelines, stages, lost reasons, deal settings                        |
| `record.pipelines.create` | no    | create a pipeline, add a lost reason                                  |
| `record.pipelines.update` | no    | edit pipelines, stages and reasons, reorder, change the deal settings |
| `record.pipelines.delete` | no    | delete a pipeline, a stage, a lost reason                             |

The Admin preset holds all of them. The editable front-line preset (`Agent` from sign-up, `Counsellor` from the dev seed) gets
`record.deals.read` (own), `record.deals.create`, `record.deals.update` (own) and `record.pipelines.read`.

## Pipelines and stages (WD-DEAL-002, 041, 042, 044)

Every workspace starts with the default pipeline "Sales Pipeline": New Lead 10, Qualified 25, Proposal 50, Negotiation 75, Won 100
(`kind: won`), Lost 0 (`kind: lost`). It is created with the workspace (a database trigger), never on a GET. There is exactly one
default pipeline. At most one stage per pipeline is `won` and one is `lost`; a won stage is always 100% and a lost stage 0%.

| Route                                             | Capability                | Notes                                                                                                             |
| ------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /pipelines`                                  | `record.pipelines.read`   | every pipeline with its stages in order, `dealCount` on each                                                      |
| `GET /pipelines/:id`                              | `record.pipelines.read`   |                                                                                                                   |
| `POST /pipelines`                                 | `record.pipelines.create` | `{ name, currency?, isDefault?, stages? }`; omit `stages` for the standard six; plan cap `pipelines`              |
| `PATCH /pipelines/:id`                            | `record.pipelines.update` | `{ name?, currency?, isDefault?: true, rowVersion }`; `isDefault: false` is 422                                   |
| `PUT /pipelines/order`                            | `record.pipelines.update` | `{ pipelineIds }`: every id once, else 422 `DEAL_ORDER_INVALID`                                                   |
| `DELETE /pipelines/:id?moveDealsToPipelineId=`    | `record.pipelines.delete` | 204. The default is 409 `DEAL_PIPELINE_DEFAULT_PROTECTED`; with deals and no target 409 `DEAL_PIPELINE_HAS_DEALS` |
| `POST /pipelines/:id/stages`                      | `record.pipelines.update` | `{ name, color?, probability?, kind?, beforeStageId? }`; an open stage lands after the last open stage            |
| `PUT /pipelines/:id/stages/order`                 | `record.pipelines.update` | `{ stageIds }`: every stage once                                                                                  |
| `PATCH /pipeline-stages/:id`                      | `record.pipelines.update` | `{ name?, color?, probability?, kind?, rowVersion }`; only an empty stage can change kind                         |
| `DELETE /pipeline-stages/:id?moveDealsToStageId=` | `record.pipelines.delete` | 204. A stage with deals needs a target stage of the same pipeline; the last stage cannot be deleted               |

Deleting a pipeline moves its deals: open ones to the target's first open stage, won ones to its won stage, lost ones to its lost
stage (409 `DEAL_PIPELINE_TARGET_INVALID` when the target has no such stage; nothing moves). Deleting a stage moves its deals
into the target stage, and the deals take that stage's status. Both go through the stage-change engine, so each moved deal gets
a timeline row and a `deal.stage_changed` event.

```json
// POST /v2/pipelines
{ "name": "Renewals", "currency": "EUR",
  "stages": [ { "name": "Open", "probability": 20 }, { "name": "Signed", "kind": "won" }, { "name": "Churned", "kind": "lost" } ] }
// 201
{ "id": "5c1e…", "name": "Renewals", "currency": "EUR", "isDefault": false, "sortOrder": 1, "dealCount": 0, "rowVersion": 1,
  "stages": [ { "id": "…", "pipelineId": "5c1e…", "name": "Open", "color": "#6366F1", "probability": 20, "kind": "open",
                "sortOrder": 0, "dealCount": 0, "rowVersion": 1, "createdAt": "…", "updatedAt": "…" }, "…" ],
  "createdAt": "…", "updatedAt": "…" }
```

Errors: 409 `DEAL_PIPELINE_NAME_TAKEN`, `DEAL_STAGE_NAME_TAKEN`, `DEAL_STAGE_KIND_TAKEN`, `DEAL_STAGE_HAS_DEALS`, `DEAL_STAGE_LAST`;
422 `PLAN_LIMIT_REACHED` (`errors`: `limit`, `used`, `limitValue`, `upgradeUrl`); 409 `ROW_VERSION_CONFLICT`.

### Lost reasons and settings (WD-DEAL-043)

| Route                                      | Capability                | Notes                                                                                             |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /deal-lost-reasons?activeOnly=true`   | `record.pipelines.read`   | in order, with `dealCount`; `activeOnly` is what a picker wants                                   |
| `POST /deal-lost-reasons`                  | `record.pipelines.create` | `{ name, isActive? }`; 409 `DEAL_LOST_REASON_NAME_TAKEN` (any case)                               |
| `PUT /deal-lost-reasons/order`             | `record.pipelines.update` | `{ reasonIds }`                                                                                   |
| `PATCH /deal-lost-reasons/:id`             | `record.pipelines.update` | `{ name?, isActive?, rowVersion }`                                                                |
| `DELETE /deal-lost-reasons/:id`            | `record.pipelines.delete` | deals keep the reason text                                                                        |
| `GET /deal-settings`, `PUT /deal-settings` | read / update             | `{ lostReasonRequired }`: when on, losing a deal needs a reason (422 `DEAL_LOST_REASON_REQUIRED`) |

## Deals (WD-DEAL-009..016)

### `POST /deals` [`record.deals.create`] (accepts `Idempotency-Key`)

```json
{
  "title": "Acme annual",
  "pipelineId": "…",
  "stageId": "…",
  "value": "1200.00",
  "currency": "USD",
  "ownerId": "…",
  "contactId": "…",
  "companyId": "…",
  "expectedCloseDate": "2026-12-01",
  "notes": "…"
}
```

Only `title` is required. Omitted: the default pipeline, its first stage, `0.00`, the pipeline's currency, the caller as owner
(`ownerId: null` for none), the contact's company. Source is `manual`. Refused: a stage of another pipeline (422
`DEAL_STAGE_MISMATCH`); an owner who is not an active member of the workspace (422 `DEAL_OWNER_INVALID`); a contact or company that
is not in the workspace (404); an amount with more decimals than the currency has or above 99,999,999 (422 `DEAL_VALUE_INVALID`).
A deal created in the Won or Lost stage is won or lost at once. Creating writes a `stage_change` row ("placement") on the timeline,
one audit row and the events `deal.created`, `deal.stage_changed` (with `fromStageId: null`) and `deal.won` / `deal.lost` when it
starts there.

```json
// 201
{
  "id": "9b1e…",
  "title": "Acme annual",
  "pipeline": { "id": "…", "name": "Sales Pipeline" },
  "stage": { "id": "…", "name": "New Lead", "color": "#64748B", "probability": 10, "kind": "open" },
  "status": "open",
  "value": "1200.00",
  "currency": "USD",
  "owner": { "id": "…", "name": "Ana" },
  "contact": { "id": "…", "name": "Ben", "phone": "+14155550101", "email": null },
  "company": { "id": "…", "name": "Acme" },
  "expectedCloseDate": "2026-12-01",
  "source": "manual",
  "lostReason": null,
  "lostReasonId": null,
  "notes": null,
  "wonAt": null,
  "lostAt": null,
  "rowVersion": 1,
  "createdAt": "…",
  "updatedAt": "…"
}
```

### `GET /deals` [`record.deals.read`, scope]

Cursor pagination over `(created_at, id)` at microsecond precision, newest first (`order=asc` for oldest first). Filters, all
combined with AND: `q` (title, contact name or company name; `%` and `_` are text), `pipelineId`, `stageId`, `status`
(`open|won|lost`), `ownerId` / `unassigned=true` (not together), `contactId`, `companyId`, `source`, `currency`, `limit` (1-200).
An id that is not in this workspace matches nothing.

### `GET /deals/:id` [`record.deals.read`, scope] · `PATCH /deals/:id` [`record.deals.update`, scope] · `DELETE /deals/:id` [`record.deals.delete`, scope]

`PATCH` takes `{ title?, value?, currency?, ownerId?, contactId?, companyId?, expectedCloseDate?, notes?, rowVersion }`: absent
keeps, `null` clears (contact, company, owner, date, notes). A stale `rowVersion` is 409 `ROW_VERSION_CONFLICT`. A **new currency needs
the value with it** (422): an amount is never relabelled. The stage is not an edit field. A change writes one audit row with only
the changed fields and `deal.updated` (and `deal.owner_changed` when the owner moved). `DELETE` is 204, audited with what was deleted,
emits `deal.deleted`, and removes the deal's timeline.

### Stage moves (WD-DEAL-007, 008, 012)

| Route                    | Body                                                                                | Result                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PATCH /deals/:id/stage` | `{ stageId, beforeDealId?, afterDealId?, lostReasonId?, lostReason?, rowVersion? }` | the deal in its new stage; `beforeDealId` / `afterDealId` place the card between two others         |
| `POST /deals/:id/won`    | `{ rowVersion? }`                                                                   | moves to the pipeline's Won stage (422 `DEAL_NO_WON_STAGE`); already won is a no-op                 |
| `POST /deals/:id/lost`   | `{ lostReasonId?, reason?, rowVersion? }`                                           | moves to its Lost stage (422 `DEAL_NO_LOST_STAGE`); a reason is required when the workspace says so |
| `POST /deals/:id/reopen` | `{ stageId?, rowVersion? }`                                                         | back to an open stage (the first by default); clears the stamps and the reason                      |

All need `record.deals.update` (scope). The stage must belong to the deal's pipeline (422 `DEAL_STAGE_MISMATCH`, the same on every
route); a `beforeDealId` / `afterDealId` that is not in the target stage is 422 `DEAL_POSITION_INVALID`. Status and stamps follow the
stage: won sets `status`, `wonAt` and clears `lostAt`; lost sets `lostAt` and clears `wonAt`; an open stage clears both and the
reason; won to lost clears `wonAt` and stamps `lostAt`; a won deal drops a stale lost reason. Moving to the stage the deal is already
in is a reorder only (no timeline row, no event). Every real move writes one `stage_change` row, one audit row and
`deal.stage_changed`, plus `deal.won`, `deal.lost` or `deal.reopened` when the status changed. `reason` is at most 191 characters
(422, not truncated).

Order inside a column persists: cards are ordered by a gap-spaced `sort_order`, newest on top until a card is moved; a drop takes the
midpoint of its neighbours, and a column whose gap closed is renumbered in the same transaction.

## The board (WD-DEAL-003, 004, 005)

### `GET /deals/board` [`record.deals.read`, scope]

Query: `pipelineId` (default pipeline; an unknown one is 404), the filters `q`, `ownerId`, `unassigned`, `contactId`, `companyId`,
`source`, `limit` (cards per column, 1-100, default 25), `convertTo`.

```json
{ "pipeline": { "id": "…", "name": "Sales Pipeline", "currency": "INR", "isDefault": true },
  "stages": [
    { "stage": { "id": "…", "name": "New Lead", "color": "#64748B", "probability": 10, "kind": "open", "sortOrder": 0 },
      "count": 41,
      "total":    { "byCurrency": [ { "currency": "EUR", "amount": "10.00" }, { "currency": "USD", "amount": "150.25" } ] },
      "weighted": { "byCurrency": [ { "currency": "USD", "amount": "15.03" } ] },
      "deals": [ { "…": "the first 25 cards, as in GET /deals/:id" } ],
      "page": { "nextCursor": "LTEwMjR8Mg", "hasMore": true, "limit": 25 } } ],
  "kpis": { "openCount": 41, "openValue": { "byCurrency": [ … ] }, "forecast": { "byCurrency": [ … ] },
            "wonThisMonthCount": 3, "wonThisMonthValue": { "byCurrency": [ … ] }, "winRate": 75 } }
```

`count` and `total` describe the **whole** column after the filters, not the page. `weighted` is value x stage probability for an
**open** column and empty for won and lost columns. The KPI strip ignores the filters (still inside the caller's record scope); its
forecast counts **open deals only** (WaDesk also added the Won column). With `convertTo`, every totals object also carries
`converted` and `unconverted`.

### `GET /deals/board/stages/:stageId/deals` [`record.deals.read`, scope]

"Load more" for one column: the same filters, `limit`, and the column's `cursor` (a `(sort_order, id)` pair with no ties).
`{ "data": [deals], "page": { … } }`. A malformed cursor is 400; a stage of another workspace is 404.

## Timeline and tasks (WD-DEAL-015, 016)

| Route                                                         | Capability                    | Notes                                                                  |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `GET /deals/:id/activities?type=&limit=&cursor=`              | `record.deals.read` (scope)   | newest first, cursor over `(created_at, id)` at microsecond precision  |
| `POST /deals/:id/activities`                                  | `record.deals.update` (scope) | `{ type, body, dueAt?, assigneeId? }`; accepts `Idempotency-Key`       |
| `POST /deals/:id/activities/:activityId/complete`             | `record.deals.update` (scope) | marks a task done (a no-op when it is)                                 |
| `POST /deals/:id/activities/:activityId/reopen`               | `record.deals.update` (scope) | reopens it and clears its reminder stamp                               |
| `GET /deals/tasks?mine=&assigneeId=&dealId=&status=&overdue=` | `record.deals.read` (scope)   | open tasks across deals, soonest due first, undated last; `status=open | done | all` |

Types you can add: `note`, `call`, `message`, `email`, `meeting`, `task`; `stage_change` rows are written by the system. `dueAt`
(a full timestamp with offset, not a date at midnight) and `assigneeId` apply to tasks only and are 422 otherwise; the assignee
defaults to the caller and must be an active member (422 `DEAL_OWNER_INVALID`). `body` is 1-5000 characters and **encrypted at
rest**. A `complete` / `reopen` on something that is not a task of that deal is 404 `DEAL_TASK_NOT_FOUND`. Adding writes one audit row
and `deal.activity_added`; completing writes `deal.task_completed`, reopening `deal.task_reopened`.

```json
{
  "id": "…",
  "dealId": "…",
  "type": "task",
  "body": "Call back",
  "dueAt": "2026-11-01T09:30:00.000Z",
  "doneAt": null,
  "done": false,
  "assignee": { "id": "…", "name": "Ana" },
  "author": { "id": "…", "name": "Ana" },
  "stageChange": null,
  "rowVersion": 1,
  "createdAt": "…",
  "updatedAt": "…"
}
// a stage_change row: "type": "stage_change", "body": null, "stageChange": { "from": { "id": "…", "name": "New Lead" } | null, "to": { "id": "…", "name": "Won" } }
```

## A contact's deals (WD-DEAL-037)

`GET /contacts/:contactId/deals` [`record.deals.read` + `record.contacts.read` on that contact]: up to 50 deals, open first then newest,
with `rollup: { openCount, openValue: [{currency, amount}], wonCount, wonValue: [...] }`. A contact the caller's scope hides is 404.

## Reports (WD-DEAL-019, 020, 040)

### `GET /deals/reports` [`record.deals.report`, scope]

Query: `pipelineId`, `ownerId`, `from`, `to` (`YYYY-MM-DD`; they apply to the closed-deal metrics, in the workspace zone), `convertTo`.

```json
{ "timezone": "Asia/Kolkata", "convertedTo": null,
  "open": { "count": 12, "value": { "byCurrency": [ … ] }, "forecast": { "byCurrency": [ … ] } },
  "won":  { "count": 9, "value": { "byCurrency": [ … ] }, "thisMonth": { "count": 2, "value": { "byCurrency": [ … ] } }, "avgDaysToClose": 14.5 },
  "lost": { "count": 3, "value": { "byCurrency": [ … ] } },
  "winRate": 75,
  "byStage": [ { "stageId": "…", "pipelineId": "…", "name": "Qualified", "color": "#0EA5E9", "kind": "open", "probability": 25,
                 "count": 2, "value": { "byCurrency": [ … ] }, "weighted": { "byCurrency": [ … ] } } ],
  "months": [ { "month": "2026-05", "wonCount": 1, "wonValue": { "byCurrency": [ … ] }, "lostCount": 0 }, "…" ],
  "leaders": [ { "owner": { "id": "…", "name": "Ana" }, "wonCount": 4, "value": { "byCurrency": [ … ] } } ],
  "lostReasons": [ { "reason": "Budget", "count": 2 } ] }
```

`byStage` counts OPEN deals (a won or lost stage reports 0) over every stage of the chosen pipeline, or of every pipeline. The
forecast is value x probability over open deals only. `thisMonth` is the current calendar month in the workspace's time zone
(`organizations.settings.timezone`, UTC when unset), not the server's and not all-time. `months` is the last six calendar months,
oldest first, ending with the current one (or the month of `to`). `leaders` is the top ten owners of won deals. `avgDaysToClose` is
the mean of `won_at - created_at` in days, `null` with no won deals. Without `convertTo` no figure mixes currencies.

## Events (outbox) for flows, webhooks and notifications

Aggregate `deals` (and `pipelines`, `pipeline_stages`, `deal_lost_reasons`, `deal_settings`). Payloads carry uuids and the few fields a
consumer decides on, plus `_meta`. At-least-once, in the transaction of the change that caused them.

| Event                                                                                                                                                                        | When                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `deal.created`                                                                                                                                                               | a deal is created (payload: uuid, title, pipelineId, stageId, status, value, currency, ownerId, contactId, companyId, source)           |
| `deal.stage_changed`                                                                                                                                                         | a placement or a move; `fromStageId` is null on the first placement; `previousStatus`; `fromPipelineId` when a pipeline delete moved it |
| `deal.won`, `deal.lost`, `deal.reopened`                                                                                                                                     | the status became won / lost, or a won or lost deal went back to an open stage (`lostReason` on lost)                                   |
| `deal.updated`, `deal.owner_changed`, `deal.deleted`                                                                                                                         | an edit (`changed` lists the fields), an owner change (`previousOwnerId`), a delete                                                     |
| `deal.activity_added`, `deal.task_completed`, `deal.task_reopened`                                                                                                           | the timeline                                                                                                                            |
| `pipeline.created/updated/deleted/reordered/stages_reordered`, `pipeline_stage.created/updated/deleted`, `deal_lost_reason.created/updated/deleted`, `deal_settings.updated` | configuration                                                                                                                           |

## What is not built here

The overdue-task reminder sweep (WD-DEAL-017) and the owner notifications (WD-DEAL-018) are consumers of these events and belong to the
notifications domain; auto-deal from orders (WD-DEAL-021, 022), the inbox, flow and Messenger writers (WD-DEAL-025..029), the AI tools
(WD-DEAL-036) and the REST API `/api/v1/deals` equivalent (WD-DEAL-030..035, which needs API-key scopes `deals:read|write`) are follow-ups; they
call `DealsService.create(input, source)` and `moveStage`, which already take the source and run the same engine.
