# Flow builder and editor API (FLB)

The flows list, the visual editor's save / publish / import / export, the starter-template gallery and its operator catalogue, the
builder's reference data (pickers), the webhook test, the AI generator and media upload. Contracts:
`packages/contracts/src/flow-builder-editor/` (`flow.ts`, `node-catalogue.ts`, `graph.ts`, `validation.ts`, `trigger.ts`,
`runtime-shape.ts`, `errors.ts`). Module: `apps/api/src/modules/flow-builder-editor`. Behaviour follows Reference, quirks included
(`docs/threadwise-port/parity/flow-builder-editor.md`, `flow-builder-editor-list.md`).

Executing a flow (enrolment, subscribers, runs, analytics, retry) is the **flow-runtime-engine** domain
([flow-runtime-engine.md](flow-runtime-engine.md)); this module only stores the graph and the trigger columns the runtime reads.

## Workspace API (`/v2/flows`, bearer token, problem+json errors)

Ids are uuids. Every mutation takes `Idempotency-Key`. Keys: `flb.flows.read|create|update|delete|publish`; the locked Admin preset holds
all five (Reference: every `/flows` route needed the workspace role admin and nothing else). Plan: the numeric cap `flows` is enforced on
create, import, clone and duplicate (Reference skipped duplicate: an `intended` deviation); the plan feature `automation` (Reference `autoflow`) is
the soft paywall: reads, pause, unpublish and delete stay open, every other write answers 422 `PLAN_FEATURE_LOCKED`. Literal paths are
registered before `:id`.

| Method and path                                               | Key     | Notes                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /flows?status&category&q&limit&cursor`                   | read    | `status` all / live / paused / draft, `category` exact, `q` case-insensitive substring of the name; newest updated first, 12 per page, cursor paginated; `includeTotal=true` adds `total`                                                 |
| `GET /flows/overview`                                         | read    | KPI tiles (live / total / draft / paused), library and status rails (counts ignore the list filters), the featured card (`preview[]` labels), the template gallery                                                                        |
| `GET /flows/templates`                                        | read    | Active templates, `sort_order` then newest                                                                                                                                                                                                |
| `POST /flows/templates/:id/clone`                             | create  | New unpublished flow named like the template; counts against the cap; hidden or deleted template 404; bumps `clone_count`                                                                                                                 |
| `GET /flows/builder-context`                                  | read    | Everything the builder's dropdowns need in one call: channels and senders (`<engine>:<uuid>` keys, labels only, never tokens), tags, groups, teams, agents, stages, templates, flows, AI models, assistants, booking types, forms, stores |
| `GET /flows/builder-context/commerce-products`                | read    | `?provider&storeId`: products a commerce node can offer; a store of another workspace gives an empty list                                                                                                                                 |
| `GET /flows/builder-context/google/:kind`                     | read    | 503 `FLB_INTEGRATION_DISABLED`: no Google account store exists on this deployment                                                                                                                                                         |
| `GET /flows/builder-context/google/forms/:formId/apps-script` | read    | The one-time setup script for a Google Form node; mints the workspace webhook token                                                                                                                                                       |
| `POST /flows/import`                                          | create  | Body `{ payload }`: an export file or a bare `{ flowNodes, flowEdges, vars }` graph. New draft "<name> (imported)"; 422 `FLB_IMPORT_INVALID` without `flowNodes`; plan cap                                                                |
| `POST /flows/test-webhook`                                    | update  | Fires a Webhook node for real from the Test runner, SSRF guarded; failures are 200 `{ ok: false, error }`                                                                                                                                 |
| `POST /flows/ai-generate`                                     | update  | `{ prompt, model, provider, flowType }` (openai, anthropic, gemini); at most 20 nodes and 40 edges back; 422 `FLB_AI_NO_KEY`, 502 `FLB_AI_PROVIDER_FAILED`, 422 `FLB_AI_BAD_JSON`                                                         |
| `POST /flows/upload-media`                                    | update  | multipart `file` + `type` (image, video, audio, document), up to 50 MB; over the limit 422 "The file may not be greater than 51200 kilobytes."; storage down 503 `FLB_STORAGE_UNAVAILABLE`                                                |
| `GET /flow-media/:org/:name`                                  | none    | Serves what `upload-media` stored (local disk adapter until object storage lands)                                                                                                                                                         |
| `POST /flows`                                                 | create  | `{ name, category, flowType, graph }`; 201 with the flow (a draft). Name up to 255                                                                                                                                                        |
| `GET /flows/:id`                                              | read    | The flow with its `graph` (`flowNodes`, `flowEdges`, `vars`) and `rowVersion`                                                                                                                                                             |
| `PUT /flows/:id`                                              | update  | Save: `{ name, category, flowType, graph, rowVersion }`; 409 `ROW_VERSION_CONFLICT`; re-derives `trigger_kind / trigger_value / trigger_keywords / trigger_channel_id / provider`; 422 `FLB_TRIGGER_KEYWORDS_TOO_LONG` (writes nothing)   |
| `PATCH /flows/:id/rename`                                     | update  | `{ name }` up to 191                                                                                                                                                                                                                      |
| `POST /flows/:id/toggle`                                      | update  | Pause or resume (flips `is_active`): `{ isActive, state }`                                                                                                                                                                                |
| `POST /flows/:id/duplicate`                                   | create  | Copy "<name> (Copy)", unpublished, keeps the source's `is_active`; plan cap                                                                                                                                                               |
| `POST /flows/:id/publish` / `unpublish`                       | publish | Publish stamps `published_at`; no graph validation (Reference)                                                                                                                                                                               |
| `GET /flows/:id/export`                                       | read    | Attachment `<slug>.threadwise-flow.json`: `{ _threadwise_flow_export: 1, exported_at, name, flow_type, category, flow_data }`                                                                                                                     |
| `DELETE /flows/:id`                                           | delete  | 204; hard delete; subscribers, runs and retry logs cascade                                                                                                                                                                                |

Example save:

```json
{
  "name": "Welcome",
  "category": "welcome",
  "flowType": "chat",
  "graph": {
    "flowNodes": [
      {
        "id": "n_trig",
        "type": "trigger",
        "x": 120,
        "y": 120,
        "data": {
          "kind": "keyword",
          "keywords": "hi, hello",
          "deviceId": "baileys:3fa85f64-5717-4562-b3fc-2c963f66afa6"
        }
      },
      {
        "id": "n_msg",
        "type": "message",
        "x": 420,
        "y": 120,
        "data": { "text": "Hello {{name}}!" }
      }
    ],
    "flowEdges": [{ "id": "e_1", "source": "n_trig", "sourceHandle": "out", "target": "n_msg" }],
    "vars": []
  },
  "rowVersion": 3
}
```

Limits: 500 nodes and 2000 edges per flow (Reference had none). The graph stays in Reference's builder vocabulary so exports and imports
interoperate; the runtime's vocabulary is produced on read (`flbToRuntimeData`, see Runtime seam).

Events (outbox, same transaction): `flow.created`, `flow.saved`, `flow.renamed`, `flow.paused`, `flow.resumed`, `flow.duplicated`,
`flow.imported`, `flow.cloned`, `flow.published`, `flow.unpublished`, `flow.deleted` (payload: ids, `isPublished`, `isActive`,
`triggerChannelId`, `provider`). Every mutation also writes an audit row.

## Operator API (`/v2/platform/flow-templates`, operator session)

The starter-template catalogue (Reference `/admin/flow-templates`). Every operator role reads; only `super_admin` writes, and every write is a
security event.

| Method and path                             | Notes                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /platform/flow-templates?limit&cursor` | 20 per page with the three stat tiles                                                                                           |
| `GET /platform/flow-templates/:id`          | One template with its graph (the edit form)                                                                                     |
| `POST /platform/flow-templates`             | From an uploaded or pasted export, or by cloning a flow (`flowId`); 422 `FLB_TEMPLATE_GRAPH_REQUIRED`, 422 `FLB_IMPORT_INVALID` |
| `PUT /platform/flow-templates/:id`          | Edit; without a new graph source the old graph is kept (QUIRK: unreadable JSON counts as "no graph supplied")                   |
| `POST /platform/flow-templates/:id/toggle`  | Show or hide in the tenant gallery                                                                                              |
| `DELETE /platform/flow-templates/:id`       | 204; flows already cloned stay                                                                                                  |

## Runtime seam (FLR)

- The runtime reads `flows` directly: `flow_data` (`flowNodes`, `flowEdges`, `vars`), `trigger_kind`, `trigger_value`, `trigger_keywords`,
  `trigger_channel_id`, `provider`, `is_published`, `is_active`. The save writes exactly those (`trigger_channel_id` resolved from the
  Trigger node's sender key; unknown or foreign sender gives null).
- `FlowReaderService` (`index.ts` barrel) is the editor's own read seam: `getRunnableFlow` returns the graph already shaped with
  `flbRuntimeNodeData`, `listEnrollable` returns the live flows for a trigger.
- `flbToRuntimeData` (contracts `runtime-shape.ts`) is Reference's FlowNormalizer field mapping as a pure, additive, idempotent function.
  `compileGraph` (`flow-runtime-engine/graph/compile-graph.ts`) calls it for every node, so ten node types (ai, chatbot, subflow, webhook,
  code, mysql, poll, location, legacy cta, ai_call) reach the executors with the runtime's names, and the template and AI assistant uuids the
  editor saves are resolved by org inside FLR (`FlowRefResolver`). See `docs/threadwise-port/parity/flow-builder-editor.md` section "Open runtime items".
- Two WhatsApp-only nodes are an addition beyond Reference (TW-FLB-081, 082): `ask_file` (data `{prompt, extensions[], var, retries, wrongReply, skipKeyword, onFail, timeoutMinutes, saveProperty, propertyKey}`) and
  `ask_location` (data `{prompt, var, interactive, retries, wrongReply, skipKeyword, onFail, timeoutMinutes}`). They are saved, validated, exported and imported like any
  other node (one output port `out`), `flbToRuntimeData` shapes them (`question`, `variable`, `extensions`, `maxRetries`, `wrongReplyText`, `onGiveUp`, `savePropertyKey`),
  and FLR runs them as `AskFile` / `AskLocation` (a `Custom` wait). Variables they write: `{{var}}`, `{{var}}_url|_kind|_name|_mime|_caption|_status` (file) and
  `{{var}}`, `{{var}}_link|_latitude|_longitude|_name|_address|_status` (location). The allowed-extension groups and the accept check are in contracts `ask-media.ts`.
- Not here: `api/flow-node/*` callbacks, `api/flows/{id}` (Node token), enrolment, subscribers, analytics, retry. They are FLR (or the
  Node bridge, which does not exist in this architecture: the engine runs in-process).

## Errors

`FLB_IMPORT_INVALID`, `FLB_TEMPLATE_GRAPH_REQUIRED`, `FLB_TRIGGER_KEYWORDS_TOO_LONG`, `FLB_AI_NO_KEY`, `FLB_AI_PROVIDER_FAILED`,
`FLB_AI_BAD_JSON`, `FLB_UPLOAD_REJECTED`, `FLB_STORAGE_UNAVAILABLE`, `FLB_INTEGRATION_DISABLED`, plus the shared `PLAN_LIMIT_REACHED`,
`PLAN_FEATURE_LOCKED`, `ROW_VERSION_CONFLICT`, `NOT_FOUND`, `VALIDATION_FAILED`.
