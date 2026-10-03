# Wiring map: campaigns (CAMP)

Generated from the controllers, repositories and web routes on branch `punya/punyafix`; the shim notes are hand-written. Update it in the same change as any new route, table, queue or consumer.

## API routes

| Method | Path                                       | Permission                        |
| ------ | ------------------------------------------ | --------------------------------- |
| POST   | `/v2/campaigns/node/update-status`         | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/node/update-contact-status` | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/node/update-status-by-id`   | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/node/track-response`        | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/node/unsubscribe`           | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/node/drain`                 | Node bridge token (shared secret) |
| POST   | `/v2/campaigns/:id/cancel`                 | `camp.campaigns.control`          |
| POST   | `/v2/campaigns/:id/resume`                 | `camp.campaigns.control`          |
| POST   | `/v2/campaigns/:id/send-now`               | `camp.campaigns.control`          |
| POST   | `/v2/campaigns/:id/resend`                 | `camp.campaigns.control`          |
| GET    | `/v2/campaigns/:id/export`                 | `camp.campaigns.export`           |
| GET    | `/v2/campaigns`                            | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/builder`                    | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/sample-csv`                 | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/:id/config`                 | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/:id`                        | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/:id/live`                   | `camp.campaigns.read`             |
| GET    | `/v2/campaigns/:id/recipients`             | `camp.campaigns.read`             |
| POST   | `/v2/campaigns`                            | `camp.campaigns.create`           |
| POST   | `/v2/campaigns/bulk-delete`                | `camp.campaigns.delete`           |
| PUT    | `/v2/campaigns/:id`                        | `camp.campaigns.update`           |
| DELETE | `/v2/campaigns/:id`                        | `camp.campaigns.delete`           |

## Web screens

- `/campaigns/:id/edit`
- `/campaigns/:id`
- `/campaigns/create`
- `/campaigns`

## Tables read or written

`camp_campaign_lookup`, `camp_receipt_lookup`, `channels`, `contact_group_members`, `contact_groups`, `contact_tags`, `contacts`, `conversation_tag`, `conversations`, `devices`, `flows`, `picked`, `r`, `tags`, `wa_link_clicks`, `wa_provider_configs`, `wa_templates`, `wp_campaign_contacts`, `wpcampaigns`

## Queues and workers

`CAMPAIGN`

## Outbox events emitted

`campaign.contact_replied`, `campaign.contact_status_updated`, `campaign.created`, `campaign.deleted`, `campaign.status_updated`, `contact.opt_in`

## Shims, owners and blocked consumers

- `PlanCampaignGate`: real cap `total_campaigns`, checked on the campaigns that exist now (the delete-proof ledger is not built); no `campaign` flag in the catalogue.
- `WalletCampaignBilling`: real. `NoFlowStarter`: flow campaigns fail per recipient (blocked on the flow runtime). `PlatformCampaignSettings`: real, the platform `campaigns` settings group (`/admin/settings/campaigns`).
