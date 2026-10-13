/**
 * Hidden search words for each console page (Reference's palette index carries a `kw` list per entry, so "roas" finds Meta Ads
 * analytics). They are matched, never shown: an operator who types "stripe" or "smtp" lands on the page that configures it
 * even though neither word is in a page name. Keyed by operator-nav item id; a page without an entry is found by its name,
 * section and address alone. Module pages added at run time have none.
 */
export const CONSOLE_KEYWORDS: Readonly<Record<string, string>> = {
  overview: 'home dashboard start map',
  account: 'profile password two factor mfa 2fa sign in',

  financial: 'revenue income mrr arr money earnings sales finance',
  premium: 'premium paid subscribers upgrades revenue',
  'plan-analytics': 'plans packages subscriptions churn conversion revenue usage',
  'ai-dashboard': 'ai usage tokens openai gemini llm cost spend assistants',
  'system-health': 'health status uptime queue redis database errors monitoring performance',

  workspaces:
    'workspaces customers accounts wallet workspaces workspace plans plan override limits per workspace custom quota assignments provider whatsapp provider mapping suspend suspended login as owner impersonate owner mrr balance support customers',
  plans: 'packages pricing tiers subscription catalogue free trial limits features',
  'addon-packs': 'addons add ons billing extras packs purchase',
  coupons: 'discount promo code voucher offer percent off',
  'plan-settings': 'pricing settings trial currency yearly discount tax',
  'pricing-faqs': 'faq questions pricing page help',

  'billing-history': 'billing transactions payments history paid',
  'order-history': 'orders purchases checkout history',
  subscriptions:
    'subscriptions razorpay recurring renewals autopay cancel refund past due failed payment',
  invoices: 'invoice receipts pdf tax bills paid',
  'payment-gateways': 'stripe razorpay paypal paystack gateway payments cards checkout keys',
  'checkout-settings':
    'billing settings checkout tax refund window yearly discount auto renew recurring company invoice identity',
  'wallet-overview': 'wallet overview balance credits messaging billing summary totals',
  'wallet-pricing': 'message pricing credits per message rate cost price meta',
  'wallet-margins': 'margin markup meta cost profit percent country category',
  'wallet-packages': 'credit packages top up recharge bundles wallet',
  'wallet-logs': 'ledger transactions credits debit log history wallet',
  'bsp-income': 'message income profit p and l revenue meta charges ledger earnings',
  'bsp-credit': 'reseller meta credit line billing bsp whatsapp',

  'support-inbox': 'tickets support help desk customers requests',
  'support-platform-inbox': 'platform inbox tickets conversations support staff queue',
  'support-team': 'support team members staff roles helpdesk',
  'support-agents': 'support agents staff availability helpdesk',
  'support-sla': 'sla response time resolution policy deadline helpdesk',
  'support-playbooks': 'playbooks macros canned replies saved replies helpdesk',
  'support-reports': 'support reports analytics tickets response time helpdesk',
  'cms-announcements': 'announcements banner notice news website updates',
  'platform-analytics': 'platform analytics usage workspaces growth signups activity',
  'cms-contact': 'contact form messages inbox enquiries website leads',
  'cms-frontend': 'website landing page homepage cms editor frontend pages site builder',
  'cms-blog': 'blog posts articles news seo content',
  'cms-legal': 'legal terms privacy policy pages cookies',

  'wap-providers': 'whatsapp providers bsp meta cloud interakt gupshup registry credentials',
  'wap-switch': 'switch provider number migrate whatsapp number change',
  'node-bridge': 'node bridge baileys qr unofficial whatsapp server token address sender pacing',
  'sms-channel': 'sms text message twilio msg91 channel switch enable disable platform',
  'webhook-forwarding':
    'webhook forwarding fanout relay forward meta whatsapp events targets url failures retry',
  'waboo-migration':
    'waboo migration migrate move client import dry run load pipeline whatsapp database report',

  'market-catalogue': 'marketplace apps catalogue listings integrations publish review',
  'market-categories': 'categories marketplace tags groups',
  'market-requests': 'requests installs approvals marketplace pending',
  'market-usage': 'usage installs marketplace stats',
  extensions: 'extensions modules plugins addons code install upload zip',
  'flow-templates': 'flow templates chatbot automation gallery start from a template tenants clone',

  roles: 'roles permissions staff access admins team',
  permissions: 'permissions capabilities rights access control rbac',
  'staff-roles': 'staff roles operators assign support auditor super admin',
  security: 'security center mfa two factor 2fa ip allowlist sessions password policy',
  'security-events': 'security events audit log activity logins failed login suspicious',
  registration: 'registration signup sign up policy invite approval email verification trial',
  'social-login': 'social login google facebook captcha recaptcha turnstile oauth sso',
  'auth-pages': 'auth pages login page signup page branding forgot password',

  'settings-hub': 'settings project settings all tiles index',
  'settings-general':
    'general app name url timezone language currency maintenance mode support email',
  'settings-appearance': 'appearance colours colors theme branding logo fonts brand',
  'settings-site-info': 'site info about address contact phone company',
  'settings-footer': 'footer links social copyright',
  'settings-seo': 'seo meta title description sitemap robots keywords',
  'settings-pwa': 'pwa progressive web app install icon manifest offline',
  'menu-order': 'menu order navigation top bar more layout customer menu',
  'settings-mail': 'mail email smtp mailgun sendgrid ses outbound sender from',
  'settings-whatsapp': 'whatsapp waba meta app embedded signup credentials business cloud api',
  'settings-campaigns': 'campaigns broadcast sending limits rate',
  'settings-google-calendar': 'google calendar oauth appointments sync',
  'settings-microsoft-mail':
    'microsoft outlook office 365 microsoft 365 exchange graph entra azure email mailbox oauth inbox add-on credentials',
  'settings-google-mail': 'google gmail email mailbox oauth inbox add-on credentials push pubsub',
  'settings-flow-builder': 'flow builder simple advanced canvas automation chatbot step by step',
  'settings-catalog': 'catalog catalogue whatsapp commerce products meta',
  'ai-keys': 'ai keys api keys openai anthropic gemini llm provider token voice',
  'faq-engine':
    'faq faqs knowledge base questions answers embedding embeddings vector semantic matching openrouter threshold reindex',
  'lead-scoring':
    'ai lead scoring score leads contacts openrouter model cost spend usd tokens runs log opt in',
  'settings-privacy': 'privacy gdpr ada cookies consent accessibility data protection',
  'settings-analytics': 'analytics google analytics tag manager pixel tracking facebook',
  'settings-custom': 'custom code css javascript scripts head body snippet',
  'settings-storage': 'cloud storage s3 bucket files uploads minio r2 spaces',

  system: 'system status version update updater license install server php',
  'i18n-languages': 'languages translations locales rtl arabic default language',
  currencies: 'currencies currency exchange rate symbol money',
  'i18n-providers': 'translation providers google deepl machine translate api',
  'i18n-usage': 'translation usage characters quota cost machine translation',
};
