import { z } from 'zod';

/**
 * The operator console's SMS platform switch (TW-SMS-025), the twin of the unofficial WhatsApp switch in node-bridge-runtime.
 * Off by default; it hides the SMS entry points for every workspace and never stops a sender that already exists.
 */
export const smsPlatformStateSchema = z.object({ enabled: z.boolean() });
export type SmsPlatformState = z.infer<typeof smsPlatformStateSchema>;

export const updateSmsPlatformSchema = z.object({ enabled: z.boolean() });
export type UpdateSmsPlatformInput = z.infer<typeof updateSmsPlatformSchema>;
