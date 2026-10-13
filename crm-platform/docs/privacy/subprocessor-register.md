# Sub-processor and external service register

Built from what the code actually calls (host names found in `apps/api/src`, provider adapters under `apps/api/src/infra/providers`).
It is a starting point for the owner and counsel, not a finished register. Part of
[privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 4.7.

How to read it:

- **Who contracts**: `platform` = the platform operator holds the account (we are the customer of the vendor); `tenant` = the workspace
  brings its own credentials (BYO), so the vendor is the tenant's processor and we only carry the traffic; `either` = both modes exist.
- Hosts were found by searching the code for URLs. The driver choice per workspace (which vendor is really used) is `inferred` where the
  adapter is configurable. Anything in a row marked `inferred` must be confirmed against the deployed configuration.
- Contract, DPA, region, transfer mechanism and sub-processor-of-the-vendor columns are **TODO for the owner**. We do not know them.

| Service / vendor | Host(s) found | Code | Purpose | Personal data sent | Who contracts | DPA | Region / transfer | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Meta WhatsApp Cloud API, Graph API | `graph.facebook.com` | `apps/api/src/infra/providers/whatsapp`, `apps/api/src/infra/providers/whatsapp-cloud-api-waba` | send/receive WhatsApp, templates, media, groups | phone numbers, message text, media, profile names | tenant (own WABA) or platform BSP (inferred) | TODO | TODO | webhooks inbound; call permission and calling through the same Graph host |
| Meta WhatsApp Calling | `graph.facebook.com` | `apps/api/src/infra/providers/calling-voice` | WhatsApp voice calls | numbers, call signalling, media via WebRTC | tenant | TODO | TODO | recordings are made on our side (see governance spec 2.3) |
| Facebook Messenger / Instagram | `graph.facebook.com`, `www.facebook.com` | `apps/api/src/infra/providers/channel-facebook`, `apps/api/src/infra/providers/channel-instagram` | social channels | profile ids, message text | tenant | TODO | TODO | |
| Baileys (unofficial WhatsApp Web protocol) | WhatsApp servers (via library) | `apps/api/src/infra/providers/whatsapp`, [personal-whatsapp-connect.md](../specs/personal-whatsapp-connect.md) | personal number connect | all chat content of the personal number | tenant (no contract exists with WhatsApp) | none possible | n/a | risk acknowledgement only; counsel question |
| Other WhatsApp BSPs | `amped-express.interakt.ai`, `partnersv1.pinbot.ai`, `waba-v2.360dialog.io` | `apps/api/src/modules/whatsapp-provider-registry`, `apps/api/src/modules/whatsapp-provider-admin` | alternative WABA providers | as WhatsApp | tenant | TODO | TODO | which are enabled in production is inferred |
| Telegram | Telegram Bot API (host not matched by search) | `apps/api/src/infra/providers/channel-telegram` | Telegram bot channel | chat ids, message text | tenant | TODO | TODO | host inferred |
| Twilio SMS and voice | `api.twilio.com` | `apps/api/src/infra/providers/channel-sms/twilio-sms.client.ts` | SMS | phone numbers, text | either | TODO | TODO | signature check in `twilio-signature.ts` |
| Twilio Lookup | `lookups.twilio.com` | `apps/api/src/config/domains/channel-sms.env.ts` (configuration), adapter inferred | number validation | phone numbers | platform (inferred) | TODO | TODO | |
| Twilio OTP | `api.twilio.com` | `apps/api/src/infra/providers/auth-registration-security/twilio-otp-sender.adapter.ts` | login/signup one-time codes | phone numbers | platform | TODO | TODO | |
| MSG91 | MSG91 API (host not matched by search) | `apps/api/src/infra/providers/channel-sms/msg91-sms.client.ts` | SMS (India) | phone numbers, text | either | TODO | TODO | DLT registration is the tenant's duty (counsel) |
| Gmail / Google Workspace mail | `gmail.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`, `openidconnect.googleapis.com` | `apps/api/src/infra/providers/channel-email` | mailbox channel | email content, addresses | tenant (OAuth) | TODO | TODO | OAuth tokens encrypted at rest (AES-GCM) |
| Microsoft 365 mail | `graph.microsoft.com`, `login.microsoftonline.com` | `apps/api/src/infra/providers/channel-email/graph-mail.client.ts` | mailbox channel | as above | tenant (OAuth) | TODO | TODO | |
| IMAP / SMTP servers | tenant-configured | `apps/api/src/infra/providers/channel-email/imap` | mailbox channel | as above | tenant | TODO | tenant's | |
| Google Calendar, Sheets, Forms | `www.googleapis.com`, `sheets.googleapis.com`, `forms.googleapis.com` | `apps/api/src/modules/appointments-booking`, `apps/api/src/modules/chrome-extension-sheets-addon` | calendar sync, sheets add-on | attendee names/emails, contact rows | tenant (OAuth) | TODO | TODO | |
| Google Maps | `maps.google.com`, `www.google.com` | links in code (inferred) | map links | addresses (client side link) | none | n/a | n/a | link only, confirm no API call |
| OpenAI | `api.openai.com` | `apps/api/src/infra/providers/chatbot-widget/http-ai-chat.adapter.ts`, `apps/api/src/infra/providers/flow-builder-editor/http-flow-ai.adapter.ts`, `apps/api/src/infra/providers/campaigns/http-campaign-ai.adapter.ts` | AI replies, flow and campaign AI | message text, prompts, knowledge content | either (BYO key or platform key, inferred) | TODO | TODO | training-on-prompts terms to confirm |
| Anthropic | `api.anthropic.com` | same adapters | AI | same | either | TODO | TODO | |
| Google Gemini | `generativelanguage.googleapis.com` | same adapters | AI | same | either | TODO | TODO | |
| Mistral, Groq, DeepSeek | `api.mistral.ai`, `api.groq.com`, `api.deepseek.com` | same adapters | AI | same | either | TODO | TODO | DeepSeek hosting region needs counsel review |
| OpenRouter | `openrouter.ai` | `apps/api/src/infra/providers/faq-knowledge/openrouter-faq-ai.adapter.ts` | FAQ semantic AI | question text | either | TODO | TODO | a router: it forwards to further model vendors |
| Translation | `translation.googleapis.com`, `translate.googleapis.com` | `apps/api/src/infra/providers/localization-translation/drivers.ts` | translate messages and UI | message text | either | TODO | TODO | the unofficial endpoint (`translate.googleapis.com`, inferred) has no contract; lock down |
| Training URL fetcher | any URL a tenant supplies | `apps/api/src/infra/providers/ai-agents-training/http-training-url-fetcher.adapter.ts` | fetch knowledge pages | none (outbound GET) | n/a | n/a | n/a | SSRF guard in `blocked-address.ts` |
| Growth enrichment | adapter-defined | `apps/api/src/infra/providers/growth-enrichment/growth-enrichment.adapters.ts` | third-party enrichment | company/contact data (inferred) | tenant (inferred) | TODO | TODO | needs a purpose entry `third_party_sharing` |
| Stripe | `api.stripe.com` | `apps/api/src/infra/providers/platform-payment-gateways`, `apps/api/src/infra/providers/payments` | billing and merchant payments | payer name, email, amount | either | TODO | TODO | card data stays with Stripe |
| Razorpay, PhonePe, Cashfree, Instamojo, Paddle, SSLCommerz, iyzico, PayTR, Authorize.net, 2Checkout, Skrill, Easebuzz | `api.razorpay.com`, `api.phonepe.com`, `sandbox.cashfree.com`, `www.instamojo.com`, `sandbox-api.paddle.com`, `securepay.sslcommerz.com`, `sandbox-api.iyzipay.com`, `www.paytr.com`, `test.authorize.net`, `secure.2checkout.com`, `pay.skrill.com` | `apps/api/src/infra/providers/platform-payment-gateways/india.drivers.ts` and neighbours | payments by region | payer name, email, phone, amount | either | TODO | TODO | sandbox hosts shown in code; production hosts to be listed |
| Shopify, WooCommerce | tenant store hosts | `apps/api/src/infra/providers/ecom` | store sync | customers, orders | tenant | TODO | tenant's | |
| Exchange rates | `open.er-api.com` | `apps/api/src/config/domains/coupons-credits-referral-currency.env.ts` | currency rates | none | platform | n/a | n/a | no personal data |
| Object storage | S3-compatible, example `s3.eu-west-1.wasabisys.com` | `apps/api/src/infra/providers/platform-settings-branding-storage/object-storage.probe.ts`, `apps/api/src/modules/platform-infrastructure/offsite-backup` | media, files, recordings, sealed off-site backups | everything in media and backups | platform | TODO | the Wasabi host is an example in code; actual provider and region TODO | recordings in private storage with signed playback |
| Web push services | browsers' push endpoints | `apps/api/src/infra/providers/web-push/web-push-lib.provider.ts` | notifications | subscription endpoint, no message text | user's browser vendor | n/a | n/a | |
| Mobile push (FCM/APNs) | inferred | [mobile/README.md](../mobile/README.md) | mobile notifications | device token | platform | TODO | TODO | inferred |
| Clerk (identity) | Clerk API (host not matched) | `apps/api/src/modules/auth/clerk.service.ts` | sign-in (inferred) | staff email, name | platform | TODO | TODO | inferred; confirm whether enabled |
| Error tracking / analytics | none found in `apps/api/src` | search for Sentry/analytics hosts found nothing | n/a | n/a | n/a | n/a | n/a | re-check `apps/web` before publishing a list; confirm no analytics script loads |
| Platform operator staff and hosting | n/a | [ADR-0020](../adr/0020-operator-impersonation-act-as-token.md) | support, operation | any tenant data via act-as | platform | TODO | TODO | listed so the DPA covers it |
| Outbound webhooks and API library | tenant-chosen URLs | `apps/api/src/modules/outbound-webhooks`, `apps/api/src/modules/api-library` | integration | event payloads, contact data | tenant | tenant's | tenant's | not our sub-processors, but our traffic |
| Platform webhook forwarding | operator-chosen URLs | `apps/api/src/modules/webhook-fanout` | forwards raw inbound webhooks | raw Meta bodies | platform | TODO | TODO | highest data volume per target |
| Marketplace apps | app developers | `apps/api/src/modules/marketplace` | extensions | per app scope | tenant consent | TODO | TODO | developer terms needed |

## Maintenance rule

A new external call (a new host in code, a new provider adapter) is added here in the same change; the privacy-by-design checklist
([privacy-by-design-checklist.md](privacy-by-design-checklist.md)) makes this a review item. A future test may scan for hosts that
are not listed.
