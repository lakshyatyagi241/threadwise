// One place for every environment-dependent value. Env vars win, then PARITY_CONFIG (a JSON file), then defaults.
// Defaults are the LOCAL seeded test accounts documented by the repo itself:
//   WaDesk reference: DatabaseSeeder (see the wadesk-run-reference skill)
//   our platform:     packages/db/src/cli/seed.ts and docs/runbooks/local-development.md
// They only ever point at localhost. Never put real credentials here.
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HARNESS_DIR = resolve(HERE, '..');
export const SKILL_DIR = resolve(HARNESS_DIR, '..');
export const REPO = resolve(SKILL_DIR, '..', '..', '..');

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {}))
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v;
  return out;
};

export function loadConfig(env = process.env) {
  const user = (() => {
    try {
      return userInfo().username;
    } catch {
      return 'user';
    }
  })();
  const wadeskPort = env.WADESK_PORT || '8000';
  const base = {
    outRoot: env.PARITY_OUT || join(env.TMPDIR || tmpdir(), `wadesk-parity-${user}`),
    wadesk: {
      baseUrl: env.WADESK_URL || `http://127.0.0.1:${wadeskPort}`,
      users: {
        admin: {
          email: env.WADESK_EMAIL || 'test@example.com',
          password: env.WADESK_PASSWORD || 'password',
        },
      },
      // WaDesk shows a cookie banner whose "decline" reloads the page; pre-seeding the declined choice avoids a race
      // that wipes forms. Only necessary cookies are accepted (the privacy-preserving option).
      consentCookie: {
        name: 'wadesk_cookie_consent',
        value: { necessary: true, analytics: false, marketing: false },
      },
      loginPath: '/login',
      loginOk: (url) => !new URL(url).pathname.startsWith('/login'),
    },
    ours: {
      webUrl: env.PARITY_WEB_URL || '', // empty = apps/web not running/built yet
      apiUrl: env.PARITY_API_URL || 'http://localhost:3000',
      org: env.PARITY_ORG || 'Admin',
      users: {
        admin: {
          email: env.PARITY_EMAIL || 'nachiket.challawar@geta.ai',
          password: env.PARITY_PASSWORD || 'Passw0rd!',
        },
      },
      apiLoginPath: '/v2/auth/staff/login',
      // UI login: filled in by the web foundation. Selectors are role/label based so most designs work unchanged.
      login: {
        path: '/login',
        email: { any: [{ css: 'input[type=email], input[name=email]' }, { label: /e-?mail/i }] },
        org: {
          any: [
            { css: 'input[name=orgSlug], input[name=org], input[name=workspace]' },
            { label: /(organi[sz]ation|workspace|company)/i },
          ],
        },
        submit: {
          any: [
            { css: 'button[type=submit], input[type=submit]' },
            { role: 'button', name: /(sign|log)\s?in/i },
          ],
        },
      },
      loginOk: (url) => !new URL(url).pathname.startsWith('/login'),
    },
    viewports: [
      { name: 'mobile', width: 390, height: 844 },
      { name: 'tablet', width: 820, height: 1180 },
      { name: 'desktop', width: 1366, height: 900 },
    ],
    desktop: { width: 1366, height: 900 },
    timeouts: { action: 8000, navigation: 30000, quiet: 400, scenario: 90000 },
    // console/network noise that exists in both worlds and says nothing about the feature
    ignore: {
      console: [
        /favicon/i,
        /ERR_BLOCKED_BY_CLIENT/i,
        /Failed to load resource.*(analytics|gtag|fonts\.g)/i,
        /DevTools/i,
        /\[HMR\]|\[Fast Refresh\]|webpack-hmr|__nextjs/i,
      ],
      requests: [
        /favicon\.ico/i,
        /google-analytics|googletagmanager|fonts\.(googleapis|gstatic)/i,
        /\/_next\/(webpack-hmr|static\/development)/i,
      ],
    },
    perfRatioLimit: 2.5, // ours may be at most this many times slower than the reference before it is a finding
    depth: env.PARITY_DEPTH || 'full', // quick | standard | full
    headless: env.PARITY_HEADED ? false : true,
    slowMo: env.PARITY_SLOWMO ? Number(env.PARITY_SLOWMO) : 0,
  };
  const file = env.PARITY_CONFIG;
  if (file && existsSync(file)) return deepMerge(base, JSON.parse(readFileSync(file, 'utf8')));
  return base;
}
