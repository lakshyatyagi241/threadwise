# Wiring map: campaigns (CAMP)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method       | Path                                                                                                                    | Permission                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST         | `/v2/campaigns/node/update-status`                                                                                      | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/node/update-contact-status`                                                                              | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/node/update-status-by-id`                                                                                | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/node/track-response`                                                                                     | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/node/unsubscribe`                                                                                        | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/node/drain`                                                                                              | Node bridge token (shared secret)                                                                          |
| POST         | `/v2/campaigns/:id/cancel`                                                                                              | `camp.campaigns.control`                                                                                   |
| POST         | `/v2/campaigns/:id/resume`                                                                                              | `camp.campaigns.control`                                                                                   |
| POST         | `/v2/campaigns/:id/send-now`                                                                                            | `camp.campaigns.control`                                                                                   |
| POST         | `/v2/campaigns/:id/resend`                                                                                              | `camp.campaigns.control`                                                                                   |
| GET          | `/v2/campaigns/:id/export`                                                                                              | `camp.campaigns.export`                                                                                    |
| GET          | `/v2/campaigns`                                                                                                         | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/builder`                                                                                                 | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/sample-csv`                                                                                              | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/:id/config`                                                                                              | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/:id`                                                                                                     | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/:id/live`                                                                                                | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/:id/statistics`                                                                                          | `camp.campaigns.read` (ADDITION: the Statistics tab; Reference's broadcast `/statistics`)                  |
| GET          | `/v2/campaigns/:id/recipients`                                                                                          | `camp.campaigns.read`                                                                                      |
| GET          | `/v2/campaigns/summary/forms`, `/v2/campaigns/:id/summary`, `/v2/campaigns/:id/summary/people`                          | `camp.campaigns.read` (ADDITION, director summary; `filled_form` also `record.form-submissions.read`)      |
| GET          | `/v2/broadcasts/:id/summary`, `/v2/broadcasts/:id/summary/people` (served by `summary/broadcast-summary.controller.ts`) | `bcast.broadcasts.read` (same)                                                                             |
| POST         | `/v2/campaigns`                                                                                                         | `camp.campaigns.create`                                                                                    |
| POST         | `/v2/campaigns/ai-generate`                                                                                             | `camp.campaigns.create` ("Build with AI")                                                                  |
| POST         | `/v2/campaigns/ai-image`                                                                                                | `camp.campaigns.create` (ADDITION, "Build with AI" picture)                                                |
| POST         | `/v2/campaigns/bulk-delete`                                                                                             | `camp.campaigns.delete`                                                                                    |
| PUT          | `/v2/campaigns/:id`                                                                                                     | `camp.campaigns.update`                                                                                    |
| GET          | `/v2/broadcast-wizard/templates`, `/audience-sources`                                                                   | `camp.campaigns.create` (ADDITION, TW-CAMP-029/030)                                                        |
| POST         | `/v2/broadcast-wizard/audience/count`, `/credit-check`, `/variables/preview`                                            | `camp.campaigns.create`                                                                                    |
| POST/GET/PUT | `/v2/broadcast-wizard/drafts`, `/drafts/:id`                                                                            | `camp.campaigns.create`                                                                                    |
| POST         | `/v2/broadcast-wizard/drafts/:id/launch`                                                                                | `camp.campaigns.create`                                                                                    |
| POST/GET     | `/v2/broadcast-wizard/test-send`, `/drafts/:id/test-sends`                                                              | `camp.campaigns.test`                                                                                      |
| GET          | `/v2/broadcast-wizard/broadcasts`, `/broadcasts/:id`                                                                    | `camp.campaigns.read`                                                                                      |
| POST         | `/v2/broadcast-wizard/broadcasts/:id/pause`, `/resume`, `/cancel`                                                       | `camp.campaigns.control`                                                                                   |
| POST         | `/v2/broadcast-wizard/broadcasts/:id/retry-failed`                                                                      | `camp.campaigns.control` (ADDITION: Retry failed on the status page; reuses the campaign resend)           |
| GET          | `/v2/broadcast-wizard/broadcasts/:id/export`                                                                            | `camp.campaigns.export` (ADDITION: Export rows on the status page; a series is one file with a Run column) |
| DELETE       | `/v2/broadcast-wizard/broadcasts/:id`                                                                                   | `camp.campaigns.delete` (ADDITION: Delete on the status page; a series only while nothing has been sent)   |
| PUT          | `/v2/campaigns/:id`                                                                                                     | `camp.campaigns.update`                                                                                    |
| DELETE       | `/v2/campaigns/:id`                                                                                                     | `camp.campaigns.delete`                                                                                    |

## Web screens

- `/campaigns/wizard`, `/campaigns/wizard/:id`, `/campaigns/wizard/broadcasts/:id` (ADDITION: the Create broadcast wizard and its status page)
- `/campaigns/:id/edit`
- `/campaigns/:id`
- `/campaigns/create`
- `/campaigns`

## Tables read or written

`camp_campaign_lookup`, `camp_receipt_lookup`, `camp_series`, `camp_retry_attempts`, `camp_follow_up_attempts`, `camp_follow_up_receipt_lookup` (function), `camp_test_sends`, `camp_test_receipt_lookup` (functions), `segments`, `usage_charges`, `channels`, `contact_group_members`, `contact_groups`, `contact_tags`, `contacts`, `conversation_tag`, `conversations`, `devices`, `flows`, `picked`, `r`, `tags`, `wa_link_clicks`, `wa_provider_configs`, `wa_templates`, `wp_campaign_contacts`, `wpcampaigns`

## Queues and workers

`CAMPAIGN` (runs, and the sandbox's `fixture-receipt` reports). Interval services in the campaigns worker: `WizardWorker.planTick` (recurring series planner), `retryTick` (frequency-cap retries) and `followUpTick` (follow-up steps, `WizardFollowUpService`).

## Outbox events emitted

`campaign.series_created`, `campaign.series_status_changed`, `campaign.contact_replied`, `campaign.contact_status_updated`, `campaign.created`, `campaign.deleted`, `campaign.status_updated`, `contact.opt_in`

## Shims, owners and blocked consumers

- `PlanCampaignGate`: real cap `total_campaigns`, checked on the campaigns that exist now (the delete-proof ledger is not built); no `campaign` flag in the catalogue.
- `WalletCampaignBilling`: real. `NoFlowStarter`: a seam the flow runtime's worker module binds at start (`CampaignFlowStarterImpl`), so flow campaigns run. `PlatformCampaignSettings`: real, the platform `campaigns` settings group (`/admin/settings/campaigns`).
- Broadcast wizard (ADDITION): reads the segment rule engine through the crm barrel (`compileRules`, `loadRuleContext`, `segmentContactsWhere`), the wallet through its barrel (`WalletQueryService`, `RateCardService`, `WalletGate`), templates and senders through the broadcasts kit. Cloud API delivery reports reach campaigns and test sends through `WabaReceiptRegistry` (waba), registered by `WizardWorker` at worker start; without it a Cloud API campaign recipient would never leave `sent` and the wallet would never charge it. `CAMP_PROVIDER_MODE=fixture` swaps the Cloud API engine for a sandbox sender (`modules/campaigns/fixture`), refused in production.

## Email campaigns (TW-CAMP-028, the email half; Reference `?channel=email`, `EmailCampaignRunner`)

A campaign sent from a connected mailbox. No new route, table, queue or migration: it rides the campaign rows, the `campaign` queue and the mailbox tables.

| Piece                 | Where                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sender key and engine | `email:<mailbox uuid>`; `wpcampaigns.provider = 'email'`, `device_id` = `mail_mailboxes.id`. `SqlSenderDirectory` (`broadcasts/_shims/sql-sender-directory.ts`) resolves it (`resolve`, `resolveForDispatch`)                                |
| Builder senders       | `GET /v2/campaigns/builder?channel=email` and `GET /v2/broadcasts/compose?channel=email` (`BroadcastsComposeService.composeEmail`; contract `broadcastComposeQuerySchema.channel`)                                                           |
| Create and edit rules | `campaigns/email-campaign-rules.ts` (`emailCampaignProblems`, `emailCleared`, `isWalletFree`), applied by `CampaignsService.forEmail`; plan feature `email_channel`                                                                          |
| The send              | `EmailEngineSender` (`channel-email/email-engine.sender.ts`, rules in `email-engine.rules.ts`), registered in `EngineSenderRegistry` by `ChannelEmailModule.onModuleInit` (API and worker)                                                   |
| The run               | `CampaignDispatchService` (recipient address, duplicate and no-address screening in `CampaignsRepository.screenRecipients(.., 'email')`, subject, no wallet, no warm-up lookup, no WhatsApp 24 h default end date, `SenderThrottled` re-arm) |
| Limits                | `MailSendGuard` (bounce list, hourly cap, burst), plan limit `email_monthly` (`MailPlan.monthlyLimit`, counted by `MailboxesRepository.sentSince`; meter in `PlanUsageService`), plan feature `email_channel`                                |
| Inbox mirror          | `EmailEngineSender.mirror` -> `ConversationsFacade.recordOutbound` (source `campaign`, `meta.email`), on the mailbox's inbox channel                                                                                                         |
| Unsubscribe           | `ConsentUnsubscribeService.linkFor` (signed link, RFC 8058 headers); `ConsentGate` channel `email`, purpose `marketing_messaging`                                                                                                            |
| Consumers read        | recipients tab, export, opt-outs and replies lists (`CampaignsRepository.REACHED_AT`: the address instead of the phone), `senderLabel` (config and detail screens)                                                                           |
| Web                   | campaign builder (`features/campaigns`: Subject, no template/flow/A-B/attachment/footer/buttons/pacing), the Campaigns chooser Email card (`features/broadcasts`), help guides, plan editor label `email_monthly`                            |
| Tables read           | `mail_mailboxes`, `messages`, `conversations`, `channels` (the monthly count and the thread), `contacts.email`                                                                                                                               |

Blocked (recorded, not silently dropped):

- `CAMP-EMAIL-B1` Delivery, read and bounce reports for a campaign mail. Gmail only says `sent`; a bounce is applied to the inbox message (`MailBounceHandler`) and flags the address so later campaigns refuse it, but the campaign recipient row stays `sent`. Reference's runner had no receipts either.
- `CAMP-EMAIL-B2` Replies and clicks counters for an email campaign (`campaign.contact_replied`, link tracking). Reference's mail runner had neither; the reply lands in the inbox thread of the mail.
- `CAMP-EMAIL-B3` A mailbox that needs reconnecting mid-run fails each remaining recipient with the reason (resend failed after reconnecting) instead of pausing the campaign.
- `CAMP-EMAIL-B4` Campaign mail with attachments or rich HTML (Reference's mail runner sends the escaped text only).
- Follow-up steps (ADDITION, from the meeting's "Add a follow-up"; Reference has none): `followUps` on the wizard draft, `wpcampaigns.follow_up_count`, `wp_campaign_contacts.follow_up_*`, log `camp_follow_up_attempts`. Cloud API numbers only. A flow step uses the same `CampaignFlowStarter` seam as a flow campaign. Reply detection reads the inbox (`messages` direction `in` of the contact's conversations).
- Build with AI (TW-CAMP-002, TW-CAMP-038): text through `CAMPAIGN_AI_PORT`, the picture through `CAMPAIGN_AI_IMAGE_PORT` (`infra/providers/campaigns`, OpenAI only), both with `AiKeyResolver` / `AiTokenMeter`; the picture is stored by `MarketingMediaService` (broadcasts barrel). The guided wizard has its own entry: a template draft (`POST /v2/templates/ai-generate`) handed to the template form, because the wizard sends approved templates, not free text.

## Quiet hours and calling windows (BL-177, product extension)

Not in Reference. `CampaignDispatchService.loop` asks `SendWindowService` per claimed slice for a marketing campaign (a utility-template-only campaign is never asked). A held recipient goes back to `queued` with `wp_campaign_contacts.held_until`; `CampaignsRepository.claim` skips it until then; `finish` schedules the campaign again for the minute of the first opening (stop `quiet`). The ConsentGate screens the audience again at every run start. `WizardFollowUpService` defers a marketing follow-up step (`follow_up_check_at` moves to the opening). Read side: `held` (live), `heldUntil` / `heldReason` (recipients), the live hint `campaigns.detail.live.held`. A recurring campaign carries its held recipients to its next occurrence (BL-189).
