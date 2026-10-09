# Wiring map: campaigns (CAMP)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method       | Path                                                                         | Permission                                          |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| POST         | `/v2/campaigns/node/update-status`                                           | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/node/update-contact-status`                                   | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/node/update-status-by-id`                                     | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/node/track-response`                                          | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/node/unsubscribe`                                             | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/node/drain`                                                   | Node bridge token (shared secret)                   |
| POST         | `/v2/campaigns/:id/cancel`                                                   | `camp.campaigns.control`                            |
| POST         | `/v2/campaigns/:id/resume`                                                   | `camp.campaigns.control`                            |
| POST         | `/v2/campaigns/:id/send-now`                                                 | `camp.campaigns.control`                            |
| POST         | `/v2/campaigns/:id/resend`                                                   | `camp.campaigns.control`                            |
| GET          | `/v2/campaigns/:id/export`                                                   | `camp.campaigns.export`                             |
| GET          | `/v2/campaigns`                                                              | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/builder`                                                      | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/sample-csv`                                                   | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/:id/config`                                                   | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/:id`                                                          | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/:id/live`                                                     | `camp.campaigns.read`                               |
| GET          | `/v2/campaigns/:id/recipients`                                               | `camp.campaigns.read`                               |
| POST         | `/v2/campaigns`                                                              | `camp.campaigns.create`                             |
| POST         | `/v2/campaigns/ai-generate`                                                  | `camp.campaigns.create` ("Build with AI")           |
| POST         | `/v2/campaigns/bulk-delete`                                                  | `camp.campaigns.delete`                             |
| PUT          | `/v2/campaigns/:id`                                                          | `camp.campaigns.update`                             |
| GET          | `/v2/broadcast-wizard/templates`, `/audience-sources`                        | `camp.campaigns.create` (ADDITION, TW-CAMP-029/030) |
| POST         | `/v2/broadcast-wizard/audience/count`, `/credit-check`, `/variables/preview` | `camp.campaigns.create`                             |
| POST/GET/PUT | `/v2/broadcast-wizard/drafts`, `/drafts/:id`                                 | `camp.campaigns.create`                             |
| POST         | `/v2/broadcast-wizard/drafts/:id/launch`                                     | `camp.campaigns.create`                             |
| POST/GET     | `/v2/broadcast-wizard/test-send`, `/drafts/:id/test-sends`                   | `camp.campaigns.test`                               |
| GET          | `/v2/broadcast-wizard/broadcasts`, `/broadcasts/:id`                         | `camp.campaigns.read`                               |
| POST         | `/v2/broadcast-wizard/broadcasts/:id/pause`, `/resume`, `/cancel`            | `camp.campaigns.control`                            |
| PUT          | `/v2/campaigns/:id`                                                          | `camp.campaigns.update`                             |
| DELETE       | `/v2/campaigns/:id`                                                          | `camp.campaigns.delete`                             |

## Web screens

- `/campaigns/wizard`, `/campaigns/wizard/:id`, `/campaigns/wizard/broadcasts/:id` (ADDITION: the Create broadcast wizard and its status page)
- `/campaigns/:id/edit`
- `/campaigns/:id`
- `/campaigns/create`
- `/campaigns`

## Tables read or written

`camp_campaign_lookup`, `camp_receipt_lookup`, `camp_series`, `camp_retry_attempts`, `camp_test_sends`, `camp_test_receipt_lookup` (functions), `segments`, `usage_charges`, `channels`, `contact_group_members`, `contact_groups`, `contact_tags`, `contacts`, `conversation_tag`, `conversations`, `devices`, `flows`, `picked`, `r`, `tags`, `wa_link_clicks`, `wa_provider_configs`, `wa_templates`, `wp_campaign_contacts`, `wpcampaigns`

## Queues and workers

`CAMPAIGN` (runs, and the sandbox's `fixture-receipt` reports). Interval services in the campaigns worker: `WizardWorker.planTick` (recurring series planner) and `retryTick` (frequency-cap retries).

## Outbox events emitted

`campaign.series_created`, `campaign.series_status_changed`, `campaign.contact_replied`, `campaign.contact_status_updated`, `campaign.created`, `campaign.deleted`, `campaign.status_updated`, `contact.opt_in`

## Shims, owners and blocked consumers

- `PlanCampaignGate`: real cap `total_campaigns`, checked on the campaigns that exist now (the delete-proof ledger is not built); no `campaign` flag in the catalogue.
- `WalletCampaignBilling`: real. `NoFlowStarter`: a seam the flow runtime's worker module binds at start (`CampaignFlowStarterImpl`), so flow campaigns run. `PlatformCampaignSettings`: real, the platform `campaigns` settings group (`/admin/settings/campaigns`).
- Broadcast wizard (ADDITION): reads the segment rule engine through the crm barrel (`compileRules`, `loadRuleContext`, `segmentContactsWhere`), the wallet through its barrel (`WalletQueryService`, `RateCardService`, `WalletGate`), templates and senders through the broadcasts kit. Cloud API delivery reports reach campaigns and test sends through `WabaReceiptRegistry` (waba), registered by `WizardWorker` at worker start; without it a Cloud API campaign recipient would never leave `sent` and the wallet would never charge it. `CAMP_PROVIDER_MODE=fixture` swaps the Cloud API engine for a sandbox sender (`modules/campaigns/fixture`), refused in production.
