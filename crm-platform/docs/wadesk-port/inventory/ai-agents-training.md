---
domain: ai-agents-training
code: AIAG
title: AI Training (trained chat assistants and their knowledge)
wadesk_version: '1.7.0'
sources_read: 9
---

# AI Training (AIAG)

## Overview

AI Training is where a workspace builds **smart agents** (chat assistants: persona, model, safety settings) and the **knowledge** each answers from (a fetched URL, an uploaded file, pasted text or one Q&A pair). It lives at `/ai-training` (list, stats, the responder-mode card) with a five-step builder at `/ai-training/create` and `/ai-training/{id}/edit` (Identity, Persona, Brain, Safety, Knowledge). Two consumers read the result: the website chatbot widget (WGT) and the AI node of the flow runtime (FLR). Both assemble the assistant's persona plus its **ready** entries (and the workspace-wide ones) into the system prompt.

This file covers the AI Training screens, their API and their data. The inbox **AI agents** responder (`ai_agents`, `/ai-agents`, voice notes) and voice assistants (`ai_call_assistants`) are other features of this domain and are not part of this slice (WD-AIAG-017, 018).

Actors: workspace owner or admin (the menu entry is the `admin` tier) on a plan with `access_ai_chat_assistant` (ours: `ai_assistants`).

Connections: **WGT** (assistant picker, `contextFor`), **FLR/FLB** (AI node picker `assistants` in the builder context, runtime context), **AIADM** (the enabled-model list, key resolution, token metering at reply time), **WSP** (`workspace_settings.ai_responder_mode`, `meta_agent_enabled`), **PLAN** (`ai_assistants`), **RBAC** (`aiag.*` keys).

## Feature index

| Id          | Feature                                                       | Status      | Priority | Effort | Depends on               |
| ----------- | ------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------ |
| WD-AIAG-001 | Assistants list page with stats, search and row actions       | implemented | P0       | M      | —                        |
| WD-AIAG-002 | Assistant builder wizard (create, edit)                       | implemented | P0       | L      | WD-AIAG-003              |
| WD-AIAG-003 | Save assistant API (validation, slug, ownership)              | implemented | P0       | M      | —                        |
| WD-AIAG-004 | Duplicate assistant                                           | implemented | P1       | S      | WD-AIAG-003, WD-AIAG-006 |
| WD-AIAG-005 | Delete assistant (entries and stored files go with it)        | implemented | P0       | S      | WD-AIAG-003              |
| WD-AIAG-006 | Knowledge entries: free text and Q&A pairs                    | implemented | P0       | S      | WD-AIAG-003              |
| WD-AIAG-007 | Knowledge entries: URL (fetch, SSRF guard, state)             | implemented | P0       | M      | WD-AIAG-006              |
| WD-AIAG-008 | Knowledge entries: file upload and text extraction            | implemented | P0       | M      | WD-AIAG-006              |
| WD-AIAG-009 | Knowledge list and delete entry                               | implemented | P0       | S      | WD-AIAG-006              |
| WD-AIAG-010 | Workspace-wide entries (no assistant)                         | partial     | P2       | S      | WD-AIAG-006              |
| WD-AIAG-011 | Assistant picker for widgets and flows                        | implemented | P0       | S      | WD-AIAG-003              |
| WD-AIAG-012 | Orphan-entry self-heal on the list page                       | implemented | P2       | S      | WD-AIAG-005              |
| WD-AIAG-013 | Responder mode card (who answers WhatsApp)                    | implemented | P1       | S      | —                        |
| WD-AIAG-014 | Plan gate, role gate and permissions                          | implemented | P0       | S      | —                        |
| WD-AIAG-015 | Knowledge context assembly for the readers                    | implemented | P0       | M      | WD-AIAG-006              |
| WD-AIAG-016 | Create a knowledge base from the flow AI nodes (our addition) | docs-only   | P1       | S      | WD-AIAG-001, WD-AIAG-011 |
| WD-AIAG-017 | Inbox AI agents (`ai_agents`, `/ai-agents`, test reply)       | implemented | P1       | L      | WD-AIAG-003              |
| WD-AIAG-018 | AI voice assistants (`ai_call_assistants`)                    | implemented | P2       | L      | —                        |

## Features

### WD-AIAG-001 — Assistants list page with stats, search and row actions

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** `/ai-training` lists the workspace's assistants, newest first, 20 per page, with four stat cards, a status rail, a client-side search and per-row actions (edit, duplicate, delete). The responder-mode card (WD-AIAG-013) sits above it.
- **Actors & access:** owner or admin with the plan feature. Scope is the current workspace.
- **UX & screens:** `resources/views/user/ai-training/index.blade.php`, JS `resources/js/charts/user-ai-training-index.js`.
  - Left rail: a side tip linking to the chatbot widgets, an "Agent status" card (All / Active / Paused with counts, `paused = all - active`) and a "Knowledge tip".
  - Header: title "AI Training", an "N active" pill, "New smart agent".
  - Cards: Total agents (with active), Knowledge entries (with the ready count as "indexed"), Avg / agent (entries over agents, one decimal, `0` when none), Health (percent active; `healthy` when all active, `empty` when none, else `attention`).
  - Table: Agent (accent icon by `id % 4`, name linking to edit, status pill, `/slug · model`), Provider pill (OpenAI, Anthropic, Gemini have tints, any other shows as OpenAI), Knowledge ("N entries" or an em dash), Tone, Updated (short relative time plus `M d, H:i`), Actions.
  - Search "Search by name or slug" filters the loaded rows only. Footer "Showing X of Y". Empty state "No smart agents yet".
  - QUIRK: the status tabs and the rail buttons have no handler; "All" is always highlighted. Delete removes the row from the page and leaves the cards untouched.
- **Endpoints:** `GET ai-training` (HTML). Ours: `GET /v2/ai-training/assistants?limit&cursor` with `stats`.
- **Data:** `ai_chat_assistants` (soft delete in WaDesk, hard here), `ai_training_sources` counts (the row's count is the assistant's own entries only).
- **Rules & edge cases:**
  1. The "Knowledge entries" card counts every entry of the workspace, including workspace-wide ones.
  2. A provider other than the three tinted ones shows with the OpenAI pill (WaDesk's fallback).
  3. Search never queries the server.
- **Async & events:** none. **External systems:** none. **Settings:** none (page size 20).
- **Acceptance criteria:**
  - Given 25 assistants, When an admin opens the list, Then 20 appear newest first and the rest by cursor.
  - Given a workspace with none, Then "No smart agents yet" shows and Health reads `empty`.
  - Given "pric" typed in search, Then only matching name or slug rows stay and no request is sent.
  - Given another workspace's assistants, Then none appear.
- **Source refs:** `AiTrainingController@index`, `resources/views/user/ai-training/index.blade.php`, `resources/js/charts/user-ai-training-index.js`, `routes/web.php` (1349-1362).
- **Port notes:** The dead status filters are made to work client-side (`intended`, PORTING_RULES 5.2 "no dead buttons"). A delete refreshes the cards (`intended`). Cursor pagination replaces page numbers.

### WD-AIAG-002 — Assistant builder wizard (create, edit)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-AIAG-003
- **Summary:** A five-step wizard, one page for create and edit: Identity, Persona, Brain, Safety, Knowledge. Sticky header with a state pill and "Save draft"; stepper nodes; Previous / Next / "Finish & close".
- **Actors & access:** as WD-AIAG-001.
- **UX & screens:** `resources/views/user/ai-training/builder.blade.php`, `resources/js/charts/user-ai-training-builder.js`.
  - Step 1 Identity: name (required), roll-out status (live / paused), preferred language (ISO code text), tone (helpful, friendly, formal, playful).
  - Step 2 Persona: opening line (required), character brief (system prompt).
  - Step 3 Brain: provider (20 vendors), model name (text), reply length budget (50 to 4000 tokens), creativity (0 to 2).
  - Step 4 Safety: fallback reply, handoff on/off, trigger phrase, acknowledgement.
  - Step 5 Knowledge: see WD-AIAG-006 to 009. Reaching it saves the assistant first (entries need a saved row); clicking its node before a save says "Save the agent first".
  - Stepper: going back or to a step already reached is free; going forward runs the current step's validator (toast, red ring flash, scroll to the field). An existing assistant starts with every step reachable.
  - Defaults for a new assistant: status live, greeting "Hi! How can I help today?", a short helpful-website-assistant brief, tone helpful, language `en`, provider `openai`, model `gpt-4o-mini`, 400 tokens, creativity 0.7, a fallback sentence, handoff on with the phrase "talk to human" and a short acknowledgement.
  - Client rules: name required ("Name your assistant."), opening line required ("Write an opening line."), model required ("Pick a model."), tokens 50 to 4000, creativity 0 to 2.
  - QUIRK: the save reads `parseFloat(creativity) || 0.7`, so a creativity of 0 (strict) is saved as 0.7. `parseInt(tokens) || 400` has the same shape but tokens cannot be 0 after validation.
- **Endpoints:** `GET ai-training/create`, `GET ai-training/{id}/edit` (HTML), `POST ai-training/api/assistant`. Ours: `/ai-training/create`, `/ai-training/[id]/edit`, `POST` and `PATCH /v2/ai-training/assistants`.
- **Data:** `ai_chat_assistants`.
- **Rules & edge cases:** model name is free text in WaDesk; ours offers the models the workspace may use (`GET /v2/ai/models`) as suggestions and still accepts any id up to 80 characters.
- **Acceptance criteria:**
  - Given a blank name, When Next is pressed on step 1, Then "Name your assistant." shows and the step does not change.
  - Given tokens 49 or 4001, Then step 3 refuses; 50 and 4000 pass.
  - Given creativity 0, When the assistant is saved, Then 0 is stored (WaDesk stored 0.7).
  - Given a new assistant on step 4, When Next is pressed, Then it is saved and step 5 opens with an id.
  - Given an existing assistant, Then every stepper node is reachable at once.
- **Source refs:** `AiTrainingController@create`, `@edit`, `resources/views/user/ai-training/builder.blade.php`, `resources/js/charts/user-ai-training-builder.js`.
- **Port notes:** the creativity-0 bug is fixed (`intended`). The Provider list is the catalogue's text providers (no voice vendors).

### WD-AIAG-003 — Save assistant API (validation, slug, ownership)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** One endpoint creates or updates; the slug is made from the name and is unique per workspace.
- **Actors & access:** as WD-AIAG-001.
- **UX & screens:** none (JSON).
- **Endpoints:** `POST ai-training/api/assistant` (WaDesk). Ours: `POST /v2/ai-training/assistants`, `PATCH /v2/ai-training/assistants/:id` with `rowVersion`.
- **Data:** `ai_chat_assistants`.
- **Rules & edge cases:**
  1. Limits: name 120 required; greeting 1000; system prompt 8000; tone 32; language 16; provider one of the vendor list; model 80; tokens 50 to 4000; creativity 0 to 2; fallback 1000; handoff phrase 60; handoff message 1000; status `active` or `paused`.
  2. The slug is the slugified name (a random `assistant-xxxxxx` when the name has no letters or digits), then `-2`, `-3`... until free. A rename keeps the slug.
  3. The author is the signed-in user.
  4. QUIRK: saving with an id that is not in the workspace silently creates a NEW assistant. Ours answers 404 (`intended`).
  5. A stale `rowVersion` is 409 `ROW_VERSION_CONFLICT`.
  6. Each write leaves an audit row and an outbox event; the prompt text is not copied into the audit trail.
- **Acceptance criteria:**
  - Given the name "Support bot" three times, Then the slugs are `support-bot`, `support-bot-2`, `support-bot-3`.
  - Given two saves of one name at once, Then both succeed with different slugs.
  - Given a stale row version, Then the second editor gets 409 and nothing changes.
  - Given another workspace's id, Then 404.
  - Given a provider that is not a text vendor, Then 422.
- **Source refs:** `AiTrainingController@apiSaveAssistant`, `app/Models/AiChatAssistant.php`.
- **Port notes:** optimistic locking and the 404 are architecture and bug-fix deviations (`intended`).

### WD-AIAG-004 — Duplicate assistant

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AIAG-003, WD-AIAG-006
- **Summary:** Copies an assistant and its entries; the copy is named "<name> (copy)", gets the slug `<slug>-copy-xxxx` and is `paused`; the person lands in its editor.
- **Actors & access:** as WD-AIAG-001 (WaDesk) / `aiag.training.create` (ours).
- **UX & screens:** the row's duplicate icon.
- **Endpoints:** `POST ai-training/{id}/duplicate`. Ours: `POST /v2/ai-training/assistants/:id/duplicate`.
- **Data:** `ai_chat_assistants`, `ai_training_sources`, stored files.
- **Rules & edge cases:**
  1. Every entry is copied, including failed ones.
  2. QUIRK: WaDesk's entry copies point at the SAME stored file; deleting one entry deleted the file under the other. Ours copies the file (`intended` fix).
  3. An entry still being read is copied as processing and read again for the copy.
  4. A copy of an unknown id is 404 and creates nothing.
- **Acceptance criteria:**
  - Given an assistant with two entries, When duplicated, Then the copy is paused, named "<name> (copy)" and has both entries.
  - Given an entry with a file, When one of the two entries is deleted, Then the other's file remains.
- **Source refs:** `AiTrainingController@duplicate`.
- **Port notes:** as above.

### WD-AIAG-005 — Delete assistant (entries and stored files go with it)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AIAG-003
- **Summary:** Deleting an assistant deletes its own entries and their stored files; workspace-wide entries stay.
- **Actors & access:** as WD-AIAG-001 / `aiag.training.delete`.
- **UX & screens:** the row's trash icon, a confirm dialog "Delete "<name>"?" with the Keep and Delete agent buttons.
- **Endpoints:** `DELETE ai-training/api/assistant/{id}`. Ours: `DELETE /v2/ai-training/assistants/:id` (204).
- **Data:** foreign keys: entries cascade; a widget bound to the assistant is left unbound (`ON DELETE SET NULL`).
- **Rules & edge cases:** the stored files are removed after the transaction commits; a failure leaves an orphan file, never an entry. A second delete is 404.
- **Acceptance criteria:**
  - Given an assistant with entries and a file, When deleted, Then the entries and the file are gone and a workspace-wide entry remains.
  - Given a widget bound to it, Then the widget remains with no assistant.
- **Source refs:** `AiTrainingController@apiDeleteAssistant`, `resources/js/charts/user-ai-training-index.js`.
- **Port notes:** cascade is a foreign key; WaDesk's code loop is not needed.

### WD-AIAG-006 — Knowledge entries: free text and Q&A pairs

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AIAG-003
- **Summary:** Two instant entry kinds. Text is stored as pasted; a Q&A pair stores a question and an answer and is read as "Q: ... A: ...".
- **UX & screens:** Step 5 tiles "Free text" and "Q&A pair" open an inline panel: label, then text, or question and answer.
- **Endpoints:** `POST ai-training/api/source`. Ours: `POST /v2/ai-training/assistants/:id/sources`.
- **Data:** `ai_training_sources` (`kind` `text` or `qa`, `status` `ready`, `tokens_estimate`).
- **Rules & edge cases:**
  1. Label required, 200 characters. Text required, up to 200 000 characters. A Q&A needs both sides (question 5000, answer 20 000).
  2. `tokens_estimate` is characters over four, rounded up (a Q&A sums both sides).
  3. Ours: a paste larger than the platform's JSON body cap (100 KiB by default) is 413 `PAYLOAD_TOO_LARGE`; the panel says to upload a file instead (`intended`).
- **Acceptance criteria:**
  - Given text of 401 characters, Then the entry is ready with 101 tokens.
  - Given a Q&A with no answer, Then 422 and nothing is stored.
  - Given another workspace's assistant, Then 404.
- **Source refs:** `AiTrainingController@apiAddSource`, `app/Models/AiTrainingSource.php`.
- **Port notes:** contract limits mirror WaDesk's.

### WD-AIAG-007 — Knowledge entries: URL (fetch, SSRF guard, state)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AIAG-006
- **Summary:** A public page is fetched and reduced to text. WaDesk does it in the request; ours queues it and shows `processing` until the worker settles the entry as `ready` or `failed`.
- **Rules & edge cases:**
  1. Only http and https. Refused: a host with no name (`invalid URL`), other schemes, metadata host names, any host that resolves to a private, loopback, link-local, carrier-grade, reserved or documentation address (IPv4 and IPv6, including IPv4-mapped forms).
  2. Redirects are followed by hand, up to five, and every hop is checked again. The address that passed the check is the address connected to (no DNS rebinding gap).
  3. 20 second timeout, body cap, `User-Agent` of the bot. Script, style and comment blocks are dropped, tags stripped, whitespace collapsed, text cut at 80 000 characters. A page with no text is `failed` with "fetched page contained no text".
  4. A failure is stored on the entry (`status failed`, `error`); the page still shows the row so the person can remove it.
  5. Ours: the entry is `processing` first; only an entry still processing is settled, so a redelivered job or a deleted entry changes nothing.
- **Endpoints:** as WD-AIAG-006 (`kind: url`). Async: outbox event `ai_training_source.requested`, consumer `aiag-source-ingest` in the worker.
- **External systems:** the operator's page, through the `TRAINING_URL_FETCHER` port.
- **Acceptance criteria:**
  - Given `http://169.254.169.254/`, `http://localhost/`, `http://[::ffff:7f00:1]/` or `file:///etc/passwd`, Then the entry fails with the reason and no request leaves the server.
  - Given a public page that redirects to a private address, Then the second hop is refused.
  - Given a public page, Then the entry becomes ready with the extracted text and a token estimate.
- **Source refs:** `AiTrainingController@fetchUrlAsText`, `@guardSsrf`, `@resolveRedirectUrl`.
- **Port notes:** async read is `intended` (a slow or dead page never holds a request). The shared helper `infra/net/guarded-http.ts` misses hex-mapped IPv6, so this feature carries its own address rule (follow-up filed).

### WD-AIAG-008 — Knowledge entries: file upload and text extraction

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AIAG-006
- **Summary:** Uploads TXT, MD, Markdown, CSV, HTML, PDF and DOCX files of up to 10 MB, extracts the text and keeps the file for the entry's lifetime.
- **Rules & edge cases:**
  1. Label required. Extension decides the reader: PDF through a parser, DOCX through the ZIP part `word/document.xml` (paragraph ends and breaks become newlines, tabs stay), HTML with scripts and styles dropped, the rest verbatim.
  2. `.doc` is refused with a hint to re-save as `.docx`; other types with the accepted list. Over 10 MB is refused. No readable text (a scanned PDF, an empty document) is refused with a hint to paste text.
  3. Extracted text is trimmed and cut at 200 000 characters; tokens are estimated from it.
  4. Ours: the stored name is server-made; the response never carries a path (`hasFile` only); a text file that is binary and a ZIP that inflates past 64 MB are refused (`intended` hardening).
- **Endpoints:** `POST ai-training/api/source/file`. Ours: `POST /v2/ai-training/assistants/:id/sources/file` (multipart `file`, `label`).
- **Acceptance criteria:**
  - Given each accepted type, Then the entry is ready with the file's text.
  - Given `old.doc`, Then 422 `AIAG_FILE_TYPE_UNSUPPORTED` with the re-save hint; given 10 MB plus one byte, 413 `AIAG_FILE_TOO_LARGE`.
  - Given a file with no text, Then 422 `AIAG_FILE_NO_TEXT` and nothing is stored.
- **Source refs:** `AiTrainingController@apiUploadFile`, `@extractFileText`, `@docxToText`.
- **Port notes:** stored through the `TRAINING_FILE_STORE` port (local disk under the media root; an object-storage adapter is one binding).

### WD-AIAG-009 — Knowledge list and delete entry

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AIAG-006
- **Summary:** Step 5 lists the assistant's entries and the workspace-wide ones, newest first, with kind, label (and URL), state pill, error, and a delete button with a confirm dialog "Remove this knowledge entry?".
- **Endpoints:** `GET ai-training/api/sources?assistant_id`, `DELETE ai-training/api/source/{id}`. Ours: `GET /v2/ai-training/assistants/:id/sources`, `DELETE /v2/ai-training/sources/:id`.
- **Rules & edge cases:** deleting removes the stored file; a second delete is 404; another workspace's entry is 404. Ours adds a token estimate per ready entry and polls while any entry is `processing`.
- **Acceptance criteria:**
  - Given an entry with a file, When removed, Then the row and the file are gone.
  - Given another workspace's entry id, Then 404.
- **Source refs:** `AiTrainingController@apiListSources`, `@apiDeleteSource`.
- **Port notes:** the response never includes the text, the question, the answer or a path.

### WD-AIAG-010 — Workspace-wide entries (no assistant)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AIAG-006
- **Summary:** Entries with no assistant exist in the table and are read by every assistant of the workspace, and listed (and deletable) from every assistant's Step 5. No WaDesk screen creates one.
- **Rules & edge cases:** the readers include them; deleting an assistant leaves them; the list marks them "workspace-wide". Ours has no way to create one either (nothing in WaDesk does).
- **Acceptance criteria:** Given a workspace-wide entry, Then it appears on every assistant's list and in the picker counts, and survives an assistant's delete.
- **Source refs:** `AiChatService@contextFor`, `@apiListSources`.
- **Port notes:** kept as is. QUIRK: shared by every assistant, even a paused one.

### WD-AIAG-011 — Assistant picker for widgets and flows

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-AIAG-003
- **Summary:** The chat widget builder lists active assistants by name; the flow builder's AI nodes list every assistant with its ready-entry count.
- **Endpoints:** `GET ai-training/api/assistants` (WaDesk: active only, id, name, provider, model). Ours: `GET /v2/ai-training/assistants/picker` (active, with `sources`), `GET /v2/widgets/assistants` (WGT) and `GET /v2/flows/builder-context` (FLB, `assistants`).
- **Rules & edge cases:** the flow picker counts ready entries of the assistant plus workspace-wide ones and lists paused assistants too (an assistant picked earlier must stay visible).
- **Acceptance criteria:** Given active and paused assistants, Then the picker lists only the active, by name.
- **Source refs:** `AiTrainingController@apiListAssistants`.

### WD-AIAG-012 — Orphan-entry self-heal on the list page

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-AIAG-005
- **Summary:** On every list load WaDesk deleted entries whose assistant no longer existed (left by a time before cascade existed).
- **Rules & edge cases:** with the foreign key cascade an orphan cannot exist, so there is nothing to sweep.
- **Acceptance criteria:** Given an assistant delete, Then no entry of it survives (WD-AIAG-005).
- **Source refs:** `AiTrainingController@index`.
- **Port notes:** `intended`: not needed with FK cascade. Stored files of an organization's entries removed by a workspace delete are not removed (follow-up with the retention job).

### WD-AIAG-013 — Responder mode card (who answers WhatsApp)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** —
- **Summary:** A card above the list: three modes (`wadesk_only`, `meta_agent_only`, `meta_agent_then_handoff`) and a checkbox "I use Meta Business Agent", saved together with Save.
- **Actors & access:** the same role gate as the page (WaDesk); ours `aiag.responder.manage` to change, `aiag.training.read` to see.
- **Endpoints:** `POST ai-training/responder-mode`. Ours: `GET` and `PUT /v2/ai-training/responder`.
- **Data:** `workspace_settings.ai_responder_mode`, `workspace_settings.meta_agent_enabled` (a workspace with no settings row gets one).
- **Rules & edge cases:**
  1. Mode must be one of the three; the box is a boolean (unticked = false, even when a Meta mode is chosen).
  2. WaDesk stops its AI and keyword auto-replies when a Meta mode is saved (`AiAgentService`, `KeywordReplyDispatcher`). This slice stores the choice and audits a change; the stand-down is enforced where those replies are sent and is NOT changed here.
  3. Meta's agent needs a Cloud API number; unofficial-engine numbers always use our AI (hint text only).
- **Acceptance criteria:**
  - Given each mode and box state, When saved, Then the stored values are read back.
  - Given an unknown mode, Then 422 and nothing changes.
  - Given a read-only member, Then the card shows the setting without a Save button and a `PUT` is 403.
  - Given an unchanged save, Then no audit row is written.
- **Source refs:** `AiTrainingController@saveResponderMode`, `Workspace::RESPONDER_MODES`.
- **Port notes:** see rule 2; the readers of these two columns are tracked in the wiring file (WIRE-AIAG-012).

### WD-AIAG-014 — Plan gate, role gate and permissions

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** —
- **Summary:** WaDesk gates the group on the plan feature `access_ai_chat_assistant` and shows the entry to the `admin` tier. Ours: plan feature `ai_assistants` on every route (a read is refused too), and five keys: `aiag.training.read`, `.create`, `.update`, `.delete`, `aiag.responder.manage` (Owner and Admin by default).
- **Rules & edge cases:** WaDesk's page-only paywall let JSON endpoints answer on a locked plan; ours is 422 `PLAN_FEATURE_LOCKED` everywhere and the screens draw the upgrade sheet.
- **Acceptance criteria:** Given the plan flag off, Then every route is 422 and nothing is written. Given a member with only `read`, Then create, edit, duplicate, delete, add entry and responder save are 403.
- **Source refs:** `routes/web.php` (plan middleware), `EnforcePlanFeature`.

### WD-AIAG-015 — Knowledge context assembly for the readers

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-AIAG-006
- **Summary:** At reply time the readers collect the assistant's entries and the workspace-wide ones where `status = 'ready'`, in id order, each as `[label]` plus its text (a Q&A as "Q: ... A: ..."), cut at about 12 000 characters, and append the block to the system prompt.
- **Rules & edge cases:** failed, processing and other-workspace entries are never included. The readers are the flow runtime's AI node and the chatbot widget; they query the tables directly (`ai-call.service.ts`, `chatbot-widget/_shims`), so what this slice writes is what they read.
- **Acceptance criteria:** Given ready, processing, failed, workspace-wide and foreign entries, Then only the assistant's ready entries and the workspace's ready workspace-wide ones are read (covered by an e2e through the widget's directory reader).
- **Source refs:** `AiChatService@contextFor`, `AiAgentService` (knowledge injection).
- **Port notes:** the readers are not changed.

### WD-AIAG-016 — Create a knowledge base from the flow AI nodes (our addition)

- **Status:** docs-only
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-AIAG-001, WD-AIAG-011
- **Summary:** Not a WaDesk feature: a user reported the flow AI node's "Knowledge base (optional)" had no way to make one and `/ai-training` was a 404. The AI, call-AI and Instagram-AI node forms now offer "+ Create knowledge base" (opens `/ai-training/create` in a new tab) and "Refresh list" (re-reads the builder context). The empty-state copy says "No knowledge bases yet" and the AI Training links open in a new tab so a flow with unsaved changes is never replaced.
- **Acceptance criteria:** Given an AI node, Then the create link opens `/ai-training/create` with `target=_blank` and Refresh list re-reads the builder context.
- **Port notes:** `intended` (not a WaDesk behavior). Also repointed: the chat widget screens' "AI Training" links now go to `/ai-training` (they pointed at the planned `/ai-assistants` entry).

### WD-AIAG-017 — Inbox AI agents (`ai_agents`, `/ai-agents`, test reply)

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-AIAG-003
- **Summary:** The team inbox's AI responders (`routes/web.php` 1729-1733: list, create, update, delete, test reply) that answer conversations assigned to an AI agent, with handoff, voice notes and per-conversation reply caps. Table `ai_agents` exists; it can link a knowledge assistant.
- **Port notes:** not built in this slice (`blocked`: separate port, depends on the inbox AI responder runtime and the voice providers).

### WD-AIAG-018 — AI voice assistants (`ai_call_assistants`)

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** —
- **Summary:** Voice-call assistants (separate columns from chat assistants). The flow builder's call node links to them.
- **Port notes:** not built in this slice (`blocked`: belongs with calling-voice; the table exists and the builder context already lists them).

## Data model

- `ai_chat_assistants` (org, id, uuid, user, name, slug unique per org, greeting, system_prompt, tone, language, ai_provider, ai_model, reply_max_tokens, temperature numeric(4,2), fallback_message, handoff_enabled, handoff_keyword, handoff_message, status, row_version). No change needed.
- `ai_training_sources` (org, id, uuid, assistant_id nullable cascade, user, kind, label, url, file_path, content, question, answer, status, tokens_estimate, error, row_version). No change needed; `file_path` never leaves the server.
- `workspace_settings.ai_responder_mode`, `.meta_agent_enabled` (existing columns).
- Migration `20261105100000_aiag_permissions.sql`: five permission keys.

## Cross-domain contracts

- **Provides:** `ai_chat_assistants` and ready `ai_training_sources` rows read by FLR (`AiCallService`) and WGT (`SqlAssistantDirectory`); the picker for WGT and FLB.
- **Consumes:** AIADM `GET /v2/ai/models`; PLAN `ai_assistants`; the kernel outbox, audit and the media root.
