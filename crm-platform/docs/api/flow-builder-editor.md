# Flow builder and editor API (FLB)

The flows list, the visual editor's save / publish / import / export, the starter-template gallery and its operator catalogue, the
builder's reference data (pickers), the webhook test, the AI generator and media upload. Contracts:
`packages/contracts/src/flow-builder-editor/` (`flow.ts`, `node-catalogue.ts`, `graph.ts`, `validation.ts`, `trigger.ts`,
`runtime-shape.ts`, `errors.ts`). Module: `apps/api/src/modules/flow-builder-editor`. Behaviour follows Reference, quirks included
(`docs/threadwise-port/parity/flow-builder-editor.md`, `flow-builder-editor-list.md`).

Executing a flow (enrolment, subscribers, runs, analytics, retry) is the **flow-runtime-engine** domain
([flow-runtime-engine.md](flow-runtime-engine.md)); this module only stores the graph and the trigger columns the runtime reads.

## Workspace API (`/v2/flows`, bearer token, problem+json errors)

Ids are uuids. Every mutation takes `Idempotency-Key`. Keys: `flb.flows.read|create|update|delete|publish` (and `flb.geta.manage`, below); the locked Admin preset holds
all five (Reference: every `/flows` route needed the workspace role admin and nothing else). Plan: the numeric cap `flows` is enforced on
create, import, clone and duplicate (Reference skipped duplicate: an `intended` deviation); the plan feature `automation` (Reference `autoflow`) is
the soft paywall: reads, pause, unpublish and delete stay open, every other write answers 422 `PLAN_FEATURE_LOCKED`. Literal paths are
registered before `:id`.

| Method and path                                               | Key     | Notes                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /flows?status&category&q&limit&cursor`                   | read    | `status` all / live / paused / draft, `category` exact, `q` case-insensitive substring of the name; newest updated first, 12 per page, cursor paginated; `includeTotal=true` adds `total`                                                                                    |
| `GET /flows/overview`                                         | read    | KPI tiles (live / total / draft / paused), library and status rails (counts ignore the list filters), the featured card (`preview[]` labels), the template gallery                                                                                                           |
| `GET /flows/templates`                                        | read    | Active templates, `sort_order` then newest                                                                                                                                                                                                                                   |
| `POST /flows/templates/:id/clone`                             | create  | New unpublished flow named like the template; counts against the cap; hidden or deleted template 404; bumps `clone_count`                                                                                                                                                    |
| `GET /flows/builder-context`                                  | read    | Everything the builder's dropdowns need in one call: channels and senders (`<engine>:<uuid>` keys, labels only, never tokens), tags, groups, teams, agents, stages, templates, flows, AI models, assistants, booking types, forms, stores                                    |
| `GET /flows/builder-context/commerce-products`                | read    | `?provider&storeId`: products a commerce node can offer; a store of another workspace gives an empty list                                                                                                                                                                    |
| `GET /flows/builder-context/google/:kind`                     | read    | The connected account's sheets, docs or forms (needs the Drive file list permission); 503 `FLB_INTEGRATION_DISABLED` without a platform Google client, 409 `GOOGLE_ACCOUNT_NOT_CONNECTED` / `GOOGLE_ACCOUNT_NEEDS_RECONNECT` / `GOOGLE_SCOPE_MISSING`. See google-account.md |
| `GET /flows/builder-context/google/status`                    | read    | `{ status, granted[] }` of the workspace's Google account, so a Google node can warn before the flow runs                                                                                                                                                                    |
| `GET /flows/builder-context/google/forms/:formId/apps-script` | read    | The one-time setup script for a Google Form node; mints the workspace webhook token                                                                                                                                                                                          |
| `POST /flows/import`                                          | create  | Body `{ payload }`: an export file or a bare `{ flowNodes, flowEdges, vars }` graph. New draft "<name> (imported)"; 422 `FLB_IMPORT_INVALID` without `flowNodes`; plan cap                                                                                                   |
| `POST /flows/test-webhook`                                    | update  | Fires a Webhook node for real from the Test runner, SSRF guarded; failures are 200 `{ ok: false, error }`                                                                                                                                                                    |
| `POST /flows/ai-generate`                                     | update  | `{ prompt, model, provider, flowType }` (openai, anthropic, gemini); at most 20 nodes and 40 edges back; 422 `FLB_AI_NO_KEY`, 502 `FLB_AI_PROVIDER_FAILED`, 422 `FLB_AI_BAD_JSON`                                                                                            |
| `POST /flows/upload-media`                                    | update  | multipart `file` + `type` (image, video, audio, document), up to 50 MB; over the limit 422 "The file may not be greater than 51200 kilobytes."; storage down 503 `FLB_STORAGE_UNAVAILABLE`                                                                                   |
| `GET /flow-media/:org/:name`                                  | none    | Serves what `upload-media` stored (local disk adapter until object storage lands)                                                                                                                                                                                            |
| `POST /flows`                                                 | create  | `{ name, category, flowType, graph }`; 201 with the flow (a draft). Name up to 255                                                                                                                                                                                           |
| `GET /flows/:id`                                              | read    | The flow with its `graph` (`flowNodes`, `flowEdges`, `vars`) and `rowVersion`                                                                                                                                                                                                |
| `PUT /flows/:id`                                              | update  | Save: `{ name, category, flowType, graph, rowVersion }`; 409 `ROW_VERSION_CONFLICT`; re-derives `trigger_kind / trigger_value / trigger_keywords / trigger_channel_id / provider`; 422 `FLB_TRIGGER_KEYWORDS_TOO_LONG` (writes nothing)                                      |
| `PATCH /flows/:id/rename`                                     | update  | `{ name }` up to 191                                                                                                                                                                                                                                                         |
| `POST /flows/:id/toggle`                                      | update  | Pause or resume (flips `is_active`): `{ isActive, state }`                                                                                                                                                                                                                   |
| `POST /flows/:id/duplicate`                                   | create  | Copy "<name> (Copy)", unpublished, keeps the source's `is_active`; plan cap                                                                                                                                                                                                  |
| `POST /flows/:id/publish` / `unpublish`                       | publish | Publish stamps `published_at`; no graph validation (Reference)                                                                                                                                                                                                               |
| `GET /flows/:id/export`                                       | read    | Attachment `<slug>.threadwise-flow.json`: `{ _threadwise_flow_export: 1, exported_at, name, flow_type, category, flow_data }`                                                                                                                                                |
| `DELETE /flows/:id`                                           | delete  | 204; hard delete; subscribers, runs and retry logs cascade                                                                                                                                                                                                                   |

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

Publishing also starts the Geta console push when the workspace has set it up (see [Geta publishing](#geta-publishing-addition-beyond-threadwise));
the flow detail (`GET /flows/:id`, publish, unpublish) carries `getaSync`.

Events (outbox, same transaction): `flow.created`, `flow.saved`, `flow.renamed`, `flow.paused`, `flow.resumed`, `flow.duplicated`,
`flow.imported`, `flow.cloned`, `flow.published`, `flow.unpublished`, `flow.deleted`, and for Geta publishing `flow.geta_publish_requested` (payload: ids, `isPublished`, `isActive`,
`triggerChannelId`, `provider`). Every mutation also writes an audit row.

## Geta publishing (addition beyond Reference)

NOT a Reference feature (inventory TW-FLB-083): when the user presses **Publish** in the editor, the bot is also pushed live on the external Geta
console. The local publish is the source of truth and never depends on the console: `POST /flows/:id/publish` publishes, writes a sync row
and a `flow.geta_publish_requested` outbox event in the same transaction and answers at once; the **worker** makes the calls.

### The two calls (always in this order)

1. `configuration_update`: `PUT {baseUrl}/api/v1/chatbot/{chatbotId}/configuration/update/` with body `{"chatbot": {<the Geta chatbot record>}}`.
   `{chatbotId}` is the record's `id`. The record is sent as the user pasted it; the one exception, a documented and tested behaviour, is that
   `modified_time` is refreshed to now in Geta's display format, UTC, day first (`05 Oct, 2026 4:37:00 PM`), and only when the record already has that
   field. `chatbot_status`, `bot_enabled` and every other field are never touched. The body is UTF-8 (emoji and non-Latin text round-trip).
2. `publish_bot`: `POST {baseUrl}/api/v1/console/publish-bot`, body `{}`, header `appid: {"botid":"<bot_id of the record>"}`.

Both carry `accept: application/json`, `content-type: application/json;charset=UTF-8`, `authorization` (sent as stored: no `Bearer ` is added) and
`geta-host`; with a console origin configured they also carry `origin: <origin>` and `referer: <origin>/` (default: neither). The `appid` header
is only on call 2. Call 2 is not made when call 1 fails. The flow is `live` only when both answered 2xx.

Adapter (`infra/providers/flow-builder-editor`, port `BotPublishPort` with `updateChatbotConfiguration()` and `publishBot()`): timeout per request,
up to `GETA_PUBLISH_MAX_ATTEMPTS` tries with doubling backoff on a network error, timeout, 429 (a small `Retry-After` is honoured) or 5xx; any other
4xx is final; redirects are not followed; private addresses are refused unless `GETA_PUBLISH_ALLOW_PRIVATE_HOSTS=true`. Errors keep the status and a
sanitised excerpt of the response body (control characters collapsed, every known secret replaced by `***`, cut to 300 characters); no header value is
logged, stored or returned.

### Modes

`GETA_PUBLISH_MODE=live|fixture`. Unset it is `fixture` outside production and `live` in production. The fixture adapter makes no network call, answers
200 for both calls and records them (`FixtureBotPublisherState`). A chatbot id containing `fail-config` fails the configuration update, a bot id containing
`fail-publish` fails publish-bot (both every time); `fail-once-config` / `fail-once-publish` fail the first call only, which is how a demo shows Failed and Retry.
Other settings: `GETA_PUBLISH_TIMEOUT_MS` (15000), `GETA_PUBLISH_MAX_ATTEMPTS` (3), `GETA_PUBLISH_BACKOFF_MS` (500), `GETA_PUBLISH_ALLOW_PRIVATE_HOSTS` (false). See `.env.example`.

### Where the credentials live

Table `flb_geta_publish_settings` (one row per workspace, RLS forced, composite `(org_id, id)`): `base_url`, `origin` (plain) and three values sealed by
`CryptoService` (AES-256-GCM, like channel tokens and gateway keys): `authorization_enc`, `geta_host_enc`, `chatbot_record_enc` (the whole record: it
holds business and workspace ids). The bot id is not entered separately: it is the record's `bot_id`. Reads answer flags (`authorizationSet`,
`getaHostSet`) and a summary of the record (`id`, `name`, `botId`), never a value. The audit trail records which fields changed ("set", "replaced",
"not set"), never their content. An optional **per-flow record** (`flb_geta_publish_syncs.chatbot_override_enc`, sealed the same way) replaces the
workspace record for that flow only; it still uses the workspace base URL and tokens.

### Sync state

Table `flb_geta_publish_syncs` (one row per flow, composite FK `(org_id, flow_id)`): `publish_version`, `state` (`pending | live | failed`; `idle` for a row that
only holds a per-flow record), `step`, `failed_step` (`configuration_update | publish_bot`), `last_error` (sanitised), `attempted_at`, `bot_id`,
`configuration_updated_version`. Every publish raises `publish_version`. The consumer `GetaPublishConsumer` (worker only) is idempotent per version: an
event for an older version, or for a row that is no longer `pending` (already live, already failed, delivered twice), does nothing; a newer publish
supersedes a push still running. It resumes: when the configuration update already succeeded for this version, the run starts at `publish_bot`. A remote
failure never throws out of the consumer and never fails the publish: it is written to the row (`failed`, the step, the reason) and the user presses Retry.

What the API answers (`getaSync`, contract `flowGetaSyncSchema`): `state` `none | not_configured | pending | live | failed`, `step`, `failedStep`, `lastError`,
`attemptedAt`, `botId`, `publishVersion`, `configured`, `chatbotOverride` (a summary). `not_configured` is a published flow in a workspace with no complete
credentials (no call is made, no event is emitted); `none` is a draft or a published flow that was never pushed.

### Endpoints

| Method and path                       | Key                 | Notes                                                                                                                                                                                                              |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /flows/geta-publish/settings`    | `flb.geta.manage`   | `{ mode, baseUrl, origin, authorizationSet, getaHostSet, chatbot: {id,name,botId} \| null, configured, updatedAt }`                                                                                                |
| `PUT /flows/geta-publish/settings`    | `flb.geta.manage`   | Only the fields sent change, `null` clears one: `{ baseUrl, origin, authorization, getaHost, chatbotRecord }` (`chatbotRecord` is JSON text: the record, or `{"chatbot": {...}}`). 422 `FLB_GETA_SETTINGS_INVALID` |
| `DELETE /flows/geta-publish/settings` | `flb.geta.manage`   | Removes every Geta credential of the workspace; flows keep their last state                                                                                                                                        |
| `GET /flows/:id/publish-sync`         | `flb.flows.read`    | The flow's remote state (`getaSync` shape)                                                                                                                                                                         |
| `POST /flows/:id/publish-sync/retry`  | `flb.flows.publish` | From the failed step, or a first push of a published flow that was never pushed. Answers `pending`; 409 `FLB_GETA_NOT_RETRYABLE` (draft, in progress, already live); 422 `FLB_GETA_NOT_CONFIGURED`                 |
| `PUT /flows/:id/publish-sync/chatbot` | `flb.geta.manage`   | `{ chatbotRecord: string \| null }`: this flow's own record                                                                                                                                                        |

Base URL rules: `https://` only (`http://` is accepted only when `GETA_PUBLISH_ALLOW_PRIVATE_HOSTS` is on), no login, query or fragment. Tokens: one line of printable
characters (a pasted newline cannot add a header). `flb.geta.manage` is a workspace toggle granted to the Owner and Admin presets by the permission-defs trigger;
publishing and retry keep `flb.flows.publish`, and retry also needs the `automation` plan feature like publish.

Not done: unpublishing a flow here does not unpublish it on Geta (no such call was specified); the editor offers the per-flow record through the API only.

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
`FLB_AI_BAD_JSON`, `FLB_UPLOAD_REJECTED`, `FLB_STORAGE_UNAVAILABLE`, `FLB_INTEGRATION_DISABLED`, `FLB_GETA_NOT_CONFIGURED`,
`FLB_GETA_SETTINGS_INVALID`, `FLB_GETA_NOT_RETRYABLE`, plus the shared `PLAN_LIMIT_REACHED`,
`PLAN_FEATURE_LOCKED`, `ROW_VERSION_CONFLICT`, `NOT_FOUND`, `VALIDATION_FAILED`.

## Age question in the Ask node (BL-218)

Ask > "Validate as" gained **Age** (`age`) and **Date of birth** (`date_of_birth`, written in the chosen date format). Node data: `ageMinAge` (1..21, empty = the workspace's minor age), `ageWhenUnder` (`end`, the default, or `continue`), `ageEndText` (the neutral closing line; empty = "We are not able to continue."). At run time (`ask-input-node.ts`) the answer is written to the contact (the date of birth, the younger date wins) and, when under, flags it (source `dob`); `{{var}}_age_gate` is `under` or `adult`. `end` sends the closing line and ends the run; `continue` lets the author branch on the variable (for example to ask for a parent). Nothing says which answer passes.
