import { withSentryConfig } from '@sentry/nextjs/config';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Pages that must never be cached by the browser or a proxy (TW-AUTH-020, TW-AUTH-045): sign-in and recovery,
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
  // Auth pages must never be cached (TW-AUTH-020, TW-AUTH-045); framing is refused everywhere except the widget.
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
      // Framing is refused everywhere except the embeddable chat widget, which customers put on their own sites.
      { source: '/((?!widget(?:/|$)).*)', headers: security },
      ...NO_STORE_PAGES.map((source) => ({ source, headers: noStore })),
      // The buyer's page (/q/<token>) holds a customer's name and prices and its address is the credential: never cached,
      // never indexed, never leaked through a Referer header (TW-PROP-018, D-16).
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
  // Addresses Reference bookmarks and old emails may still carry. Query strings travel along with each redirect.
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: false },
      { source: '/register/verify', destination: '/verify-otp', permanent: false },
      { source: '/register/workspace', destination: '/onboarding', permanent: false },
      { source: '/register/plan', destination: '/onboarding', permanent: false },
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
