import { z } from 'zod';

/**
 * Settings of the Shopify and WooCommerce domain. Read straight from the environment (not the central schema, which belongs to the
 * kernel) and validated once; every value has a safe default so a fresh checkout runs.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  /**
   * A WooCommerce store is an address the merchant typed, so addresses on private, loopback or link-local ranges are refused
   * (SSRF). Self-hosted installs whose store lives on the same network turn this on. Shopify stores are always `*.myshopify.com`.
   */
  ECOM_ALLOW_PRIVATE_STORE_URLS: booleanish.default(false),
});

export type EcomConfig = z.output<typeof schema>;

/** Read at call time so tests can change the environment between runs. */
export function ecomConfig(env: NodeJS.ProcessEnv = process.env): EcomConfig {
  return schema.parse(env);
}
