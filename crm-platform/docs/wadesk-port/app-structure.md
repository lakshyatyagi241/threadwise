# WaDesk app structure (from manifests)

Generated from `_work/manifests/routes.json` (1608 routes) and `views.txt` (503 Blade views). Names only: no behaviour, layout or copy is described here.

## 1. Screens by area (Blade views)

| area | views |
| --- | --- |
| `user` | 211 |
| `admin` | 106 |
| `components` | 59 |
| `storefront` | 23 |
| `auth` | 19 |
| `vendor` | 17 |
| `frontend` | 13 |
| `checkout` | 10 |
| `install` | 10 |
| `errors` | 9 |
| `partials` | 7 |
| `public` | 5 |
| `emails` | 3 |
| `bsp` | 2 |
| `pricing` | 2 |
| `(root)` | 2 |
| `developers` | 1 |
| `invoices` | 1 |
| `legal` | 1 |
| `mail` | 1 |
| `payment` | 1 |

## 2. Routes by section

### Customer app and public site (915 routes)

| section | routes | example |
| --- | --- | --- |
| `team-inbox` | 116 | `team-inbox` |
| `devices` | 43 | `devices` |
| `store` | 41 | `store` |
| `flows` | 40 | `flows` |
| `facebook` | 36 | `facebook/_health` |
| `telegram` | 24 | `telegram` |
| `templates` | 23 | `templates` |
| `chat` | 22 | `chat` |
| `meta-ads` | 22 | `meta-ads` |
| `line` | 21 | `line` |
| `account` | 17 | `account` |
| `appointments` | 17 | `appointments` |
| `catalog` | 16 | `catalog` |
| `contacts` | 16 | `contacts` |
| `install` | 16 | `install` |
| `wa-campaigns` | 16 | `wa-campaigns` |
| `settings` | 15 | `settings` |
| `deals` | 14 | `deals` |
| `tiktok` | 14 | `tiktok/_health` |
| `viber` | 14 | `viber` |
| `wechat` | 14 | `wechat` |
| `ai-training` | 12 | `ai-training` |
| `checkout` | 12 | `checkout` |
| `wa-calling` | 12 | `wa-calling/calls/{id}/answer` |
| `auto-reply` | 11 | `auto-reply` |
| `scheduled` | 11 | `scheduled` |
| `invoices` | 10 | `invoices` |
| `register` | 10 | `register` |
| `wa-forms` | 10 | `wa-forms` |
| `broadcasts` | 9 | `broadcasts` |
| `lead-finder` | 9 | `lead-finder` |
| `shopify` | 9 | `shopify` |
| `woocommerce` | 9 | `woocommerce` |
| `b` | 8 | `b/manage/{token}` |
| `connect` | 8 | `connect` |
| `waba-groups` | 8 | `waba-groups` |
| `ai-assistants` | 7 | `ai-assistants` |
| `chatbot-widgets` | 7 | `chatbot-widgets` |
| `s` | 7 | `s/{slug}` |
| `companies` | 6 | `companies` |
| `crm` | 6 | `crm` |
| `estimates` | 6 | `estimates` |
| `legal` | 6 | `legal/acceptable-use` |
| `notifications` | 6 | `notifications` |
| `proposals` | 6 | `proposals` |
| `wa-links` | 6 | `wa-links` |
| `widget` | 6 | `widget/{token}/api/config` |
| `attributes` | 5 | `attributes` |
| `tasks` | 5 | `tasks` |
| `trello` | 5 | `trello` |
| `ai-crm` | 4 | `ai-crm` |
| `contact-groups` | 4 | `contact-groups` |
| `developers` | 4 | `developers` |
| `hubspot` | 4 | `hubspot` |
| `projects` | 4 | `projects` |
| `slack` | 4 | `slack` |
| `sms` | 4 | `sms` |
| `social` | 4 | `social/calendar` |
| `support` | 4 | `support` |
| `tiktok-shop` | 4 | `tiktok-shop` |
| `activity-log` | 3 | `activity-log` |
| `call-logs` | 3 | `call-logs` |
| `docs` | 3 | `docs` |
| `guidebook` | 3 | `guidebook` |
| `message-history` | 3 | `message-history` |
| `payment` | 3 | `payment/callback/{gateway}` |
| `q` | 3 | `q/{token}` |
| `workspaces` | 3 | `workspaces/create` |
| `affiliate-history` | 2 | `affiliate-history` |
| `ai` | 2 | `ai/models` |
| `analytics` | 2 | `analytics` |
| `auth` | 2 | `auth/{provider}/callback` |
| `blog` | 2 | `blog` |
| `contact` | 2 | `contact` |
| `forgot-password` | 2 | `forgot-password` |
| `google-account` | 2 | `google-account` |
| `i` | 2 | `i/{token}` |
| `login` | 2 | `login` |
| `payments` | 2 | `payments` |
| `reset-password` | 2 | `reset-password/{token}` |
| `sheets-addon` | 2 | `sheets-addon` |
| `storage` | 2 | `storage/{path}` |
| `warmer` | 2 | `warmer` |
| `(home)` | 1 | `/` |
| `about` | 1 | `about` |
| `ai-usage` | 1 | `ai-usage` |
| `broadcasting` | 1 | `broadcasting/auth` |
| `calendar` | 1 | `calendar` |
| `csrf-token` | 1 | `csrf-token` |
| `dashboard` | 1 | `dashboard` |
| `email` | 1 | `email/verify/resend` |
| `features` | 1 | `features` |
| `home` | 1 | `home` |
| `hooks` | 1 | `hooks/in/{token}` |
| `integrations` | 1 | `integrations` |
| `l` | 1 | `l/{slug}` |
| `locale` | 1 | `locale` |
| `logout` | 1 | `logout` |
| `manifest.json` | 1 | `manifest.json` |
| `more` | 1 | `more` |
| `notifications-page` | 1 | `notifications-page` |
| `pricing` | 1 | `pricing` |
| `quick-access` | 1 | `quick-access` |
| `r` | 1 | `r/{token}` |
| `robots.txt` | 1 | `robots.txt` |
| `sanctum` | 1 | `sanctum/csrf-cookie` |
| `sitemap.xml` | 1 | `sitemap.xml` |
| `team-chat` | 1 | `team-chat` |
| `team-inbox-manifest.json` | 1 | `team-inbox-manifest.json` |
| `tour` | 1 | `tour/seen` |
| `up` | 1 | `up` |
| `verify-email` | 1 | `verify-email/{id}/{hash}` |
| `wa` | 1 | `wa/checkout/return/{slug}/{token}` |
| `wd-sync` | 1 | `wd-sync` |
| `{wsSlug}` | 1 | `{wsSlug}` |

### Admin panel (platform) (332 routes)

| section | routes | example |
| --- | --- | --- |
| `settings` | 71 | `admin/settings` |
| `support` | 25 | `admin/support` |
| `users` | 16 | `admin/users` |
| `team-inbox` | 11 | `admin/team-inbox` |
| `extensions` | 10 | `admin/extensions` |
| `frontend` | 10 | `admin/frontend` |
| `bsp` | 9 | `admin/bsp` |
| `packages` | 9 | `admin/packages` |
| `update` | 9 | `admin/update` |
| `workspaces` | 9 | `admin/workspaces` |
| `roles` | 8 | `admin/roles` |
| `security` | 8 | `admin/security` |
| `addons` | 7 | `admin/addons` |
| `announcements` | 7 | `admin/announcements` |
| `blog` | 7 | `admin/blog` |
| `coupons` | 7 | `admin/coupons` |
| `credit-packages` | 7 | `admin/credit-packages` |
| `currencies` | 7 | `admin/currencies` |
| `devices` | 7 | `admin/devices` |
| `flow-templates` | 7 | `admin/flow-templates` |
| `guidebook` | 7 | `admin/guidebook` |
| `invoices` | 6 | `admin/invoices` |
| `languages` | 6 | `admin/languages` |
| `order-history` | 5 | `admin/order-history` |
| `pricing-faqs` | 5 | `admin/pricing-faqs` |
| `translation-providers` | 5 | `admin/translation-providers` |
| `contact-messages` | 4 | `admin/contact-messages` |
| `legal-pages` | 4 | `admin/legal-pages` |
| `notifications` | 4 | `admin/notifications` |
| `permissions` | 4 | `admin/permissions` |
| `api-keys` | 3 | `admin/api-keys` |
| `audit-log` | 3 | `admin/audit-log` |
| `payment-gateways` | 3 | `admin/payment-gateways` |
| `storage` | 3 | `admin/storage` |
| `billing-history` | 2 | `admin/billing-history` |
| `checkout-settings` | 2 | `admin/checkout-settings` |
| `health` | 2 | `admin/health` |
| `impersonate` | 2 | `admin/impersonate/stop` |
| `meta-ads` | 2 | `admin/meta-ads/keys` |
| `site-settings` | 2 | `admin/site-settings` |
| `admin` | 1 | `admin` |
| `ai-dashboard` | 1 | `admin/ai-dashboard` |
| `ai-keys` | 1 | `admin/ai-keys` |
| `analytics` | 1 | `admin/analytics` |
| `financial` | 1 | `admin/financial` |
| `premium` | 1 | `admin/premium` |
| `translation-usage` | 1 | `admin/translation-usage` |

### REST API v1 (api key) (60 routes)

| section | routes | example |
| --- | --- | --- |
| `api` | 60 | `api/v1/auto-replies` |

### Mobile app API (162 routes)

| section | routes | example |
| --- | --- | --- |
| `api` | 162 | `api/app-config` |

### Internal/node/extension API (98 routes)

| section | routes | example |
| --- | --- | --- |
| `api` | 98 | `api/attributes` |

### Webhooks (41 routes)

| section | routes | example |
| --- | --- | --- |
| `webhooks` | 31 | `webhooks` |
| `team-inbox` | 4 | `team-inbox/api/webhooks` |
| `devices` | 1 | `devices/waba/{id}/webhook-check` |
| `flows` | 1 | `flows/api/test-webhook` |
| `payment` | 1 | `payment/webhook/{gateway}` |
| `shopify` | 1 | `shopify/webhook/{secret}` |
| `wa` | 1 | `wa/checkout/webhook/{slug}` |
| `woocommerce` | 1 | `woocommerce/webhook/{secret}` |

## 3. Auth and onboarding routes

- `POST account/password`
- `GET account/verify-email`
- `POST devices/waba/verify-token`
- `POST devices/waba/{id}/register`
- `POST email/verify/resend`
- `GET forgot-password`
- `POST forgot-password`
- `GET install`
- `GET install/admin`
- `POST install/admin`
- `GET install/application`
- `POST install/application`
- `GET install/database`
- `POST install/database`
- `POST install/database/test`
- `POST install/execute`
- `GET install/license`
- `POST install/license`
- `GET install/node`
- `POST install/node`
- `GET install/requirements`
- `POST install/requirements`
- `GET install/run`
- `GET login`
- `POST login`
- `GET logout`
- `GET register`
- `POST register`
- `GET register/plan`
- `POST register/plan/skip`
- `GET register/plan/skip`
- `GET register/verify`
- `POST register/verify`
- `POST register/verify/resend`
- `GET register/workspace`
- `POST register/workspace`
- `POST reset-password`
- `GET reset-password/{token}`
- `POST settings/2fa/disable`
- `POST settings/2fa/enable`
- `GET social/calendar`
- `GET social/posts`
- `GET social/posts/data`
- `POST social/schedule`
- `POST store/storefront/verify-domain`
- `POST team-inbox/api/members/{userId}/reset-password`
- `POST trello/{id}/register`
- `GET verify-email/{id}/{hash}`