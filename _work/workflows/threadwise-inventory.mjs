export const meta = {
  name: 'threadwise-inventory',
  description: 'Exhaustive per-domain Reference feature inventory: one writer plus two independent completeness/accuracy critics per domain (62 domains)',
  phases: [
    { title: 'Write', detail: 'one agent per domain writes docs/threadwise-port/inventory/<id>.md from source' },
    { title: 'Critic A', detail: 'backend, data model, async, integrations completeness + enrichment' },
    { title: 'Critic B', detail: 'UX, docs-vs-code, i18n/emails, accuracy spot-check of claims' },
  ],
}

const W = (typeof args !== 'undefined' && args && args.root) ? args.root : '/home/getaweblpubt24/Documents/threadwise-port'  // pass args.root = absolute path of your clone
const REF = W + '/reference/app'
const DOCS = W + '/reference/Documentation'
const MAN = W + '/_work/manifests'
const INV = W + '/crm-platform/docs/threadwise-port/inventory'
const SPEC = W + '/crm-platform/docs/threadwise-port/inventory-spec.md'
const TOOLS = W + '/_work/tools'
const REPORTS = W + '/_work/reports'

// [id, CODE, title, starting-point hints (not exhaustive)]
const DOMAINS = [
['install-update-licensing','INST','Web installer, updater, licensing','ctrl: InstallController (16 routes), Admin/UpdateController, UpdateController. svc: UpdaterService, Support/Licence, Support/EnvWriter. mw: EnsureInstalled. views: install/* (10), admin/update. Also: Database/1.1.sql (base schema, at reference/Database), Update/update_1.2..1.7.zip at reference/Update (unzip -l to derive per-version deltas), config/version.php. docs: installation/*, update-details/*, faqs/installation, faqs/errors-solutions, faqs/demo-limitations (demo-mode restrictions).'],
['auth-registration-security','AUTH','Auth, registration, 2FA, account settings, security policy','ctrl: AuthController, AuthPagesController, EmailVerificationController, SocialAuthController, AccountController (profile, branding, danger zone; invoices tab shared with PLAN), Admin/SecurityController. svc: Services/Auth, SocialAuthService, RecaptchaService, Support/{TwoFactorService,PasswordPolicy,SecureUpload,SecurityPolicy,SecurityAuditLogger,security_helpers,html_sanitize}. mw: Force2FA, LimitConcurrentSessions, SessionTimeout, UseFileSession, NoStoreResponse, EnsureUserActive. views: auth/*, admin/security, user/account/*. uri: login, register, forgot/reset password, verify email, 2fa, logout. docs: security/authentication, security/data-privacy, account/account-billing, admin-panel/auth-pages, admin-panel/security.'],
['workspaces-teams-tenancy','WSP','Workspaces, members, tenancy, impersonation, admin user management','ctrl: WorkspacesController, WorkspaceMembersController, Admin/WorkspacesController, Admin/ImpersonationController, Admin/UsersController, UsersController. svc: WorkspaceProvisioner, WorkspaceEngine, Support/AdminWorkspaceProvisioner. mw: ResolveTenantDomain (custom domains), ImpersonationBanner. console: WipeExpiredWorkspaces. models: Workspace* (6), Team*, User*. views: workspaces, admin/workspaces, admin/users. route closure {wsSlug}. docs: getting-started/workspaces, account/team-members, admin-panel/workspaces, admin-panel/user-management.'],
['roles-permissions','RBAC','Roles, permissions, workspace role enforcement','ctrl: RoleController, PermissionController. svc/support: Support/PlatformPermissions, Support/WorkspacePermissions, app/Policies/*, EnsureWorkspaceRole middleware and any permission middleware. seeder: database/seeders/RolePermissionSeeder.php (101 permissions, 6 roles). views: admin/roles, admin/permissions. docs: admin-panel/roles-permissions. Produce the full permission catalogue as features: key, meaning, default roles, every place it is enforced.'],
['notifications-activity-audit','NOTIF','Notifications, activity log, audit log, push, mail templates','ctrl: NotificationsController, Admin/AdminNotificationController, ActivityLogController, Admin/AuditLogController. svc: Support/Audit, Services/Push/* (4), app/Mail/*. console: AuditLogPruneCommand. views: user/notifications, user/activity-log, admin/audit-log, admin/notifications, emails/*, mail. docs: account/notifications, account/activity-log.'],
['dashboards-analytics-charts','DASH','User + admin dashboards, analytics, chart widgets, financial and health views','views: user/dashboard, user/analytics, admin/dashboard, admin/analytics, admin/financial, admin/health. resources/js/charts/* (161 files: group by chart family, inventory every widget with its metric definition, filters, date ranges, caching). ctrl: Admin/OverviewController, Admin/FinancialController, Admin/HealthController, plus the parts of UserPagesController/AdminPagesController serving dashboard/analytics data. docs: growth/analytics, admin-panel/dashboard, admin-panel/system-health, getting-started/dashboard.'],
['admin-console-shell','ASHELL','Admin console + user app shell, navigation, quick access, tour','ctrl: AdminPagesController (84 routes: claim only those not clearly owned by another domain and list in Open questions which ones you left to others), UserPagesController (12), SettingsTabsController (13), QuickAccessController. svc: Support/UserNav, Support/QuickAccess. views: layouts/*, components/layouts, components/admin, components/user, partials, resources/js/admin-sidebar.js, resources/js/tour, tour/seen route. Describe sidebar/topbar/workspace switcher/theme/mobile behavior, per-role and per-plan menu visibility. docs: getting-started/dashboard, admin-panel/dashboard.'],
['platform-settings-branding-storage','SET','Platform system settings, branding, storage, realtime, mail, SEO','ctrl: Admin/SiteSettingsController, Admin/AppearanceController, Admin/StorageSettingsController, Admin/RealtimeSettingsController, PremiumController. svc: CloudStorageManager, Support/{Brand,FormatSettings,MailConfig,Seo,RealtimeSettings,LocaleSettings}, BrandingFooterService. models: SystemSetting. views: admin/settings/* (26), admin/site-settings, admin/storage, admin/realtime, admin/premium. docs: admin-panel/system-settings, appearance, cloud-storage, auth-pages. Catalogue EVERY system setting key: name, type, default, validation, where consumed.'],
['marketing-site-cms','CMS','Public marketing site, page editor, blog, legal, FAQs, guidebook, announcements','ctrl: FrontendController, Admin/FrontendEditorController, Admin/BlogController, Admin/LegalPagesController, Admin/PricingFaqController, Admin/GuidebookController, Admin/ContactMessagesController, Admin/AnnouncementsController, SitemapController, ContentController, PricingController (public page side; billing side is PLAN). svc: Services/Frontend/*. seeders: LegalPagesSeeder, GuidebookArticleSeeder. views: frontend/*, components/frontend/* (24), pricing, legal, public, user/guidebook, admin/{blog,guidebook,legal-pages,pricing-faqs,announcements,contact-messages}. docs: admin-panel/frontend-editor, blog, announcements, support-guidebook.'],
['localization-translation','I18N','Localization, 20 languages, auto-translation providers','lang/*.json (20 languages: document key structure, fallback chain, RTL), Translator, LanguageDetector, KeywordTranslationManager, CommonPhrasesDictionary, Services/Translation/* (7), Admin/LanguagesController, Admin/TranslationProviderController, Admin/TranslationUsageController, LocaleController, SetLocale middleware, Support/LocaleSettings, TranslationProviderSeeder, console BackfillKeywordTranslations, resources/js/locale-switcher.js, models Translation*, views admin/languages admin/translation-*. docs: admin-panel/localization, admin-panel/translation.'],
['addons-extension-registry','ADD','Addon/module system and extension registry','ctrl: Admin/AddonsController, Admin/ExtensionController. svc: ExtensionRegistry, ExtensionService, ModuleLoader. models: Extension* (2). views: admin/addons, admin/extensions. docs: admin-panel/addons, admin-panel/extensions. Describe manifest format, install/enable/disable lifecycle, license checks, hook points, how modules add routes/menus/permissions.'],
['plans-subscriptions-trials','PLAN','Plans/packages, subscriptions, trials, limits and feature gating','ctrl: BillingController, PricingController (billing side), the admin packages controller (find via routes admin/packages*), AccountController billing/invoice-download bits. svc: PlanLimitGuard, PlanUsage. mw: EnsureTrialActive, EnforcePlanFeature (catalogue every feature key). models: Package*, Subscription*. views: admin/packages, pricing, billing pages. migrations named *_plan_columns_to_packages (every channel adds plan columns: catalogue every plan limit/feature flag). docs: getting-started/plans-trial, admin-panel/plans-packages, admin-panel/billing-finance, security/plan-enforcement.'],
['coupons-credits-referral-currency','CPN','Coupons, credit packages, referral/affiliate, currencies','ctrl: Admin/CouponController, Admin/AdminCreditPackagesController, Admin/CurrencyController, AffiliateHistoryController. svc: ReferralService, Support/MoneyFormat. seeder: CurrencySeeder. views: admin/coupons, admin/credit-packages, admin/currencies, user/affiliate-history. docs: admin-panel/coupons-credits.'],
['platform-payment-gateways','PAYGW','Platform payment gateways (charging workspaces), order and billing history','svc: Services/Payment/* (38 files: catalogue every gateway: capabilities, config keys, webhook/return handling, refunds, supported currencies, test mode). ctrl: Admin/PaymentGatewayController, Admin/OrderHistoryController, Admin/BillingHistoryController, PaymentsController (read it and decide ownership vs SALES). seeder: PaymentGatewaySeeder. views: payment, admin/payment-gateways, admin/order-history, admin/billing-history. docs: admin-panel/payment-gateways, billing-finance. Scope: gateways that charge WORKSPACES (subscription, wallet top-up). Gateways where a workspace charges ITS customers belong to CHK.'],
['wallet-message-billing','WALLET','Wallet, per-message billing, credit rates, overflow billing, low-balance alerts','svc: WalletService, MessageBillingService, MessageCreditRate, OverflowBilling, Support/WalletAlerts. models: Wallet*, message credit models. Per-message billing rules, rates per country/category, overflow, alerts, ledger. Find user wallet pages via routes (uri wallet). docs: bsp-billing/billing-engine, admin-panel/coupons-credits.'],
['bsp-billing-engine','BSP','BSP reseller billing engine','dir: app/Bsp/{Http,Models,Services} (8 files), routes/bsp.php, views/bsp, the admin/bsp/rate-cards closure. docs: bsp-billing/* (overview, meta-setup, billing-engine, customer-flow, admin-pages, api-reference). Business-Solution-Provider model: platform resells Meta conversations and bills workspaces.'],
['whatsapp-devices-baileys','WADEV','WhatsApp device/session management (QR/Baileys engine), multi-engine, proxy isolation','ctrl: DevicesController (44 routes), DeviceController (12), WaConnectController (12). models: Device*/Wa* device models. views: user/devices (11), user/connect (5), admin/devices (2). svc: WhatsAppDispatcher, Services/Whatsapp/*, WorkspaceEngine. seeder: DeviceSeeder. QR pairing, session persistence, proxy per device, health/reconnect, per-device settings, engine selection. docs: channels/whatsapp, getting-started/connect-channel, multi-engine, proxy-isolation, channel-settings, faqs/whatsapp-bans.'],
['whatsapp-cloud-api-waba','WABA','WhatsApp Cloud API / WABA: embedded signup, numbers, webhooks, coexistence','ctrl: WaConnectWabaController, WaWebhookController, WaInboundController, WaCustomerProfileController. svc: Services/Waba/* (14), WabaHealthService, MetaGraphClient. console: SyncWabaTemplateClicks. models: Waba*, Wa* WABA-related. Embedded signup, phone number registration, quality rating and limits, coexistence, webhook verification and event handling, media download, business profile. docs: getting-started/coexistence, channels/whatsapp, bsp-billing/meta-setup (shared with BSP).'],
['node-bridge-runtime','NODE','Node bridge runtime and Laravel<->Node internal contract','dir: node/* (index.js, server.cjs, app.cjs, routes/, controllers/, services/, classes/BaileysClientManager.js, utils/, test/). Every internal endpoint, auth (NODE_WEBHOOK_TOKEN), how Laravel calls Node (NodeSchedulerClient, NodeCacheBuster, WdSyncController) and how Node calls back (internal api/* routes in routes/api.php that are not Api/V1 or Api/App or channel webhooks, e.g. api/flow/store-media, api/campaigns/sync, api/templates-camp, api/workspace-attributes). Baileys session lifecycle, send safety (utils/sendSafety), scheduling loops. docs: developer-guide/node-bridge, engines, architecture.'],
['chat-conversations','CHAT','1:1 chat UI, message history, quick messages','ctrl: ChatController (45 routes), MessageHistoryController. svc: UnifiedMessageStream. models: Message*, Conversation* (4). views: user/chat, user/message-history. resources/js: wa-editor.js, wa-toaster.js. docs: messaging/chat, message-history. Send text/media/templates/interactive, reply/react/forward/delete, search, media handling, realtime.'],
['team-inbox-conversations','TIB1','Team inbox: conversations, assignment, composer, labels, notes, PWA','ctrl: TeamInboxController (about 105 routes under team-inbox; partition with TIB2), TeamInboxPwaController. svc: Services/Inbox/* (15; partition with TIB2), InboxDispatcher. views: user/team-inbox. docs: messaging/team-inbox. YOU OWN: conversation list/filters/views, opening a conversation, reply composer, assignment, labels/tags, internal notes, canned replies, close/reopen/merge, bulk actions, PWA, realtime updates. TIB2 owns routing rules, SLA, snooze/escalation, business hours, auto-assign, reporting. State the handoffs explicitly.'],
['team-inbox-routing-sla','TIB2','Team inbox: routing rules, SLA, snooze/escalation, auto-assign, reports','svc: Services/Inbox/* routing/assignment/SLA parts, Support/SlaCalculator. models: Routing*, Sla*, Inbox* config models. console: InboxEscalateCommand, InboxWakeSnoozedCommand. Routes inside TeamInboxController that configure routing, SLA, business hours, escalation, snooze, reports/analytics. Partition with TIB1 (which owns conversation UI): list which routes you took.'],
['team-chat','TCHAT','Internal team chat','ctrl: TeamChatController (19). models: TeamChat*/Team* chat models. views under user (find via routes team-chat*). docs: messaging/team-chat.'],
['platform-support-desk','SUPP','SaaS operator helpdesk + customer ticket form','ctrl: Admin/Support/{Agents,Customers,Inbox,Playbooks,Reports,Sla,TeamInbox}Controller, Admin/AdminTeamInboxController, SupportTicketController. models: Support* (3). views: admin/support (8), admin/team-inbox, user/support. docs: admin-panel/platform-inbox, admin-panel/support-guidebook (helpdesk part).'],
['broadcasts','BCAST','WhatsApp broadcasts','ctrl: BroadcastsController (11). svc: BroadcastSweeper. models: Broadcast* (2), Wa broadcast models. views: user/broadcasts (4). node: services/broadcastService.js, controllers/broadcastController.js. seeder: BroadcastSeeder. docs: messaging/broadcasts. Channel-specific broadcasts (Telegram/Line/Viber/WeChat/Facebook) belong to those channel domains; Api/V1 broadcast endpoints belong to API.'],
['campaigns','CAMP','WhatsApp campaigns (wa-campaigns)','ctrl: WaCampaignsController (22), CampaignController (13). svc: CampaignScheduleSweeper. models: WaCampaign*, Campaign*. views: user/campaigns (6), user/wa-campaigns (5). node: campaignService.js, campaignController.js, utils/campaignHelpers.js. seeders: WaCampaignSeeder. docs: messaging/campaigns.'],
['scheduled-queue-warmer','SCHED','Scheduled messages, send queue, number warmer, send safety','ctrl: ScheduledController (18), QueueController (14), WarmerController. svc: ScheduledMessageSweeper, RetryPolicy, WarmerService, Support/SendGate. models: Scheduled* (2), queue models. node: scheduleService.js, scheduleController.js, utils/sendSafety.js. views: user/scheduled (4), user/warmer. docs: messaging/scheduled, messaging/warmer.'],
['message-templates','TPL','Message templates (WABA + local), variables, overrides','ctrl: TemplatesController (23), TemplateController (14). svc: TemplateOverrideResolver. models: WaTemplate*, template models. resources/js: template-vars.js, template-var-map.js. console: SyncWabaTemplateClicks (shared with WABA). seeder: WaTemplateSeeder. views: user/templates (5). docs: automation/templates.'],
['auto-reply-keywords','AR','Auto-reply and keyword rules','ctrl: AutoReplyController (17). models: Keyword* (3), AutoReply*. svc: KeywordTranslationManager (shared with I18N). views: user/auto-reply (5). docs: messaging/auto-reply. Api/V1 and Api/App counterparts belong to API and MOB.'],
['flow-builder-editor','FLB','Flow/chatbot builder: editor, node catalogue, templates','ctrl: FlowsController (41), FlowNodeActionsController (24), FlowTemplateController, Admin/FlowTemplateController, FlowsCommerceController, GoogleFlowNodeController. svc: Services/Flow/*, Services/Flows/*. models: Flow* (5). views: user/flows (5), admin/flow-templates. resources/js builder assets. docs: automation/flows. YOU OWN the editor and the catalogue of EVERY node type (config schema, validation, inputs/outputs/handles, per-channel availability). Execution semantics belong to FLR.'],
['flow-runtime-engine','FLR','Flow execution engine: triggers, runtime semantics, sandbox, retries, analytics','svc: Services/Flow/* runtime parts, node/services/flowService.js, codeSandbox.js, codeSandboxWorker.js, callFlowRuntime.js, node/test/flow-*.mjs, node/*FlowService.js per channel. models: flow subscriber/enrollment/retry-log models; migrations such as create_flow_retry_logs_table and fix_flow_subscribers_enrolled_at. Triggers (keyword, webhook, schedule, API), execution order, conditions, variable interpolation, wait/delay, retries, sandbox limits, statistics, concurrency and idempotency.'],
['chatbot-widget','WGT','Website chatbot widget','ctrl: ChatbotWidgetController, ChatbotWidgetPublicController. models: Chatbot* (2). views: user/chatbot-widgets (2), embed script. docs: automation/chatbot-widget.'],
['forms-links-groups','WFL','WhatsApp forms, chat links, group management','ctrl: WaFormController (10), WaChatLinkController, LinkRedirectController, WaGroupController, GroupController (11), WabaGroupsController (8). models: WaForm*, WaLink*, WaGroup*, Waba group models. views: user/wa-forms, user/wa-links, user/waba-groups. docs: automation/wa-forms, automation/wa-links.'],
['calling-voice','CALL','WhatsApp calling, call logs, recordings, AI call assistant','ctrl: WaCallingController (12), WaCallingWebhookController, CallLogsController, CallRecordingController, AiCallAssistantController. svc: Services/Calling/*, Services/WaCalling/*, Services/Voice/* (11). node: wabaCallBridge, callFlowRuntime. resources/js/calling. views: user/call-logs, ai-call-assistant. docs: ai/wa-calling, call-logs, ai-call-assistant.'],
['ai-agents-training','AIAG','AI agents, knowledge training, AI chat','ctrl: AiTrainingController (12), AiHelpersController, AI assistants routes (uri ai-assistants). svc: AiAgentService, Services/AiChat/*. models: Ai* (9). views: user/ai-training, user/ai-assistants. migration add_knowledge_assistant_to_ai_agents. docs: ai/ai-training. Agent personas, knowledge base ingestion (files/urls/text), retrieval, human handoff, per-plan limits.'],
['ai-keys-usage-admin','AIADM','AI provider keys, token metering, AI admin dashboard','ctrl: Admin/AiDashboardController, Admin/AdminAiKeyController, AiUsageController. svc: AiKeyResolver, AiTokenMeter. seeder: AdminAiKeySeeder. views: admin/ai-dashboard, user/ai-usage. docs: admin-panel/ai-dashboard, admin-panel/ai-keys.'],
['ai-copilot-lead-finder','AICRM','AI CRM copilot and lead finder','ctrl: AiCrmController, LeadFinderController (9). svc: Services/AiCrm/* (3), Services/LeadFinder/*. models: AiCrmAction, lead models. migrations: create_ai_crm_actions_table, add_wa_copilot_enabled_to_workspaces, add_lead_finder_to_packages. views: user/ai-crm, user/lead-finder. docs: ai/ai-crm-copilot.'],
['contacts-attributes-tags','CON','Contacts, groups, attributes, tags, import/export','ctrl: ContactsController (20), ContactController, ContactGroupController (12), AttributesController. svc: AttributeResolver, SendAttributes. models: Contact* (4), Tag, attribute models. resources/js/attribute-picker.js. seeder ContactSeeder. views: user/contacts, user/attributes. docs: growth/contacts, growth/attributes. Include import/export, dedup, merge, custom attributes, tags, groups, bulk ops, opt-in/out. Api/V1 counterparts belong to API.'],
['deals-pipelines','DEAL','Deals and pipelines','ctrl: DealsController (14). svc: Services/Deals/*. models: Deal* (2), Pipeline* (2). console: DealsRemindTasksCommand, SeedDemoDeals. views: user/deals. docs: growth/deals.'],
['companies-projects-tasks','CTP','Companies, projects, tasks, CRM briefs','ctrl: CompaniesController, ProjectsController, TasksController, CrmController, BriefsController. svc: Services/Crm/*. models: Company, Task, Project, CrmBrief. console: CrmRemindTasksCommand. views: user/companies, user/projects, user/tasks, user/crm. migrations 2026_08_22_*. docs: commerce/projects.'],
['sales-docs-proposals','SALES','Sales documents: estimates/proposals, payments records','ctrl: SalesDocsController (15), estimates routes. PaymentsController (decide ownership vs PAYGW by reading). models: Sales*, Payment*. views: user/salesdocs, user/payments. PDF generation (dompdf). docs: commerce/proposals-estimates, commerce/payment-links (shared with CHK).'],
['invoicing','INV','Auto-invoicing and invoice settings','ctrl: InvoicesController (15), InvoiceController, InvoiceSettingsController, Admin/InvoicesController (determine whether platform or workspace invoices). svc: Services/Invoice/* (9). models: Invoice* (6). migrations: create_invoices_* , add_tax_to_wa_orders, add_auto_invoice_plan_columns, expand_invoice_settings. views: user/invoices, user/invoice, invoices, admin/invoices. docs: commerce/auto-invoicing. Numbering sequences, tax summary, webhook events, PDFs.'],
['appointments-booking','APPT','Appointments, booking types, availability, calendar sync, reminders, booking payments','ctrl: AppointmentController, BookingTypeController, BookingApiController, BookingManageController, BookingPaymentController, CalendarController, GoogleCalendarOAuthController. svc: Services/Appointments/*, Services/GoogleCalendar/*. models: Booking* (8), Slot*, Appointment*. node test booking-smoke.mjs. views: user/appointments (6). migrations 2026_08_20_0108* booking_*. docs: commerce/appointments.'],
['catalog-products','CAT','WhatsApp commerce catalog and products','ctrl: CatalogController (16), WaProductController (9). svc: Services/WhatsAppCatalog/* (8). console: CatalogResyncCommand. views: user/catalog (8). docs: commerce/catalog.'],
['storefront-builder','STORE','Storefront and store builder (public shop)','ctrl: StoreController, WaStorefrontController, StorefrontPublicController, WaStoreWizardController. svc: Services/Storefront/*, StorefrontOrderParser. views: user/store (17), storefront (23). docs: commerce/storefront.'],
['checkout-orders-merchant-payments','CHK','Checkout, orders, merchant gateways, WhatsApp Pay, payment links, coupons, reviews','ctrl: CheckoutController (12), CheckoutPagesController, CustomerCheckoutReturnController, CustomerPaymentWebhookController, StorefrontPaymentController, WhatsAppPayController, WaOrderController, WaReviewController, WaCouponController, MerchantGatewaysController, Admin/CheckoutSettingsController. svc: Services/Checkout/*, Services/Commerce/*, Services/Ordering/*, merchant-side parts of Services/Payment/*. seeder CheckoutDefaultsSeeder. views: checkout (10). docs: commerce/checkout-gateways, payment-links, whatsapp-pay.'],
['shopify-woocommerce','ECOM','Shopify and WooCommerce integrations','ctrl: ShopifyController, WoocommerceController. svc: Services/Shopify/*, Services/Woocommerce/*, Support/Woo/*. resources/stubs/threadwise-woocommerce.php.stub (the WordPress plugin stub). models: Shopify* (6), Woocommerce* (6), Wp* (2). views: user/shopify, user/woocommerce. docs: integrations/ecommerce, integrations/woocommerce, commerce/shopify.'],
['channel-facebook','FB','Facebook Messenger channel + social posting','ctrl: Facebook/* (7), FacebookConnectController, SocialPostsController. svc: Services/Facebook/* (6), Services/Social/*. models: Facebook* (4). routes/facebook.php. views: user/facebook (6), components/facebook, user/social. docs: channels/facebook, growth/facebook-app-setup (shared with MADS).'],
['channel-instagram','IG','Instagram channel and Instagram engine (Instaflow)','svc: Services/Instaflow/* (3). ctrl: Api/InstaflowInboundController plus any instagram routes/controllers (grep instagram). node: instagramFlowController/Service. docs: channels/instagram, admin-panel/instagram-engine. Cross-check what is shared with FB and say so.'],
['channel-telegram','TG','Telegram channel','ctrl: Telegram/* (5), TelegramAccountController (9). svc: Services/Telegram/* (5). models: Telegram* (5). node: telegramAccountService, telegramBotFatherService, telegramFlow*. routes/telegram.php. views: user/telegram. docs: channels/telegram.'],
['channel-tiktok','TT','TikTok channel + TikTok Shop','ctrl: Tiktok/* (7). svc: Services/Tiktok/* (7). models: Tiktok* (3). node: tiktokFlow*. routes/tiktok.php. views: user/tiktok (5). docs: channels/tiktok.'],
['channel-line','LINE','LINE channel incl. rich menus','ctrl: Line/* (6). svc: Services/Line/* (3). models: Line* (5). routes/line.php. node: lineFlow*. views: user/line (6). migrations create_line_*. docs: channels/line.'],
['channel-wechat','WECH','WeChat channel incl. menus','ctrl: WeChat/* (6). svc: Services/WeChat/* (4). models: We* (4). routes/wechat.php. node: wechatFlow*. views: user/wechat (5). docs: channels/wechat.'],
['channel-viber','VIB','Viber channel','ctrl: Viber/* (5). svc: Services/Viber/* (3). models: Viber* (4). routes/viber.php. node: viberFlow*. views: user/viber (4). docs: channels/viber.'],
['channel-sms','SMS','SMS channel','ctrl: Sms/* (3), TwilioStatusController. svc: Services/Sms/* (9). routes/sms.php. views: user/sms. SmsShowcaseSeeder. docs: channels/sms.'],
['channel-email','MAIL','Email channel (Mailtrixy) and workspace email accounts','ctrl: Mailtrixy/EmailFlowNodeController, Api/MailtrixyInboundController. svc: Services/Mailtrixy/* (5). routes/mailtrixy-email.php. tables workspace_email_accounts and related. node: emailFlowController/Service. docs: channels/email.'],
['meta-ads','MADS','Meta (Facebook/Instagram) ads and click-to-WhatsApp campaigns','ctrl: MetaAdsController (22), Admin/MetaAdsKeysController. models: MetaCampaign*. seeder MetaCampaignSeeder. views: user/meta-ads (4), admin/meta-ads. docs: growth/meta-ads, growth/facebook-app-setup (shared with FB).'],
['integrations-hubspot-slack-trello-google-webhooks','INTG','Hubspot, Slack, Trello, Google account, incoming + outgoing webhooks','ctrl: HubspotController, SlackController, SlackWebhookController, TrelloController, TrelloWebhookController, GoogleAccountController, IncomingWebhookController (10; lead capture, template send), WebhooksController (10). svc: Services/Hubspot/*, Services/Google/*, Services/Integrations/*, WebhookService. models: Hubspot*, Slack*, Trello*, Webhook*, IncomingWebhook*. views: user/{hubspot,slack,trello,webhooks,google-account,integrations}. docs: integrations/google, slack, trello, webhooks.'],
['developer-rest-api-v1','API','Public REST API v1, API keys, developer docs','ctrl: Api/V1/* (16 controllers), routes/api_v1.php, DeveloperApiController, admin api-keys (views admin/api-keys), Http/Requests/Api, Http/Resources/Api. Scramble/OpenAPI docs (docs/api.json closure), user developers view. Auth, scopes, rate limits, pagination, error shapes, per-resource contract. Business behavior lives in owner domains: reference them. docs: developer-guide/rest-api, developer-guide/api-endpoints.'],
['mobile-app-api','MOB','Mobile app backend API (Api/App/*)','ctrl: Api/App/* (23 controllers incl. Concerns), api/app/* routes in routes/api.php (broadcasting/auth, paypal/paystack callbacks closures), device tokens, mobile payments, wallet, profile, 2FA, inbox, chat, campaigns, autoreply, templates, groups, ai agent. Auth scheme, sender scoping, payload formats. Business behavior lives in owner domains: reference them.'],
['chrome-extension-sheets-addon','EXT','Chrome extension and Google Sheets add-on','dirs: app/extension/* (manifest.json, background.js, content.js, popup.html/js, assets), app/google-sheets-addon/* (Code.gs, Dialog/Help/Settings html, README, appsscript.json). ctrl: ExtensionApiController (10), Api/ExtensionApiController, Api/SheetsAddonController. models Extension* if user-facing. docs: integrations/extension, integrations/google.'],
['platform-infrastructure','CORE','Cross-cutting infrastructure: middleware, providers, config, env, health, queues, dependencies','All middleware in app/Http/Middleware not claimed by another domain (document each one: purpose, order, effect), app/Providers, app/Exceptions, app/Helpers, app/Support helpers not claimed elsewhere, ALL config/*.php (catalogue env keys with defaults), .env.example, routes/{channels,console}.php, composer.json and package.json dependencies (why each exists), storage layout, queue/cache/session/logging setup, rate limiting, error views, health endpoints (up, csrf-token, */_health), storage/{path} closure, Support/FatalTrace, scheduling (sweepers, node scheduler), file upload security. docs: developer-guide/architecture, customization, database-schema, third-party-integrations, installation/server-requirements, faqs/*.'],
]

// ---- resume controls (pass as Workflow args) ----
// args.only      : array of domain ids to process (default all)
// args.skipWrite : array of domain ids whose writer already finished (file on disk), run critics only
// args.critics   : subset of ['A','B'] to run (default both); use ['A'] to halve critic cost
const RUN = (typeof args !== 'undefined' && args) ? args : {}
const ONLY = RUN.only ? new Set(RUN.only) : null
const SKIP_WRITE = new Set(RUN.skipWrite || [])
const CRITICS = RUN.critics || ['A', 'B']
const TARGET = ONLY ? DOMAINS.filter(function (d) { return ONLY.has(d[0]) }) : DOMAINS

const CODES = DOMAINS.map(function (d) { return d[1] + '=' + d[0] }).join(', ')

const COMMON = [
'CONTEXT',
'We are porting Reference (a purchased CodeCanyon SaaS: a Laravel 12 app plus a Node/Baileys bridge, v1.7.0, WhatsApp-first omnichannel CRM) onto a new stack (NestJS, Postgres with row-level security, Drizzle, BullMQ, Next.js). Reference is REFERENCE ONLY: we rebuild behavior, we never copy code, assets or copy-deck. Your job is to produce the definitive behavioral inventory of ONE domain so that a developer who never opens Reference can rebuild it exactly and know when it is done. Three people will split this work later by these domain files, so precision matters more than brevity. Long, dense, correct entries are the goal.',
'',
'PATHS (all absolute)',
'- Reference Laravel app root, READ-ONLY: ' + REF,
'- Reference docs (HTML, marketing-grade): ' + DOCS + '/pages/<category>/<page>.html',
'- Manifests of everything that exists: ' + MAN + '/ (routes.json, controllers.txt, services.txt, models.txt, tables.txt, views.txt, commands.txt, permissions.txt, middleware.txt, node_files.txt, resources_nonview.txt, events_mail_misc.txt, config_files.txt, migrations.txt, schedule.txt)',
'- REQUIRED format spec, read it completely before anything else: ' + SPEC,
'- Route query helper: python3 ' + TOOLS + '/routes.py --uri X --ctrl Y --name Z   (filters OR together; --closures lists closure routes; --count)',
'- Final DB schema (read-only): mysql -uthreadwise -pthreadwise_local_pw threadwise -e "SHOW CREATE TABLE <table>\\G"   and read-only SELECTs on seeded data. NEVER write to the DB, start servers, or run artisan commands that write.',
'- Lint one domain file: python3 ' + TOOLS + '/audit_coverage.py --inventory ' + INV + ' --only <domain-id> --out ' + REPORTS + '/lint-<domain-id>   then read the .md it writes',
'',
'ALL DOMAINS (code=id) so you know where things belong: ' + CODES,
'',
'BOUNDARY RULES',
'- The hints you get are STARTING POINTS, not the full scope. Discover the real surface yourself with grep over controllers, routes, services, models, migrations, views, resources/js, node/, seeders, console commands, mail, listeners, config.',
'- Catch-all controllers (AdminPagesController, UserPagesController, SettingsTabsController, Api/App/ContentController) and closure routes in routes/*.php serve many domains: claim only the routes whose behavior is yours (judge by uri, route name, view, called service).',
'- Api/V1/* routes belong to API, Api/App/* routes to MOB, provider inbound webhooks to their channel domain, internal Node<->Laravel routes to NODE. Business rules always live in the domain that owns the data: write them there once and reference them elsewhere.',
'- If something matches no domain, still document it in yours and flag it under Open questions & quirks.',
'',
'QUALITY BAR',
'- Every route you claim must map to a feature. Every model/table you own must appear in Data model with behavior-relevant columns (use SHOW CREATE TABLE for final shape; migrations only for history/intent). Every view file you own must be described as a screen. Every service class you own must be explained through the features that use it.',
'- Read validation rules (FormRequests and inline validate calls), authorization checks (middleware, policies, permission keys, plan feature keys, role checks), limits and defaults, enum values, ordering, pagination, exact side effects. Capture surprising behavior as QUIRK.',
'- Do not describe from route names or docs alone: open the code. The HTML docs advertise features; confirm each in code and mark docs-only when there is no working path.',
'- No invented behavior. If you cannot determine something, put it under Open questions & quirks.',
'- Do not paste code or long text from Reference; paraphrase.',
'- Reference is read-only. Write ONLY inside ' + INV + ' (and lint output under ' + REPORTS + ').',
''
].join('\n')

function writerPrompt(d) {
  return COMMON + [
'YOUR TASK: WRITER for domain "' + d[0] + '" (code ' + d[1] + '): ' + d[2],
'Starting-point hints: ' + d[3],
'',
'PROCEDURE',
'1. Read the spec. 2. Map the surface: run routes.py for your uris/controllers, list files, read the controllers/services/models/views/node files fully (not skimming), read related docs pages, inspect tables with SHOW CREATE TABLE, read migrations that add columns later, read seeders and console commands for your area.',
'3. Write ' + INV + '/' + d[0] + '.md following the spec exactly (front matter with domain: ' + d[0] + ' and code: ' + d[1] + ', feature ids WD-' + d[1] + '-001, -002, ...). Build the file in several passes (Write the head + first features, then append further sections with Bash cat >> or Edit) rather than one giant call. Order features by user journey.',
'4. Fill the coverage JSON block with exact manifest strings (routes as "METHOD uri", files relative to the Reference root, tables, models, views, permissions, commands, node files, js assets, misc files, config files, doc pages) and feature_map.',
'5. Lint with the audit tool and fix every issue reported for your file (missing labels, bad status/priority/effort, missing Given/When/Then, coverage json errors, unknown items).',
'6. Sanity re-check: run routes.py for each of your uri prefixes and controllers and confirm every returned route is either in your coverage or deliberately left to another domain (noted in Open questions).',
'Return the structured summary. featureCount must equal the number of WD-' + d[1] + '- entries in the file.'
  ].join('\n')
}

function criticAPrompt(d, w) {
  return COMMON + [
'YOUR TASK: CRITIC A (backend, data, async, integrations) for domain "' + d[0] + '" (code ' + d[1] + '): ' + d[2],
'A writer already produced ' + INV + '/' + d[0] + '.md (' + (w ? w.featureCount : '?') + ' features). Assume it is INCOMPLETE and partly shallow. Starting-point hints: ' + d[3],
'',
'PROCEDURE (work independently from source; do not trust the writer\'s list)',
'1. Read the spec, then the domain file.',
'2. Re-derive the domain surface yourself from the code using different search angles than a reader would start with: every public method of the domain controllers and services (does each map to a feature?), every route matched by routes.py for your controllers/uris/names, every model (fillable, casts, relations, scopes, observers, accessors), every table via SHOW CREATE TABLE and every migration touching it (defaults, enums, indexes, uniques, FKs, JSON shapes), every console command, listener, event, mail, notification, queued/sweeper/node-bridge interaction, webhook in/out, external API call, setting/config/.env key read (grep Setting::get, SystemSetting, config(, env( ), permission and plan-feature keys, seeders and default data.',
'3. Compare against the file. FIX IT IN PLACE: add missing features (continue numbering from the highest id, never renumber), correct wrong statements, and enrich every shallow entry: any feature with fewer than 3 numbered rules, fewer than 3 acceptance criteria, or a vague Data/Endpoints/Async/External/Settings field must be rewritten from the code. Update Data model, Cross-domain contracts, Feature index and the coverage block (with feature_map).',
'4. Re-run the lint tool for your file and fix everything.',
'Return counts of what you added/corrected/enriched and any gaps you could not close.'
  ].join('\n')
}

function criticBPrompt(d, a) {
  return COMMON + [
'YOUR TASK: CRITIC B (UX, docs-vs-code, i18n/emails, accuracy) for domain "' + d[0] + '" (code ' + d[1] + '): ' + d[2],
'The file ' + INV + '/' + d[0] + '.md has been written and already reviewed once for backend completeness. Your lenses are different. Starting-point hints: ' + d[3],
'',
'PROCEDURE',
'1. Read the spec, then the domain file.',
'2. UX/frontend lens: open EVERY blade view and JS asset belonging to the domain and verify each screen, modal, tab, form field, client-side validation, conditional visibility (role, plan, feature flag, channel state), empty/loading/error state, bulk action, filter/sort/search/pagination, realtime (Echo/websocket) update, toast/flash meaning, mobile/PWA behavior, chart/widget is described in the right feature. Check emails/notifications/push templates the domain sends, and which lang/en.json keys the views use (capture the i18n namespace/keys shape, not every string).',
'3. Docs-vs-code lens: read the relevant Documentation pages. List advertised capabilities; confirm each exists in code; add features or mark status docs-only/partial/dead-code as appropriate.',
'4. Accuracy lens: pick the 12 most consequential factual claims in the file (validation rules, limits, defaults, enum values, permission and plan keys, table columns, side effects, ordering) spread across different features, and verify each against the source. Correct any wrong claim in place. Record how many you checked and how many were wrong.',
'5. Fix the file in place (add features continuing numbering, never renumber; update index, data model, contracts, coverage + feature_map). Re-run lint and fix everything.',
'Return counts.'
  ].join('\n')
}

const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    featureCount: { type: 'integer' },
    effort: { type: 'object', properties: { S: { type: 'integer' }, M: { type: 'integer' }, L: { type: 'integer' }, XL: { type: 'integer' } }, required: ['S', 'M', 'L', 'XL'] },
    priorities: { type: 'object', properties: { P0: { type: 'integer' }, P1: { type: 'integer' }, P2: { type: 'integer' } }, required: ['P0', 'P1', 'P2'] },
    tablesOwned: { type: 'array', items: { type: 'string' } },
    dependsOnDomains: { type: 'array', items: { type: 'string' } },
    targetHints: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    lintClean: { type: 'boolean' },
  },
  required: ['file', 'featureCount', 'effort', 'tablesOwned', 'dependsOnDomains', 'lintClean'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    added: { type: 'integer' },
    corrected: { type: 'integer' },
    enriched: { type: 'integer' },
    claimsChecked: { type: 'integer' },
    claimsWrong: { type: 'integer' },
    docsOnly: { type: 'integer' },
    gapsLeft: { type: 'array', items: { type: 'string' } },
    lintClean: { type: 'boolean' },
  },
  required: ['added', 'corrected', 'gapsLeft', 'lintClean'],
}

log('Inventory run: ' + TARGET.length + ' domains; skipWrite=' + SKIP_WRITE.size + '; critics=' + CRITICS.join(','))

const results = await pipeline(
  TARGET,
  async function (d) {
    if (SKIP_WRITE.has(d[0])) return { w: { featureCount: null, file: INV + '/' + d[0] + '.md', effort: null, dependsOnDomains: [], tablesOwned: [], lintClean: true } }
    let w = await agent(writerPrompt(d), { label: 'write:' + d[0], phase: 'Write', schema: WRITER_SCHEMA, effort: 'high' })
    if (!w) {
      log('writer retry ' + d[0])
      w = await agent(writerPrompt(d), { label: 'write-retry:' + d[0], phase: 'Write', schema: WRITER_SCHEMA, effort: 'high' })
    }
    return { w: w }
  },
  async function (prev, d) {
    if (!prev || !prev.w) return { w: null, a: null }
    if (CRITICS.indexOf('A') < 0) return { w: prev.w, a: null }
    const a = await agent(criticAPrompt(d, prev.w), { label: 'criticA:' + d[0], phase: 'Critic A', schema: CRITIC_SCHEMA, effort: 'high' })
    return { w: prev.w, a: a }
  },
  async function (prev, d) {
    if (!prev || !prev.w) return { w: null, a: null, b: null }
    if (CRITICS.indexOf('B') < 0) return { w: prev.w, a: prev.a, b: null }
    const b = await agent(criticBPrompt(d, prev.a), { label: 'criticB:' + d[0], phase: 'Critic B', schema: CRITIC_SCHEMA, effort: 'high' })
    return { w: prev.w, a: prev.a, b: b }
  }
)

const summary = TARGET.map(function (d, i) {
  const r = results[i] || {}
  const w = r.w || null
  return {
    id: d[0], code: d[1],
    features: w ? w.featureCount : null,
    effort: w ? w.effort : null,
    deps: w ? w.dependsOnDomains : null,
    tables: w ? w.tablesOwned : null,
    targetHints: w ? w.targetHints : null,
    criticA: r.a ? { added: r.a.added, corrected: r.a.corrected, enriched: r.a.enriched, gaps: r.a.gapsLeft } : null,
    criticB: r.b ? { added: r.b.added, corrected: r.b.corrected, checked: r.b.claimsChecked, wrong: r.b.claimsWrong, docsOnly: r.b.docsOnly, gaps: r.b.gapsLeft } : null,
    failed: !w || (CRITICS.indexOf('A') >= 0 && !r.a) || (CRITICS.indexOf('B') >= 0 && !r.b),
  }
})
const failed = summary.filter(function (s) { return s.failed }).map(function (s) { return s.id })
log('done. failed/partial domains: ' + (failed.length ? failed.join(', ') : 'none'))
return { total: TARGET.length, failed: failed, summary: summary }
