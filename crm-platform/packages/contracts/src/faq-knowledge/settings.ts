import { z } from 'zod';
import { FAQ_LIMITS } from './entries';

export const FAQ_VERIFY_MODES = ['off', 'borderline'] as const;
export type FaqVerifyMode = (typeof FAQ_VERIFY_MODES)[number];

/** The workspace's FAQ switch and matching knobs. */
export const updateFaqSettingsSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(FAQ_LIMITS.thresholdMin).max(FAQ_LIMITS.thresholdMax),
  minMargin: z.number().min(0).max(FAQ_LIMITS.marginMax),
  logQueries: z.boolean(),
  /** A second opinion from a small chat model for matches that only just cleared the threshold. Absent keeps the saved value. */
  verifyMode: z.enum(FAQ_VERIFY_MODES).optional(),
  verifyBand: z.number().min(FAQ_LIMITS.verifyBandMin).max(FAQ_LIMITS.verifyBandMax).optional(),
  /** Absent on the first save (no row yet). */
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateFaqSettingsInput = z.infer<typeof updateFaqSettingsSchema>;

export interface FaqSettings {
  enabled: boolean;
  threshold: number;
  minMargin: number;
  logQueries: boolean;
  verifyMode: FaqVerifyMode;
  /** How far above the threshold a score still counts as borderline and goes to the check. */
  verifyBand: number;
  /** The platform switch for the check and the model it uses; false means `verifyMode` has no effect. */
  verifyAvailable: boolean;
  verifyModel: string;
  /** True until the workspace saved once: the numbers are then the platform defaults. */
  isDefault: boolean;
  /** The platform switch: when false the FAQ cannot answer whatever `enabled` says. */
  engineEnabled: boolean;
  embeddingModel: string;
  /** The threshold that suits the embedding model in use (what a new workspace starts with unless the operator fixed another). */
  recommendedThreshold: number;
  /** The model in force when this workspace last saved; null until it has saved. */
  tunedForModel: string | null;
  /**
   * True when the platform changed the embedding model after this workspace tuned its threshold: scores moved, so the number it chose
   * may now answer wrongly (or too little). The screens ask the owner to review it.
   */
  modelChanged: boolean;
  /** What the workspace may hold, set by the platform. */
  limits: { maxFaqs: number; maxVariationsPerFaq: number };
  usage: { faqs: number; variations: number };
  rowVersion: number | null;
  updatedAt: string | null;
}
