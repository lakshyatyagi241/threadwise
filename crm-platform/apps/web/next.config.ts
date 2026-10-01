import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@crm/ui'],
  // Dev only: lets HMR and hydration work when the app is opened by IP instead of `localhost`.
  allowedDevOrigins: ['127.0.0.1', '*.localhost'],
  // Next generates AGENTS.md/CLAUDE.md files on every dev start; this repo keeps its own agent guidance.
  agentRules: false,
  // Auth pages must never be cached (TW-AUTH-020, TW-AUTH-045); framing is refused everywhere.
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
