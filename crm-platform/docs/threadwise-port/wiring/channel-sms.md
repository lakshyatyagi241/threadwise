# Wiring map: channel-sms (SMS, send-only)

Hand-written from the controllers, repositories and seams of the SMS backend. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                 | Permission                | Notes                                                     |
| ------ | ------------------------------------ | ------------------------- | --------------------------------------------------------- |
| GET    | `/v2/sms/senders`                    | `sms.senders.read`        | plan feature `sms` on the whole controller                |
| POST   | `/v2/sms/senders`                    | `sms.senders.manage`      | verify with the provider, then upsert by From             |
| PATCH  | `/v2/sms/senders/:id`                | `sms.senders.manage`      | `{active, rowVersion}`                                    |
| DELETE | `/v2/sms/senders/:id`                | `sms.senders.manage`      |                                                           |
| POST   | `/v2/sms/lookup`                     | `sms.senders.read`        | Twilio Lookup, throttled 30 a minute per user             |
| POST   | `/v2/sms/status`                     | public                    | Twilio delivery report, `X-Twilio-Signature`              |
| POST   | `/v2/sms/status/:secret`             | public                    | MSG91 delivery report, per-sender secret                  |
| GET    | `/v2/broadcasts/compose?channel=sms` | `bcast.broadcasts.create` | the SMS card's senders and templates (seam in broadcasts) |

## Tables read or written

`wa_provider_configs` (`provider = 'sms'`: the senders; `provider = 'twilio'` read for key reuse), `plan_usage` (metric `sms_sent`, period `YYYYMM`),
`contacts` (`is_unsubscribed` read at send time, set on Twilio 21610), `broadcasts`, `broadcast_contacts`, `wp_campaigns`, `wp_campaign_contacts`
(through the shared dispatchers and receipts), `wa_templates` (`channel = 'sms'` read by the composer), `devices` (device cap count),
`platform_settings` (`sms_enabled`, read), `org_plan_state` / `plans` (feature `sms`, limit `sms_monthly`, limit `devices`).
SECURITY DEFINER lookups: `bcast_receipt_lookup`, `camp_receipt_lookup` (existing), `sms_sender_by_dlr_secret` (new).

## Settings read

| Setting                  | Where                               | Reader                                                                                                                                                                          |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sms_enabled`            | `platform_settings` (default off)   | `SmsAvailability`, `BroadcastsComposeService`. Written by `PUT /v2/platform/sms` (`SmsPlatformService`, super admin, audit `platform.sms_updated`); operator page `/admin/sms`. |
| plan feature `sms`       | plan catalogue (default off)        | `@RequirePlanFeature('sms')`, broadcast and campaign creation                                                                                                                   |
| plan limit `sms_monthly` | plan catalogue (0 = unlimited)      | `SmsEngineSender`, usage panel meter                                                                                                                                            |
| plan limit `devices`     | plan catalogue                      | `SmsSendersService.connect` (new sender only)                                                                                                                                   |
| `SMS_*` environment      | `config/domains/channel-sms.env.ts` | `SmsProviderGateway`                                                                                                                                                            |

## Queues and workers

None of its own. The `sms` engine is registered in `EngineSenderRegistry` by `ChannelSmsModule` (API) and `ChannelSmsWorkerModule` (worker), so the
broadcast dispatch processor and the campaign processor send it. Scheduling, retries and sweepers are the shared ones.

## Outbox events emitted

`sms.sender.connected`, `sms.sender.toggled`, `sms.sender.removed`. Delivery reports reuse the broadcast and campaign status events (no per-message event).

## Seams in other domains (each minimal)

- broadcasts: `broadcasts-compose.service.ts` (`?channel=sms`, label, SMS templates kept out of the WhatsApp list), `broadcasts-read.controller.ts`, `broadcasts.service.ts`
  (plan feature `sms`, wallet precheck skipped for SMS), `broadcasts-actions.service.ts` and `broadcasts.repository.ts` (retry skips the wallet precheck for SMS),
  `broadcast-dispatch.service.ts` (no pacing gap for SMS, named variables render), `_shims/sql-sender-directory.ts` (an alphanumeric sender is usable).
- campaigns: `campaigns.service.ts` (no buttons, plan feature, wallet skipped), `campaigns-actions.service.ts` (wallet skipped), `campaign-dispatch.service.ts` (no pacing).
- plans: `plan-usage.service.ts` (the `sms_monthly` meter), catalogue in `@crm/contracts`.
- platform-infrastructure: `log-redaction.ts` (`x-twilio-signature` is never logged).
- auth audit baseline: `tools/auth-audit/baseline/public-routes.json` (the two delivery-report routes).

## Blocked or not wired

- Web screens, composer segment counters, menu / More tile / Channels rows: the web session.
- SMS template creation: the templates domain's create path is WhatsApp-only (`channel` is hard-coded `waba`); the composer already reads `channel = 'sms'`.
- A per-message outbound record with segments and cost (TW-SMS-027, 029).
- The campaign wizard (`wizard-run.service.ts` knows only baileys, waba, twilio) and its wallet checks.
