# Parity: calling-voice (CALL)

What differs from Reference 1.7.0, and why. Status per feature is in the [tracker](../tracker/vedant.md); the map is in
[wiring/calling-voice.md](../wiring/calling-voice.md). Built from the inventory and the reference source
(`WaCallingController`, `WaCallingService`, `WaCallingWebhookController`, `resources/js/calling/*`).

## Differences, by feature

| Id | Reference | Here | Why |
| --- | --- | --- | --- |
| 001, 002 | a separate calling webhook, and the messages webhook forwarded its `calls` field into it so permission updates were not dropped | one WhatsApp callback carries the `calls` field; `/wa-calling` is the same door; one signature check, one queue | two handlers had to be kept in step; Meta allows one callback per app |
| 002 | scan and decrypt every WABA config to find the workspace | the indexed `waba_route_lookup` the other fields use | cost grew with the number of workspaces |
| 004 | the dial endpoint did not check that calling was on | `CALL_NOT_ENABLED` (422) | a call on a number that has calling off can only fail at Meta |
| 006 | the permission was read from the workspace's FIRST WhatsApp number, and a lapsed grant was reported as `granted` | the number the conversation is on; a lapsed grant is `expired`; `usable` is computed on the server | inventory quirks; a stale `granted` made the client skip the confirm and the server then refused |
| 008 | the call row stayed `ringing` forever when Meta refused the connect | the row is `failed` with the reason | an orphan ringing call never mirrored to logs and could not be cleaned up |
| 008 | `contact_id` and `conversation_id` were not checked against the workspace | looked up by uuid in the workspace; an unknown one is ignored | tenant safety |
| 011 | contact matched by decrypting every contact of every workspace member | the indexed normalised phone; the thread by the customer's key on the number's channel | cost; tenant scope |
| 011 | the row lookup `OR`ed an unset correlation against a literal sentinel | each side of the match is only used when it has a value | inventory quirk |
| 012 | the poll ran only on the Team Inbox page | same endpoint; the web `IncomingCallToast` is a component the inbox mounts | the inbox is TIB1's screen; a push channel is a later step (the inventory's port note) |
| 013 | a transaction with a row lock | one atomic `UPDATE ... WHERE status = 'ringing'`; the loser gets 409 `CALL_STATE_CONFLICT` | same guarantee, no long lock |
| 014, 020 | dead endpoints | not ported | the inventory's port notes: pre_accept is a step of accept; AI calls arm recording from the assistant |
| 015 | any status could be rejected | only a ringing call; 409 otherwise | a live call could be cut by a stray click (inventory port note) |
| 016 | any manager could hang up; errors ignored by the browser | same; terminate on a finished call answers 200 without Meta | idempotent |
| 017 | for an outbound call the bubble's `to_number` was the business number | the bubble sits in the customer's thread under the customer's key | inventory quirk |
| 017 | the bubble was written into `inbox_messages` | a `system` line (`messages.kind = 'system'`) with `meta.event = 'call'`, once, keyed `call:<uuid>` | the inbox here is one messages table |
| 019 | recordings on the public disk under a guessable URL | the tenant's private media store, read only through `GET /v2/calling/calls/:id/recording` by a person of the workspace; a replaced file is removed | privacy gap named in the inventory |
| 018, 019 | inbound calls were recorded without a word to anyone | the panel shows "This call is being recorded" while it records | inventory compliance note |

## Not done, and what it costs

- **The AI answers nothing.** An inbound call rings the operators; there is no assistant to take it, no voicemail after the pickup delay and no
  bridge to close on terminate. A call nobody accepts ends as `missed` when the customer hangs up or Meta times it out.
- **Plan columns.** Minute caps and `access_call_recording` were never enforced in Reference and are not here; the one gate is the plan feature
  `waba_calling` (default on for existing plans).
- **No push.** Operators learn of a ringing call by polling every 4 seconds while the toast component is mounted.
- **Browser parts are untested against a real microphone and Meta.** The peer is unit-tested with fakes; the API half is tested end to end
  against a fake Meta that records every request. A first call through a real number is the check that remains.
