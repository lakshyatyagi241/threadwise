/**
 * Addresses from the previous geta.ai site (and the WordPress site before it) that still sit in search results, backlinks and
 * old emails. Each one goes to the page that now does the same job; where no page does, to the nearest hub rather than a
 * made-up match. Permanent, so search engines move their ranking across. `redirects.test.ts` checks that every destination
 * is a page that exists.
 */
export interface LegacyRedirect {
  source: string;
  destination: string;
  permanent: true;
}

const to = (destination: string, ...sources: string[]): LegacyRedirect[] =>
  sources.map((source) => ({ source, destination, permanent: true as const }));

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  // Product pages
  ...to('/platform', '/product/overview'),
  ...to('/products/ai-agents', '/product/ai-agents', '/customizable-ai-bot'),
  ...to('/products/channels/voice', '/product/ai-agents/voice-agent', '/lp/voice-ai'),
  ...to('/products/channels/web-chat', '/product/ai-agents/web-agent', '/website-chatbot'),
  ...to('/products/channels/whatsapp', '/product/ai-agents/whatsapp-agent', '/lp/whatsapp-api'),
  ...to(
    '/products/crm',
    '/product/engagement-crm',
    '/product/engagement-crm/contact-profiles',
    '/product/engagement-crm/dynamic-segments',
    '/product/engagement-crm/lead-stage-automation',
    '/customer-data-platform',
  ),
  // Not `/inbox`: that address is the signed-in team inbox in the app, and a permanent redirect is cached by browsers.
  ...to('/products/team-inbox', '/product/inbox', '/product/engagement-crm/unified-inbox'),
  ...to('/products/forms-lead-capture', '/product/forms'),
  ...to('/products/integrations-api', '/product/integrations'),
  ...to(
    '/products/chatbots-flows',
    '/product/journeys',
    '/product/journey-orchestration/a-b-testing',
    '/product/journey-orchestration/behavior-triggers',
    '/product/journey-orchestration/journey-analytics',
    '/product/journey-orchestration/visual-builder',
  ),
  ...to('/products/channels', '/product/messaging'),
  ...to('/products/channels/email', '/product/messaging/email'),
  ...to('/products/channels/sms', '/product/messaging/sms', '/sms-marketing'),
  ...to('/products/channels/voice', '/product/messaging/voice'),
  ...to('/products/channels/whatsapp', '/product/messaging/whatsapp'),

  // Solutions and use cases. Pages with the same address on the new site need no entry.
  ...to(
    '/get-started',
    '/solutions',
    '/use-cases',
    '/as-per-industry',
    '/solutions/events',
    '/solutions/finance',
  ),
  ...to(
    '/solutions/education',
    '/education-chatbots',
    '/chatbots-for-education-use-cases-benefits',
  ),
  ...to(
    '/solutions/healthcare',
    '/healthcare-chatbots',
    '/the-pros-and-cons-of-healthcare-chatbots',
  ),
  ...to('/solutions/ecommerce', '/retail-chatbots'),
  ...to('/solutions/travel-hospitality', '/travel-chatbots', '/ultimate-travel-companion-chatbots'),
  ...to(
    '/get-started',
    '/banking-chatbots',
    '/insurance-chatbots',
    '/saas-chatbots',
    '/human-resource-chatbots',
  ),
  ...to('/use-cases/customer-support', '/use-cases/customer-engagement'),
  ...to('/products/broadcasts-campaigns', '/use-cases/drip-marketing'),
  ...to('/products/forms-lead-capture', '/use-cases/event-registration'),
  ...to('/products/channels/voice', '/use-cases/voice-automation'),

  // Company pages
  ...to('/about', '/company/about', '/about-us', '/company/team'),
  ...to('/careers', '/company/careers', '/career'),
  ...to('/contact', '/company/contact', '/contact-us'),
  ...to('/register', '/company/book-demo'),
  ...to('/legal/cookies', '/company/cookie-policy', '/cookie-policy'),
  ...to('/legal/privacy', '/company/privacy'),
  ...to('/legal/terms', '/company/terms', '/refund-and-cancellation-policy'),
  ...to('/security', '/company/security'),
  ...to('/', '/company/thank-you', '/why-geta', '/case-studies/:slug*'),
  ...to(
    '/platform',
    '/compare/chatbase',
    '/compare/moengage',
    '/compare/wati',
    '/compare/yellow-ai',
  ),

  // Blog, guides and the old WordPress posts
  ...to('/blog/:path*', '/resources/blog/:path*'),
  ...to(
    '/blog',
    '/resources',
    '/resources/ebooks',
    '/resources/webinars',
    '/resources/guides/:slug*',
  ),
  ...to('/blog', '/category/:path*', '/author/:path*'),
  ...to(
    '/blog',
    // These three posts are not on the new blog yet; point them at their own post once it is imported.
    '/top-10-chatbot-project-ideas-for-whatsapp-websites-social-media',
    '/how-to-build-an-ai-chatbot-that-works-across-channels',
    '/redefining-customer-engagement-with-ai-chatbots/feed',
    '/ready-to-use-script-chat-live-software-scripts',
    '/ai-agents-examples-vs-chatbots',
    '/designing-chatbot-dialogues-for-success',
    '/chatgpt-vs-ai-chatbots',
    '/success-stories-and-use-cases-of-chatbots-across-industries',
    '/how-do-chatbots-aid-students-in-college-admission-queries',
    '/power-of-ai-in-personalised-customer-interactions',
    '/personalized-shopping-experiences-with-ai-chatbots/feed',
  ),
];
