import { withSentryConfig } from '@sentry/nextjs/config';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Pages that must never be cached by the browser or a proxy (WD-AUTH-020, WD-AUTH-045): sign-in and recovery,
 * the emailed-link landings, and the lock screens. A cached copy would show a stale form or a stale session.
 */
const NO_STORE_PAGES = [
  '/login',
  '/logout',
  '/signup',
  '/register',
  '/register/:path*',
  '/forgot-password',
  '/find-workspace',
  '/reset-password/:path*',
  '/verify-email',
  '/confirm-email-change',
  '/verify-otp',
  '/auth/:path*',
  '/onboarding',
  '/suspended',
  '/verify-email-required',
  '/admin/login',
];

const nextConfig: NextConfig = {
  transpilePackages: ['@crm/ui'],
  // Dev only: lets HMR and hydration work when the app is opened by IP instead of `localhost`.
  allowedDevOrigins: ['127.0.0.1', '*.localhost'],
  // Next generates AGENTS.md/CLAUDE.md files on every dev start; this repo keeps its own agent guidance.
  agentRules: false,
  // Dev only: keep Next's round badge off the bottom-left, where the menu's workspace card lives.
  devIndicators: { position: 'bottom-right' },
  // Auth pages must never be cached (WD-AUTH-020, WD-AUTH-045); framing is refused everywhere except the widget.
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
    const noStore = [
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private, max-age=0' },
      { key: 'Pragma', value: 'no-cache' },
    ];
    return [
      // Framing is refused everywhere except the embeddable chat widget, the Forms pages (which customers put on their own sites) and
      // the `/shopify` pages, whose policy `proxy.ts` sets (Shopify's admin may frame them when the request carries `host` and `shop`).
      { source: '/((?!widget(?:/|$)|f/|shopify(?:/embedded)?/?$).*)', headers: security },
      // The other security headers still apply to the `/shopify` pages; only the frame policy is left to `proxy.ts`.
      {
        source: '/shopify/:path(embedded)?',
        headers: security.filter(
          (h) => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy',
        ),
      },
      // A form page (/f/<key>): never indexed and never leaking its address. Its frame policy is per form (the allow-list the owner
      // set), so `proxy.ts` sets it on every request to the page and fails closed ('none') on any doubt. No frame header is declared
      // here on purpose: a static X-Frame-Options would still be sent next to the policy `proxy.ts` sets and would block the embed.
      {
        source: '/f/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      ...NO_STORE_PAGES.map((source) => ({ source, headers: noStore })),
      // The buyer's page (/q/<token>) holds a customer's name and prices and its address is the credential: never cached,
      // never indexed, never leaked through a Referer header (WD-PROP-018, D-16).
      {
        source: '/q/:path*',
        headers: [
          ...noStore,
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      // The visitor's booking pages (/book/<org>/<service>) and manage pages (/b/manage/<token>): a manage link is a secret and
      // the pages hold a customer's name and time, so the same rules as /q.
      ...['/book/:path*', '/b/:path*'].map((source) => ({
        source,
        headers: [
          ...noStore,
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      })),
    ];
  },
  // Addresses WaDesk bookmarks and old emails may still carry. Query strings travel along with each redirect.
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: false },
      { source: '/register/verify', destination: '/verify-otp', permanent: false },
      { source: '/register/workspace', destination: '/onboarding', permanent: false },
      { source: '/register/plan', destination: '/onboarding', permanent: false },
      { source: '/account/branding', destination: '/settings/message-footer', permanent: false },
      { source: '/account/suspended', destination: '/suspended', permanent: false },
      { source: '/account/verify-email', destination: '/verify-email-required', permanent: false },
      {
        source: '/reset-password/:token',
        destination: '/reset-password?token=:token',
        permanent: false,
      },
    ];
  },
};

// Source maps are uploaded only when a build has an auth token (CI sets SENTRY_AUTH_TOKEN); without one this wrapper adds nothing
// but the instrumentation hooks, so local builds and builds without the secret still work.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: true,
});
