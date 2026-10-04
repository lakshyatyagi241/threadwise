import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';

/**
 * Environment of the storefront-builder domain (STORE).
 *
 * These keys are read through ConfigService, which falls back to process.env for a key the shared schema does not list, so
 * the domain does not have to touch `env.schema.ts`. Everything is optional and has the Reference default; a bad value stops
 * the process at the first read with a readable message instead of becoming `undefined` mid-request.
 */
const storefrontEnvSchema = z.object({
  APP_URL: z.string().url().default('http://localhost:3000'),
  WEB_APP_URL: z.string().url().default('http://localhost:3001'),
  /** Parent host of the shop subdomains (`<slug>.<host>`). Unset, `localhost`, an IP or the app host means path mode. */
  STOREFRONT_HOST: z.string().trim().optional(),
  /** What a custom domain's CNAME must point at. Default: the host of the web app. */
  STOREFRONT_CNAME_TARGET: z.string().trim().optional(),
  /** `fixture` swaps Razorpay and the DNS resolver for deterministic stand-ins (tests, demos). */
  STORE_PROVIDER_MODE: z.enum(['live', 'fixture']).default('live'),
  /** The Node bridge that holds the unofficial (QR-paired) WhatsApp sessions. */
  BAILEYS_SERVER_URL: z.string().url().optional(),
  BAILEYS_NODE_TOKEN: z.string().optional(),
});

export interface StorefrontEnv {
  appUrl: string;
  webAppUrl: string;
  appHost: string;
  webHost: string;
  /** The subdomain parent host when it is a real one (Reference `hostUsable`), else null. */
  storefrontHost: string | null;
  cnameTarget: string;
  providerMode: 'live' | 'fixture';
  bridgeUrl: string | null;
  bridgeToken: string | null;
}

export const STOREFRONT_ENV = Symbol('STOREFRONT_ENV');

const KEYS = Object.keys(storefrontEnvSchema.shape);

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isIpv4 = (h: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(h.split(':')[0] ?? '');

/** Reference `hostUsable`: explicitly set, not localhost, not the app host, not a raw IP. */
export function usableStorefrontHost(
  configured: string | undefined,
  ...appHosts: string[]
): string | null {
  const host = (configured ?? '').trim().toLowerCase();
  if (!host || host === 'localhost') return null;
  if (appHosts.includes(host)) return null;
  if (isIpv4(host)) return null;
  return host;
}

export function parseStorefrontEnv(raw: Record<string, string | undefined>): StorefrontEnv {
  const parsed = storefrontEnvSchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== '')),
  );
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid storefront environment configuration:\n${details}\n`);
  }
  const e = parsed.data;
  const appHost = hostOf(e.APP_URL);
  const webHost = hostOf(e.WEB_APP_URL);
  return {
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    webAppUrl: e.WEB_APP_URL.replace(/\/+$/, ''),
    appHost,
    webHost,
    storefrontHost: usableStorefrontHost(e.STOREFRONT_HOST, appHost, webHost),
    cnameTarget: (e.STOREFRONT_CNAME_TARGET || webHost || appHost || 'localhost').toLowerCase(),
    providerMode: e.STORE_PROVIDER_MODE,
    bridgeUrl: e.BAILEYS_SERVER_URL ? e.BAILEYS_SERVER_URL.replace(/\/+$/, '') : null,
    bridgeToken: e.BAILEYS_NODE_TOKEN ?? null,
  };
}

export function readStorefrontEnv(config: ConfigService): StorefrontEnv {
  return parseStorefrontEnv(
    Object.fromEntries(KEYS.map((k) => [k, config.get<string>(k)])) as Record<
      string,
      string | undefined
    >,
  );
}
