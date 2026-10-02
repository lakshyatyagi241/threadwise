import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@crm/ui'],
  // Dev only: lets HMR and hydration work when the app is opened by IP instead of `localhost`.
  allowedDevOrigins: ['127.0.0.1', '*.localhost'],
  // Next generates AGENTS.md/CLAUDE.md files on every dev start; this repo keeps its own agent guidance.
  agentRules: false,
  // Dev only: keep Next's round badge off the bottom-left, where the menu's workspace card lives.
  devIndicators: { position: 'bottom-right' },
  // Auth pages must never be cached (WD-AUTH-020, WD-AUTH-045); framing is refused everywhere.
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
    const noStore = [
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
    ];
    return [
      { source: '/:path*', headers: security },
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
      ...[
        '/login',
        '/signup',
        '/register',
        '/forgot-password',
        '/find-workspace',
        '/reset-password/:path*',
        '/verify-email',
        '/confirm-email-change',
        '/verify-otp',
        '/auth/:path*',
        '/admin/login',
      ].map((source) => ({ source, headers: noStore })),
    ];
  },
};

export default withNextIntl(nextConfig);
