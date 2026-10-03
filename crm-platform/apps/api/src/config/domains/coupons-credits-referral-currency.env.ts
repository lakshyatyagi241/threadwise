import { z } from 'zod';

/**
 * Settings of the coupons, credit packages, referral and currency domain. Read straight from the environment (the central schema
 * belongs to the kernel) and validated once; every value has a safe default so a fresh checkout runs.
 */
const schema = z.object({
  /** The live-rate source (WD-CPN-023): a JSON document with a `rates` map of units per 1 USD. WaDesk hard-coded this URL. */
  CPN_FX_RATES_URL: z.string().url().default('https://open.er-api.com/v6/latest/USD'),
  /** WaDesk waited 12 seconds before giving up. */
  CPN_FX_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(12_000),
});

export type CpnConfig = z.output<typeof schema>;

/** Read at call time so tests can change the environment between runs. */
export function cpnConfig(env: NodeJS.ProcessEnv = process.env): CpnConfig {
  return schema.parse(env);
}
