import { z } from 'zod';
import { getaPublishStepSchema } from '../flow-builder-editor/geta-publish';

/**
 * Operator dashboard of deployments: every flow published to the Geta console, with the exact state of its publish.
 *
 * - `queued`: pending, and no step has started yet (waiting for the worker).
 * - `running`: pending, a step is in progress (`step` names it).
 * - `failed`: a call to Geta failed (`failedStep`, `lastError`). Retry is the editor's job; this page only shows it.
 * - `live`: both calls answered 2xx.
 * `stalled` is set on a pending row that has not changed for `DEPLOYMENT_STALL_MINUTES`: its worker most likely died mid-step.
 * Idle rows (a per-flow record with nothing to push) are not deployments and are never listed.
 */
export const DEPLOYMENT_STATUSES = ['running', 'queued', 'failed', 'live'] as const;
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

export const DEPLOYMENT_STALL_MINUTES = 10;
/** What the dashboard keeps of a Geta error; the full text stays server-side. */
export const DEPLOYMENT_ERROR_MAX_CHARS = 300;
export const DEPLOYMENT_LIST_MAX = 500;

export const deploymentsQuerySchema = z.object({
  status: deploymentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(DEPLOYMENT_LIST_MAX).default(200),
});
export type DeploymentsQuery = z.infer<typeof deploymentsQuerySchema>;

export const deploymentRowSchema = z.object({
  /** The publish-sync record's uuid. */
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  flowId: z.string().uuid(),
  flowName: z.string(),
  publishVersion: z.number().int().nonnegative(),
  status: deploymentStatusSchema,
  step: getaPublishStepSchema.nullable(),
  failedStep: getaPublishStepSchema.nullable(),
  lastError: z.string().nullable(),
  attemptedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  stalled: z.boolean(),
});
export type DeploymentRow = z.infer<typeof deploymentRowSchema>;

export const deploymentCountsSchema = z.object({
  running: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  stalled: z.number().int().nonnegative(),
});
export type DeploymentCounts = z.infer<typeof deploymentCountsSchema>;

export const deploymentsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  /** Totals over every deployment, whatever the status filter. */
  counts: deploymentCountsSchema,
  /** Running first, then queued, failed and live; newest change first inside a status. */
  rows: z.array(deploymentRowSchema),
  /** More deployments match than `limit` returned: filter by status to see them. */
  truncated: z.boolean(),
});
export type DeploymentsResponse = z.infer<typeof deploymentsResponseSchema>;
