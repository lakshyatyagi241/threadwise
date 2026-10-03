# Wiring map: calling-voice (CALL)

Read with [the inventory entry](../inventory/calling-voice.md). `built` = in this repo and tested; `intended` = deliberately different (reason in
[parity/calling-voice.md](../parity/calling-voice.md)); `not ported` = dead code in WaDesk; `not built` = outside the 21 tracked features, listed so it
is not lost. The inventory details 001 to 021; 022 onward (call logs, assistants, the Node bridge, voice notes, voicemail) are index rows.

## How a call moves

| Step | WaDesk | Ours |
| --- | --- | --- |
| Meta tells us | its own `webhooks/wa-calling` handler, plus a forward from the messages webhook | one WhatsApp callback (`/v2/public/webhooks/whatsapp`) already carries the `calls` field; `/v2/public/webhooks/wa-calling` is the same door under WaDesk's name (same token, same signature check, same queue) |
| Route to a workspace | scan and decrypt every WABA config | `waba_route_lookup` (indexed), already used by every other field |
| Handle it | inline in the controller | `WabaIngestService` hands `calls` to `WABA_CALLS_SINK`; the calling domain binds it (`CallingWabaSink` to `CallEventsService`) |
| Place a call | `WaCallingService` | `CallActionsService.dial`: permission first, row written before Meta, marked `failed` when Meta refuses |
| Answer | transaction with a row lock, Meta pre_accept then accept | one atomic `UPDATE ... WHERE status = 'ringing'` claims it; pre_accept, 900 ms, accept with the same SDP; a Meta refusal puts it back to ringing |
| End | Meta's terminate webhook | the same; the row is closed with Meta's status and duration, and one bubble is written in the customer's thread |

## Where it plugs into the rest

| Seam | What | Where |
| --- | --- | --- |
| WABA webhook | `WABA_CALLS_SINK` / `WABA_CALLS_SINK_OVERRIDE` (new, additive, the way the inbox binds `WABA_INBOUND_SINK`); `calls` added to `HANDLED_FIELDS` | `whatsapp-cloud-api-waba/waba-calls-sink.ts` |
| WABA connections | `WabaConnectService.resolveConnection` for the number's credentials; `WabaWebhookService` exported for the alias URL | `calling-support.ts` |
| Meta's calls API | `CALLING_GRAPH` port and client over the shared `WabaHttp` (version, auth, timeout, error shape) | `infra/providers/calling-voice/` |
| Inbox thread | `ConversationsFacade.recordOutbound` now takes `kind: 'system'`, `direction`, `meta`, so a call bubble is a system line with `meta.event = 'call'`; its idempotency key is `call:<uuid>` | `chat-conversations/conversations.service.ts` |
| Plan | feature `waba_calling` (default on) | `plans-subscriptions-trials/catalogue.ts` |
| Permissions | `call.calls.use`, `call.calling.manage` (Owner, Admin, Manager) | migration `20261019100000_call_permissions` |

## Rows

| Id | Feature | Permission | Feeds it | Consumers | Where | State |
| --- | --- | --- | --- | --- | --- | --- |
| WD-CALL-001 | Webhook verification | public | Meta | Meta | `CallingWebhookController` (alias of the WABA handshake) | built, `intended` (one handler) |
| WD-CALL-002 | Webhook receiver, signature, routing | public | Meta | the sink | WABA `WabaWebhookService`, `WabaIngestService`, `CallEventsService` | built, `intended` (one handler, indexed lookup; a call event failing is logged and never retried as a whole) |
| WD-CALL-003 | Calling status per number | `call.calls.use` + `waba_calling` | `GET /v2/calling/numbers` | dialler, calling page | `CallingNumbersService.list` | built |
| WD-CALL-004 | Switch calling on a number | `call.calling.manage` | `POST /v2/calling/numbers/:id/toggle` | calling page | `CallingNumbersService.toggle`, `CALLING_GRAPH.setCalling` | built |
| WD-CALL-005 | Permission request | `call.calls.use` | `POST /v2/calling/permission-request` | Call button, dial | `CallPermissionService.send` | built |
| WD-CALL-006 | Permission ledger and eligibility | `call.calls.use` | `permission_update`, `GET /v2/calling/eligibility` | inbox Call button | `CallPermissionService.record`, `CallingNumbersService.eligibility` | built, `intended` (the conversation's own number; a lapsed grant reads `expired`) |
| WD-CALL-007 | Inbox Call button | `call.calls.use` | eligibility, permission, dial | team inbox | web `CallButton` | frontend built; mounted in the inbox thread header |
| WD-CALL-008 | Dial | `call.calls.use` | `POST /v2/calling/calls/dial` | browser peer | `CallActionsService.dial` | built, `intended` (calling must be on; a refused dial is `failed`) |
| WD-CALL-009 | Browser WebRTC peer | none | dial, progress, accept | on-call panel | web `CallPeer` | frontend built; no real microphone test |
| WD-CALL-010 | Dial progress poll | `call.calls.use` | `GET /v2/calling/calls/:id/progress` | peer | `CallActionsService.progress` | built |
| WD-CALL-011 | Connect event | none | `calls` webhook | pending poll | `CallEventsService.onConnect` | built; the AI answer and voicemail timer are not (see below) |
| WD-CALL-012 | Incoming-call poll and toast | `call.calls.use` | `GET /v2/calling/calls/pending` | team inbox | `CallActionsService.pending`, web `IncomingCallToast` | built (poll only: no push yet) |
| WD-CALL-013 | Accept | `call.calls.use` | `POST /v2/calling/calls/:id/accept` | toast | `CallActionsService.accept` | built |
| WD-CALL-014 | Standalone pre-accept | none | none | none | pre_accept is a step of accept | not ported (dead code) |
| WD-CALL-015 | Decline | `call.calls.use` | `POST /v2/calling/calls/:id/reject` | toast | `CallActionsService.reject` | built, `intended` (only a ringing call) |
| WD-CALL-016 | Hang up | `call.calls.use` | `POST /v2/calling/calls/:id/terminate` | panel | `CallActionsService.terminate` | built |
| WD-CALL-017 | Terminate event and thread bubble | none | `calls` webhook | inbox, call log | `CallEventsService.onTerminate` | built, `intended` (the bubble keeps the customer's number; Node bridge close is not built) |
| WD-CALL-018 | On-call panel | `call.calls.use` | peer | team inbox | web `OnCallPanel` | frontend built |
| WD-CALL-019 | Operator recording | `call.calls.use` | `POST/GET /v2/calling/calls/:id/recording` | call logs, panel | `CallRecordingsService`, web recorder | built, `intended` (private storage, consent line) |
| WD-CALL-020 | Server-side start recording | none | none | none | AI calls arm from the assistant | not ported (dead code) |
| WD-CALL-021 | Call event ledger | none | every step above | support | `CallsRepository.logEvent`, table `wa_call_events` | built |

## Not built

| What | Why |
| --- | --- |
| AI call assistants, the assistant wizard, call flows (IVR), the AI voice node | AI keys and agents domains (AIADM, AIAG); needs a server-side WebRTC peer in the Node bridge |
| The Node bridge answering a call (listen, think, speak), recording both sides, closing the bridge on terminate | same; `connect` records the call and leaves it ringing for operators |
| Call logs (list, KPIs, detail, three audio players, WAV and MP3 conversion), the `ai_call_logs` mirror | index rows of this domain; the data (`wa_calls`, `wa_call_events`, recording) is in place |
| Voicemail fallback after the pickup delay, voice-note AI replies | depend on assistants and TTS |
| Minute caps and `access_call_recording` plan columns | never enforced in WaDesk; not enforced here (`waba_calling` is the one gate) |
