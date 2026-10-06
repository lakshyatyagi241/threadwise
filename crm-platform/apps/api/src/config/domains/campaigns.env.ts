import { z } from 'zod';

/**
 * Settings of the campaigns domain. One switch: how the Cloud API sender behaves.
 *
 * `live` sends through Meta (or the provider the number is on). `fixture` is a sandbox that never leaves the machine: it answers a send
 * the way Meta does, and reports delivery or failure afterwards through the same receipt path the webhook uses, so retries, the wallet
 * charge and the screens can be shown and tested without a WhatsApp account. It is refused in production.
 */
const campaignsEnvSchema = z.object({
  CAMP_PROVIDER_MODE: z.enum(['live', 'fixture']).default('live'),
});

export type CampaignsEnv = z.infer<typeof campaignsEnvSchema>;

/** Reads and validates the campaigns settings; a bad value, or the sandbox in production, stops the boot with a readable message. */
export function readCampaignsEnv(
  raw: Record<string, string | undefined> = process.env,
): CampaignsEnv {
  const blank = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim();
  const parsed = campaignsEnvSchema.safeParse({
    CAMP_PROVIDER_MODE: blank(raw.CAMP_PROVIDER_MODE),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid campaigns configuration:\n${details}\n`);
  }
  if (parsed.data.CAMP_PROVIDER_MODE === 'fixture' && raw.NODE_ENV === 'production') {
    throw new Error('CAMP_PROVIDER_MODE=fixture is a sandbox and cannot run in production.');
  }
  return parsed.data;
}
