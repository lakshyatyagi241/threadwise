# channel-sms build plan (send-only)

Spec: `inventory/channel-sms.md` (TW-SMS-001..030). Owner decision: SMS is SEND-ONLY, no receive path (TW-SMS-D01..D08 dropped).
Contracts already written: `packages/contracts/src/channel-sms/{sender,segments}.ts`, error codes `SMS_*` in `common/errors.ts`.

## Decisions (made for the build; owner may overrule)

1. Storage: `wa_provider_configs` rows with `provider='sms'` (as Reference; the broadcast/campaign sender directory, FK trigger and read queries already accept `'sms'`). NO new sender table.
   - FROM value in `phone_number` (plain), `display_label` 'SMS · Twilio' | 'SMS · MSG91', `is_primary=false`, status `connected|disconnected`.
   - `credentials_json` = CryptoService-sealed JSON `{account_sid, auth_token, from_number}` (MSG91: key in `auth_token`, normalised: never in account_sid).
   - `meta_json` = `{sms_provider, sender_id, dlt_template_id, rate_per_segment, currency}`.
   - Migration adds partial unique index `(org_id, phone_number) WHERE provider='sms'` + permissions `sms.senders.read`, `sms.senders.manage` (category sms) granted to admin like `20261002120000_tg_permissions.sql`.
2. Send path: implement `EngineSender` (modules/broadcasts barrel exports `EngineSenderRegistry`, `EngineSender`, `OpenedSender`, `OutgoingText`) registered for engine `'sms'` on module init, in BOTH api and worker (worker module imported in `workers/workers.module.ts`). `sendText` renders nothing itself (dispatcher passes rendered text); it sends one SMS via the provider adapter, returns `providerMessageId`; throws on failure with the translated operator message (TW-SMS-013).
3. Provider port `infra/providers/channel-sms/sms.port.ts` (never-throw result objects), adapters Twilio + MSG91 using `fetch` with timeouts, secret scrubbing. Tests use fake. No env credentials; `config/domains/channel-sms.env.ts` only holds base URLs/timeouts/mode.
4. Delivery reports: public `POST /v2/sms/status` (Twilio form callback `MessageSid/MessageStatus/ErrorCode`, MSG91 DLR JSON) -> map status -> `BroadcastReceiptsService.handle` (and campaign equivalent if one exists). FIX Reference defects: signature check for Twilio (X-Twilio-Signature using stored auth token via a SECURITY DEFINER lookup) and monotonic ordering via the existing receipts state machine.
5. Plan gate: add plan feature key `sms` (label 'SMS channel') + limit `sms_monthly` to `packages/contracts/src/plans-subscriptions-trials/catalogue.ts` per its header; `@RequirePlanFeature('sms')` on sender controllers. Platform switch `sms_enabled` (system setting, default off) hides entry points; the operator console toggles it (`/admin/sms`, `PUT /v2/platform/sms`). Quota check once per run AND per recipient. Billing: NOT wallet (TW-SMS-027), no wallet event.
6. Segments: UCS-2 counts UTF-16 units (deliberate fix of Reference under-count); show counter in composers.
7. Merge variables: named variables must render (fix Reference defect TW-SMS-014). Send-later must schedule (fix TW-SMS-020). Opt-out contacts skipped (TW-SMS-024). Twilio 21610 flags contact unsubscribed (default yes).
8. DLT: keep Reference model (one DLT template id per sender) + optional `dlt_entity_id` is NOT added (owner decision pending).
9. No `CHANNEL_KINDS` entry, no inbox thread, no inbound route.
10. Seams (edits outside zone, list each in PR): `broadcasts/broadcasts-compose.service.ts` (sender list `sms`, ENGINE_LABEL, `?channel=sms`), `campaigns/campaigns.service.ts` noButtons, `campaigns/lib/engine-gate.ts` (web), template channel `sms`, plan catalogue, `app.module.ts`, `workers.module.ts`, `settings-planned.ts` (remove `sms`), `features/_registry/settings.test.ts`, `features/broadcasts/api/channels.ts`.
