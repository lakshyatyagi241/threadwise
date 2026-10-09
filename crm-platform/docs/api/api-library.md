# API Library (ALIB)

Saved HTTP API calls a workspace builds once and reuses from flows: name, method, URL, headers, a JSON or form-data payload with
`{{variables}}`, an optional JavaScript function that reshapes the payload, a mapping of response fields into contact properties,
test runs and a log of every run. Carried over from the old console's "API Library" at the owner's request; it is **not** a Reference
port (Reference has no such screen), so the Reference parity run does not apply. Every other repo rule does.

Code: `apps/api/src/modules/api-library/` (module), `packages/contracts/src/api-library/` (shapes),
`packages/db/migrations/20261112090000_alib_core.sql` and `20261112090100_alib_permissions.sql` (tables, keys), the flow node in
`apps/api/src/modules/flow-runtime-engine/runtime/nodes/integrations/api-library-node.ts`.

## 1. What the old console did, and where it went

| Old endpoint (`/workspace/...`)            | Here (`/v2/api-library/...`)                                              |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `api-library-list`                         | `GET apis` (cursor pages, `search`, `method`)                             |
| `create-api-library`                       | `POST apis`                                                               |
| `get-api-library/:id`                      | `GET apis/:id`                                                            |
| `update-api-library/:id`                   | `PATCH apis/:id` (whole definition + `rowVersion`)                        |
| `delete-api-library/:id`                   | `DELETE apis/:id` (409 while flows use it, `?force=true`)                 |
| `test-api`                                 | `POST apis/test`, and `POST apis/test-function` for the "Run code" button |
| `contact-properties/fields?status=visible` | `GET contact-properties`                                                  |
| `get-used-in-bot-api`                      | `GET apis/options` (the chip menu: APIs -> Name -> Name.field)            |
| `api-library-logs` (+ `/:id`)              | `GET logs`, `GET apis/:id/logs`, `GET logs/:id`                           |
| (none)                                     | `GET apis/:id/usage` (the flows that call it)                             |
| flow action "API library"                  | the flow node `api_library` ("API (from library)")                        |

## 2. Permissions

All org-wide (no record scope). Owner and Admin get them by the trigger on `permission_defs`; the **Manager** preset gets all five
(migration `alib_permissions`, also through `workspace_preset_baseline` for workspaces created later). Agent and Viewer hold none.
No plan feature gates it (none of the existing ones fits; using the node is already behind the flow builder's `automation` gate).

| Key                       | Routes                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `integ.apilibrary.read`   | `GET apis`, `apis/:id`, `apis/:id/usage`, `apis/:id/logs`, `logs`, `logs/:id`, `contact-properties`, `apis/options` |
| `flb.flows.read`          | also opens `GET apis/options` only (the node's picker), so a flow author needs no access to the screen              |
| `integ.apilibrary.create` | `POST apis`                                                                                                         |
| `integ.apilibrary.update` | `PATCH apis/:id`                                                                                                    |
| `integ.apilibrary.delete` | `DELETE apis/:id`                                                                                                   |
| `integ.apilibrary.test`   | `POST apis/test`, `POST apis/test-function` (a test makes a real request)                                           |

## 3. The definition

| Field               | Rule                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | `A-Z a-z 0-9 _`, 1 to 64. Unique per workspace ignoring case (409 `ALIB_NAME_TAKEN`). **Permanent**: flows read answers as `{{Name.field}}`.                                    |
| `method`            | `GET POST PUT PATCH DELETE`. Only `POST PUT PATCH` carry a payload, a function or form data.                                                                                    |
| `url`               | http or https, no credentials in it, 2048 chars, may hold `{{tokens}}`. Checked after the defaults are filled in.                                                               |
| `payloadType`       | `application/json` (default) or `multipart/form-data` (an object of text fields).                                                                                               |
| `variables`         | Every `{{token}}` of the URL, header values and payload strings must be declared with a **default value** (`name`, `source` contact/api/flow). Unused ones are dropped on save. |
| `headers`           | `[{ key, value, secret }]`, max 30. Host, Content-Length and other hop-by-hop headers are refused; Content-Type only for JSON.                                                  |
| `body`              | JSON (object or array, max 256 KB) whose string leaves may hold tokens; or form fields.                                                                                         |
| `functionCode`      | JavaScript that defines `function processPayload(payload)` and returns the payload to send (JSON payloads only, max 20 000 chars).                                              |
| `mapping`           | `[{ path, contactProperty, defaultValue }]`: response path -> contact property.                                                                                                 |
| `responseVariables` | Response paths a flow reads as `{{Name.<path>}}` (the old "use in bot").                                                                                                        |

Paths: `data.items[0].name` is one element, `data.items[].name` every element collected into a list (lists of plain values are written
comma-joined into a contact property). A numeric key on a list also works (`data.items.0.name`, as the old console wrote it).

An update replaces the whole definition (the form sends all of it) and carries `rowVersion`; a stale one is 409 `ROW_VERSION_CONFLICT`.

### Variables at run time

Per declared variable, in order: the node's own input / the test's `values`, the run's variable of that name, the contact's property of
that name, the saved default. An empty answer counts as none. A value placed in the **host** part of the URL goes in as typed; one in the
path or query is percent-encoded. In a JSON payload a token is always replaced by text (the function can convert types).

## 4. Secrets

- A header is **secret** when `secret: true` or its name reads like one (Authorization, X-API-Key, anything with token, secret,
  password, cookie, signature ...). The value of a secret header is **encrypted at rest** (the credentials key) and decrypted only to send.
- No route returns it. Detail and list show `********` (`API_LIBRARY_SECRET_MASK`). To keep it, send `********` back on update; any
  other value replaces it.
- A kept secret stays with the address it was saved for. If an update (or a test run) points the API at another scheme, host or port,
  the secret must be typed again (422 on update; `errorKind: "invalid"` on a test). A person who may only test, or only edit, cannot
  aim a token they cannot read at a server of their own.
- Logs are written with secrets **masked before storage**: secret headers, query parameters and JSON keys whose names read like secrets
  (in the request and in the answer) show `********`; response cookies too. Nothing in `api_library_logs` is the real value. Do not put
  a secret in a variable default or a URL path: those are not masked.

## 5. Running a call (test, and flow)

One runner (`ApiLibraryRunner`) serves both. It never throws: every failure is an outcome with an `errorKind`.

1. Fill the variables into URL, headers, payload.
2. If there is a function: run `processPayload(payload)` in the sandbox (`infra/sandbox/code-sandbox.ts`, the Code node's sandbox):
   `node:vm` in a worker thread, 3 s limit with a hard kill, 16 MB heap, no `require`, `process`, `fs`, network or timers; never `eval` in
   the API process. It must return an object or a list. See the sandbox file for its honest limits (not a container).
3. Send through **SafeFetch** (`infra/providers/node-bridge-runtime/safe-fetch.ts`): the host is resolved, **every** address must be
   public (private, loopback, link-local incl. the cloud metadata address, CGNAT, multicast, IPv4-mapped IPv6 are refused), the
   connection is pinned to the address that was checked, **redirects are not followed** (a 3xx is a failed run), 15 s timeout, the answer
   is read up to 1 MB and cut there (`truncated`), only http(s).
4. Write the log row (secrets masked, bodies cut to 16 KB), source `test` or `flow`.

`errorKind`: `blocked` (address refused), `function`, `timeout`, `network`, `status` (not 2xx), `invalid` (could not build the request,
missing API). `POST apis/test` answers **200 with `ok: false`** for all of these; 422 is only for an invalid definition.

The test response carries `status`, `durationMs`, the masked `request`, `response` (`headers`, `bodyText` up to 64 KB, `bodyJson` when
the body is JSON and not cut), `processedPayload` and `logId`. `apiId` in the test body makes a masked secret header use the stored
value (same address only, see 4); `values` overrides declared variables for the run.

Not built: a per-workspace rate limit on test runs (the permission is the guard), file parts in multipart payloads (text fields only, as
before), HTTP method override on redirect.

## 6. The flow node `api_library`

Group Integrations, WhatsApp flows only, label "API (from library)", ports `success` (1) and `error` (2).

`data`: `{ apiId, apiName, inputs: [{ name, value }], save }`. `inputs` override declared variables (a value or `{{flow_variable}}`); `save`
(default `api_response`) names the variable that holds the answer.

On a 2xx: `<save>` is the answer (JSON text) with every field as `<save>.<path>`, `<save>.status`, each `responseVariables` path as
`<ApiName>.<path>`, and the mapping writes into the run's contact (`ContactsService.setFieldFromFlow`: the contact's own text fields and
active custom properties only) and into the run's variables. Anything else (the API is gone, a blocked address, the function threw, a
timeout, a non-2xx) leaves by `error` with `<save>.status` (0 when there was no answer) and `<save>.error`, and the reason in the run
log. Save-time validation flags an `api_library` node with no `apiId`. Deleting an API a flow uses is refused unless forced; a forced
delete leaves those nodes on their `error` port.

## 7. Logs

`api_library_logs`: partitioned monthly, no foreign keys (a stream), id/uuid per row. A deleted API's log stays (`apiName` remembers it).
**Retention: 30 days**, a daily sweep in the worker (`ApiLibraryRetentionService`, 03:41). Filters: `apiId`, `status` (success/failed),
`statusCode`, `source` (test/flow/automation), `from`/`to`, `search` (URL, API name, error). `automation` is reserved for the automation
builder (no such module yet); only `test` and `flow` are written today.

## 7a. Numbered pages

`GET apis`, `GET logs` and `GET apis/:id/logs` take an optional `page` (1-based). With `page`, the list is offset-paged in the same
order (created_at, id; `order` as before) and `cursor` is ignored; the answer adds `page.total`, `page.page`, `page.pageSize`,
`page.totalPages` (ceil, at least 1), and repeats `total`, `pageSize`, `totalPages` at the top level (top-level `page` stays the
page-info object, so the page number is `page.page`). A page past the last is an empty `data` with the real total. Without `page` the
answer is the cursor shape, unchanged. The screens offer `limit` 10, 25, 50, 100 (any 1 to 200 is accepted). For logs in page mode with no
`from`, both the rows and the total are bounded to the retention window plus a day (older rows are swept anyway; this lets Postgres
prune the monthly partitions), and the count stops at 100 000.

## 8. Errors

| Code                   | HTTP | When                                                                     |
| ---------------------- | ---- | ------------------------------------------------------------------------ |
| `VALIDATION_FAILED`    | 422  | the definition breaks a rule (paths in `details`)                        |
| `ALIB_NAME_TAKEN`      | 409  | another API has the name                                                 |
| `ALIB_IN_USE`          | 409  | delete while flows use it; `details` = `{ path: flowId, message: name }` |
| `ALIB_LIMIT_REACHED`   | 422  | 200 saved APIs in the workspace                                          |
| `ROW_VERSION_CONFLICT` | 409  | the form was stale                                                       |
| `NOT_FOUND`            | 404  | unknown id, or another workspace's                                       |
