import { z } from 'zod';

/**
 * Environment of the iCal feed reader (BL-035). Read straight from the environment and validated at call time, so a test can change it
 * between runs (the same approach as `googleCalendarEnv`). A compose file passes an unset variable as an empty string, which must mean "not set".
 */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const bool = (dflt: boolean) =>
  z.preprocess(
    (v) =>
      typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v,
    z.boolean().default(dflt),
  );

const schema = z.object({
  /** Ceiling for one fetch of a feed, connect to last byte, in ms. */
  ICS_FEED_HTTP_TIMEOUT_MS: z.preprocess(
    blank,
    z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  ),
  /** A feed larger than this is refused (a calendar of a few thousand events is under a megabyte). */
  ICS_FEED_MAX_BYTES: z.preprocess(
    blank,
    z.coerce.number().int().min(10_000).max(50_000_000).default(5_000_000),
  ),
  /** Redirects followed by hand, each one checked as a fresh address (published calendars commonly redirect to another host). */
  ICS_FEED_MAX_REDIRECTS: z.preprocess(blank, z.coerce.number().int().min(0).max(8).default(4)),
  /**
   * Whether a feed may point at a loopback or private-network address. OFF, and only a test (a local server standing in for a calendar)
   * turns it on: a workspace admin must never be able to make the server fetch from its own network.
   */
  ICS_FEED_ALLOW_PRIVATE_ADDRESSES: bool(false),
});

export type IcsFeedEnv = z.output<typeof schema>;

export function icsFeedEnv(env: NodeJS.ProcessEnv = process.env): IcsFeedEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid iCal feed environment:\n${details}\n`);
  }
  return parsed.data;
}
