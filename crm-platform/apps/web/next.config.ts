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
    ];
  },
  // Addresses WaDesk bookmarks and old emails may still carry. Query strings travel along with each redirect.
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

export default withNextIntl(nextConfig);
