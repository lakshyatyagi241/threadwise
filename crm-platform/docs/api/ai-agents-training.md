# AI Training API (AIAG)

Trained chat assistants and their knowledge, behind `/v2/ai-training`. Contracts: `packages/contracts/src/ai-agents-training/`. Module:
`apps/api/src/modules/ai-agents-training`. Parity notes: `docs/threadwise-port/parity/ai-agents-training.md`.

Bearer token, problem+json errors, every mutation takes `Idempotency-Key`, ids are uuids. Keys: `aiag.training.read|create|update|delete`, `aiag.responder.manage`
(Owner and Admin by default). The plan feature `ai_assistants` gates every call: without it every route is 422 `PLAN_FEATURE_LOCKED` (reads too). Another workspace's
id is always 404.

| Method and path                     | Key       | Notes                                                                                                                                                                            |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /assistants?limit&cursor`      | read      | `{ data: [assistant], page, stats: {all, active, sources, ready} }`; newest first, 20 per page.                                                                                  |
| `GET /assistants/picker`            | read      | `{ data: [{id, name, aiProvider, aiModel, sources}] }`: active assistants by name; `sources` = ready entries it answers from.                                                    |
| `GET /assistants/:id`               | read      | The assistant as the builder edits it.                                                                                                                                           |
| `POST /assistants`                  | create    | Only `name` is required; the rest takes the wizard defaults. 201. Unknown fields are 422.                                                                                        |
| `PATCH /assistants/:id`             | update    | The form plus `rowVersion`; a field left out keeps its value, a blank optional text clears it. 409 `ROW_VERSION_CONFLICT`. Slug does not change.                                 |
| `POST /assistants/:id/duplicate`    | create    | 201; `<name> (copy)`, paused, slug `<slug>-copy-xxxx`, entries and their files copied.                                                                                           |
| `DELETE /assistants/:id`            | delete    | 204; its entries and stored files go with it.                                                                                                                                    |
| `GET /assistants/:id/sources`       | read      | `{ data: [source] }`: the assistant's entries plus workspace-wide ones (`assistantId: null`), newest first.                                                                      |
| `POST /assistants/:id/sources`      | update    | JSON `{kind: 'url'\|'text'\|'qa', label, ...}`. Text and Q&A are `ready`; a URL answers `processing` and is read by the worker.                                                  |
| `POST /assistants/:id/sources/file` | update    | Multipart `file` + `label`. TXT, MD, CSV, HTML, PDF, DOCX up to 10 MB. 422 `AIAG_FILE_TYPE_UNSUPPORTED`, `AIAG_FILE_NO_TEXT`, `AIAG_FILE_UNREADABLE`; 413 `AIAG_FILE_TOO_LARGE`. |
| `DELETE /sources/:id`               | update    | 204; removes the entry and its stored file.                                                                                                                                      |
| `GET /responder`                    | read      | `{ mode: 'threadwise_only'\|'meta_agent_only'\|'meta_agent_then_handoff', metaAgentEnabled }`.                                                                                       |
| `PUT /responder`                    | responder | Stores the two settings on `workspace_settings` and audits a change. Does not change what the senders do.                                                                        |

Sample: a Q&A entry and what comes back.

```json
POST /v2/ai-training/assistants/9b1d.../sources
{ "kind": "qa", "label": "Refunds", "question": "How long do refunds take?", "answer": "Three to five business days." }

201
{ "id": "5c0e...", "assistantId": "9b1d...", "kind": "qa", "label": "Refunds", "url": null, "status": "ready",
  "tokensEstimate": 21, "error": null, "hasFile": false, "createdAt": "2026-11-01T10:00:00.000Z" }
```

A URL entry settles asynchronously (`processing`, then `ready` with a token estimate, or `failed` with `error`); the response never carries the extracted text, a file path or an
internal id. Events (outbox): `ai_assistant.created|updated|deleted`, `ai_training_source.created|deleted|requested`, `ai_responder.changed`.
