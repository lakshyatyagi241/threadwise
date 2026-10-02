import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { currencyCodeSchema } from './money';

/**
 * Pipelines and their stages (TW-DEAL-002, 041, 042, 044). Reference seeded one pipeline with six stages and offered no way to
 * change either, although its documentation promised an editor; this is that editor.
 */
export const PIPELINE_NAME_MAX = 120;
export const STAGE_NAME_MAX = 120;
export const STAGES_PER_PIPELINE_MAX = 30;

/** `open` stages hold work in progress; at most one stage per pipeline is `won` and at most one is `lost`. */
export const stageKindSchema = z.enum(['open', 'won', 'lost']);
export type StageKind = z.infer<typeof stageKindSchema>;

export const stageColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'colour must be a hex value like #6366F1');

export const stageProbabilitySchema = z.number().int().min(0).max(100);

export const pipelineStageResponseSchema = z.object({
  id: uuidSchema,
  pipelineId: uuidSchema,
  name: z.string(),
  color: z.string(),
  /** 0-100. A won stage is always 100 and a lost stage always 0. */
  probability: z.number().int(),
  kind: stageKindSchema,
  sortOrder: z.number().int(),
  /** Deals currently in the stage (every status). */
  dealCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PipelineStageResponse = z.infer<typeof pipelineStageResponseSchema>;

export const pipelineResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** The currency a new deal in this pipeline starts with. Each deal keeps its own. */
  currency: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  stages: z.array(pipelineStageResponseSchema),
  dealCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;

export const stageInputSchema = z.object({
  name: z.string().trim().min(1).max(STAGE_NAME_MAX),
  color: stageColorSchema.optional(),
  /** Ignored for a won (100) or lost (0) stage. */
  probability: stageProbabilitySchema.optional(),
  kind: stageKindSchema.default('open'),
});
export type StageInput = z.infer<typeof stageInputSchema>;

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(PIPELINE_NAME_MAX),
  currency: currencyCodeSchema.optional(),
  /** Make it the workspace default straight away. */
  isDefault: z.boolean().optional(),
  /** The ladder, in order. Omit for the standard six: New Lead, Qualified, Proposal, Negotiation, Won, Lost. */
  stages: z.array(stageInputSchema).min(1).max(STAGES_PER_PIPELINE_MAX).optional(),
});
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(PIPELINE_NAME_MAX).optional(),
  currency: currencyCodeSchema.optional(),
  /** `true` makes this the default (the previous default stops being it). There is always exactly one: `false` is refused. */
  isDefault: z.literal(true).optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;

/** Every pipeline id, in the order they should appear. */
export const reorderPipelinesSchema = z.object({
  pipelineIds: z.array(uuidSchema).min(1).max(200),
});
export type ReorderPipelinesInput = z.infer<typeof reorderPipelinesSchema>;

/**
 * Deleting a pipeline that holds deals needs somewhere for them to go: open deals land in the target's first open stage, won
 * deals in its won stage, lost deals in its lost stage. The default pipeline cannot be deleted.
 */
export const deletePipelineQuerySchema = z.object({
  moveDealsToPipelineId: uuidSchema.optional(),
});
export type DeletePipelineQuery = z.infer<typeof deletePipelineQuerySchema>;

export const createStageSchema = stageInputSchema.extend({
  /** Insert before this stage; omit to append (after the last open stage when the ladder ends in won/lost). */
  beforeStageId: uuidSchema.optional(),
});
export type CreateStageInput = z.infer<typeof createStageSchema>;

export const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(STAGE_NAME_MAX).optional(),
  color: stageColorSchema.optional(),
  probability: stageProbabilitySchema.optional(),
  /** Only a stage that holds no deals can change kind (its deals' status follows the kind). */
  kind: stageKindSchema.optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateStageInput = z.infer<typeof updateStageSchema>;

/** Every stage id of the pipeline, in the order they should appear. */
export const reorderStagesSchema = z.object({
  stageIds: z.array(uuidSchema).min(1).max(STAGES_PER_PIPELINE_MAX),
});
export type ReorderStagesInput = z.infer<typeof reorderStagesSchema>;

/** A stage that still holds deals is deleted only with a stage of the same pipeline for them to move to. */
export const deleteStageQuerySchema = z.object({
  moveDealsToStageId: uuidSchema.optional(),
});
export type DeleteStageQuery = z.infer<typeof deleteStageQuerySchema>;

// --- lost reasons and deal settings (TW-DEAL-043, D-08) -------------------------------------------------------------------

export const LOST_REASON_NAME_MAX = 191;

export const lostReasonResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Deals currently lost with this reason. */
  dealCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LostReasonResponse = z.infer<typeof lostReasonResponseSchema>;

export const createLostReasonSchema = z.object({
  name: z.string().trim().min(1).max(LOST_REASON_NAME_MAX),
  isActive: z.boolean().optional(),
});
export type CreateLostReasonInput = z.infer<typeof createLostReasonSchema>;

export const updateLostReasonSchema = z.object({
  name: z.string().trim().min(1).max(LOST_REASON_NAME_MAX).optional(),
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateLostReasonInput = z.infer<typeof updateLostReasonSchema>;

export const reorderLostReasonsSchema = z.object({
  reasonIds: z.array(uuidSchema).min(1).max(200),
});
export type ReorderLostReasonsInput = z.infer<typeof reorderLostReasonsSchema>;

export const dealSettingsResponseSchema = z.object({
  /** When on, moving a deal to a lost stage (or marking it lost) needs a reason. */
  lostReasonRequired: z.boolean(),
  rowVersion: z.number().int(),
});
export type DealSettingsResponse = z.infer<typeof dealSettingsResponseSchema>;

export const updateDealSettingsSchema = z.object({
  lostReasonRequired: z.boolean(),
});
export type UpdateDealSettingsInput = z.infer<typeof updateDealSettingsSchema>;
