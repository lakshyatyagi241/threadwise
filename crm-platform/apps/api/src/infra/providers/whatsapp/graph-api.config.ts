import { z } from 'zod';

/**
 * Where the Graph API is, and how long we wait for it. Read from the environment at call time (the central env schema belongs to the
 * kernel, and a test must be able to point the adapter at a fake Graph server between runs).
 *
 *  - `GRAPH_API_BASE_URL`: `https://graph.facebook.com` by default. Tests and local development set it to a fake server. Outside
 *    production a plain-http loopback address is accepted; production accepts https only and fails the first call otherwise, so a
 *    misconfigured deploy cannot send an access token over plain http.
 *  - `META_GRAPH_VERSION`: the API version in every path. A version is supported for about two years after release; the default is
 *    a recent stable one and the owner moves it deliberately.
 *  - timeouts: a Cloud API send normally answers in well under a second. A hung connection must not hold a send worker, and the
 *    dispatch worker (not the client) decides about retries, so the client never retries.
 */
export const DEFAULT_GRAPH_VERSION = 'v23.0';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GRAPH_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default(DEFAULT_GRAPH_VERSION),
  WHATSAPP_SEND_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(25_000),
  WHATSAPP_READ_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(12_000),
});

export interface GraphApiConfig {
  /** `https://graph.facebook.com` or the test replacement, no trailing slash, no version. */
  baseUrl: string;
  version: string;
  /** `<base>/<version>`: what every Graph path is appended to. */
  root: string;
  sendTimeoutMs: number;
  readTimeoutMs: number;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function graphApiConfig(env: NodeJS.ProcessEnv = process.env): GraphApiConfig {
  const v = schema.parse({
    NODE_ENV: env.NODE_ENV,
    GRAPH_API_BASE_URL: env.GRAPH_API_BASE_URL || undefined,
    META_GRAPH_VERSION: env.META_GRAPH_VERSION || undefined,
    WHATSAPP_SEND_TIMEOUT_MS: env.WHATSAPP_SEND_TIMEOUT_MS || undefined,
    WHATSAPP_READ_TIMEOUT_MS: env.WHATSAPP_READ_TIMEOUT_MS || undefined,
  });
  const base = new URL(v.GRAPH_API_BASE_URL);
  const plainLoopback = base.protocol === 'http:' && LOOPBACK.has(base.hostname);
  if (base.protocol !== 'https:' && !plainLoopback) {
    throw new Error(
      'GRAPH_API_BASE_URL must be https (plain http is accepted only for a loopback test server).',
    );
  }
  if (v.NODE_ENV === 'production' && base.protocol !== 'https:') {
    throw new Error('GRAPH_API_BASE_URL must be https in production.');
  }
  return {
    baseUrl: base.origin,
    version: v.META_GRAPH_VERSION,
    root: `${base.origin}/${v.META_GRAPH_VERSION}`,
    sendTimeoutMs: v.WHATSAPP_SEND_TIMEOUT_MS,
    readTimeoutMs: v.WHATSAPP_READ_TIMEOUT_MS,
  };
}
