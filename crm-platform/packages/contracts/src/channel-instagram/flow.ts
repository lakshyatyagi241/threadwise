import { z } from 'zod';

/** Running an engine flow on an Instagram thread (TW-IG-012). The flows live on the engine; Reference lists them and starts one. */

export const igFlowListSchema = z.object({
  flows: z.array(z.object({ id: z.number().int().positive(), name: z.string() })),
  /** Where the engine's flow builder is, for "create one"; null when nothing is linked or the engine is off. */
  authorUrl: z.string().nullable(),
});
export type IgFlowList = z.infer<typeof igFlowListSchema>;

export const runIgFlowSchema = z.object({ flowId: z.number().int().positive() });
export type RunIgFlowInput = z.infer<typeof runIgFlowSchema>;

export const igRunFlowResultSchema = z.object({ ok: z.literal(true) });
export type IgRunFlowResult = z.infer<typeof igRunFlowResultSchema>;
