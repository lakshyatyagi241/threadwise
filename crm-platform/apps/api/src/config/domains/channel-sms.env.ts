import { z } from 'zod';

/**
 * Settings of the SMS channel. No credentials live here: a sender's keys are the workspace's own, encrypted on its row. These are
 * the provider addresses and the time each call may take, so a sandbox or a regional endpoint is a deployment setting, not a code
 * change. Read at call time, like the other domain files, so a test can point them at a local stub.
 */
const channelSmsEnvSchema = z.object({
  SMS_TWILIO_API_BASE: z.string().url().default('https://api.twilio.com'),
  SMS_TWILIO_LOOKUP_BASE: z.string().url().default('https://lookups.twilio.com'),
  SMS_MSG91_API_BASE: z.string().url().default('https://control.msg91.com'),
  /** A send (Reference: 20 s). */
  SMS_SEND_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  /** Checking credentials and looking a number up (Reference: 12 s). */
  SMS_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000),
});

export type ChannelSmsEnv = z.infer<typeof channelSmsEnvSchema>;

/** Reads and validates the SMS settings; a bad value stops the boot with a readable message. */
export function readChannelSmsEnv(
  raw: Record<string, string | undefined> = process.env,
): ChannelSmsEnv {
  const blank = (v: string | undefined) =>
    v === undefined || v.trim() === '' ? undefined : v.trim().replace(/\/+$/, '');
  const parsed = channelSmsEnvSchema.safeParse({
    SMS_TWILIO_API_BASE: blank(raw.SMS_TWILIO_API_BASE),
    SMS_TWILIO_LOOKUP_BASE: blank(raw.SMS_TWILIO_LOOKUP_BASE),
    SMS_MSG91_API_BASE: blank(raw.SMS_MSG91_API_BASE),
    SMS_SEND_TIMEOUT_MS: blank(raw.SMS_SEND_TIMEOUT_MS),
    SMS_VERIFY_TIMEOUT_MS: blank(raw.SMS_VERIFY_TIMEOUT_MS),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid SMS channel configuration:\n${details}\n`);
  }
  return parsed.data;
}
