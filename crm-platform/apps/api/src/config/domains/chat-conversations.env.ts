import { z } from 'zod';

/**
 * Settings of the chat-conversations domain. Read straight from the environment (the central schema belongs to the kernel) at call
 * time, so a test can change the environment between runs.
 *
 * The dev simulator is the one thing here with a safety rule: it exists to exercise the inbox without a real provider, which also
 * means it writes "customer" messages into a workspace on request. It is never allowed to run in production: `simulatorAllowed` is
 * false there whatever the flag says, and `assertSimulatorBootSafe` makes a production process that asks for it refuse to start.
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Switches on the simulator channel kind and its dev routes (never in production). */
  CHANNEL_SIMULATOR_ENABLED: booleanish.default(false),
});

export interface ChatConversationsConfig {
  production: boolean;
  /** The flag as set, before the production rule is applied. */
  simulatorRequested: boolean;
}

export function chatConversationsConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChatConversationsConfig {
  const parsed = schema.parse({
    NODE_ENV: env.NODE_ENV,
    CHANNEL_SIMULATOR_ENABLED: env.CHANNEL_SIMULATOR_ENABLED,
  });
  return {
    production: parsed.NODE_ENV === 'production',
    simulatorRequested: parsed.CHANNEL_SIMULATOR_ENABLED,
  };
}

/** True only outside production and with the flag on. */
export function simulatorAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = chatConversationsConfig(env);
  return c.simulatorRequested && !c.production;
}

/** Throws when a production process asks for the simulator: a misconfigured deploy must stop, not quietly ignore the flag. */
export function assertSimulatorBootSafe(env: NodeJS.ProcessEnv = process.env): void {
  const c = chatConversationsConfig(env);
  if (c.production && c.simulatorRequested) {
    throw new Error(
      'CHANNEL_SIMULATOR_ENABLED is set in a production environment. The channel simulator writes customer messages on request and ' +
        'must never run in production: unset it.',
    );
  }
}
