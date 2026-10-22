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

/**
 * Flow publishes: every `flow.published` event on the outbox, with the state the worker has left it in. A flow publish is a deployment
 * too: it counts as published when its event is handled, and it is queued, running, failed (the event ran out of retries) or done.
 * `stalled` is set on a queued or running event older than `DEPLOYMENT_STALL_MINUTES`: the worker is not draining the outbox.
 * Done events older than 30 days are left out; anything still in the queue or failed is always listed.
 */
export const PUBLISH_STATUSES = ['running', 'queued', 'failed', 'done'] as const;
export const publishStatusSchema = z.enum(PUBLISH_STATUSES);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

export const PUBLISH_DONE_WINDOW_DAYS = 30;

export const publishesQuerySchema = z.object({
  status: publishStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(DEPLOYMENT_LIST_MAX).default(200),
});
export type PublishesQuery = z.infer<typeof publishesQuerySchema>;

export const publishRowSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  flowId: z.string().uuid(),
  flowName: z.string(),
  status: publishStatusSchema,
  /** Delivery attempts the worker has made so far (0 while it has not started). */
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  queuedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  stalled: z.boolean(),
});
export type PublishRow = z.infer<typeof publishRowSchema>;

export const publishCountsSchema = z.object({
  running: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  stalled: z.number().int().nonnegative(),
});
export type PublishCounts = z.infer<typeof publishCountsSchema>;

export const publishesResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  counts: publishCountsSchema,
  rows: z.array(publishRowSchema),
  truncated: z.boolean(),
});
export type PublishesResponse = z.infer<typeof publishesResponseSchema>;

/**
 * Product releases: the blue-green releases of desk-api and desk-web, one row per attempt (a build and the release it leads to share the
 * attempt id). `building`, `shipping` and `releasing` are in progress; `ok` is live; `failed` stopped before traffic moved;
 * `rolled_back` moved traffic back to the previous slot. `stalled` is set on an attempt in progress with no change for
 * `RELEASE_STALL_MINUTES`: the build or the release most likely died.
 */
export const RELEASE_STATES = [
  'building',
  'shipping',
  'releasing',
  'ok',
  'failed',
  'rolled_back',
] as const;
export const releaseStateSchema = z.enum(RELEASE_STATES);
export type ReleaseState = z.infer<typeof releaseStateSchema>;

export const RELEASE_STALL_MINUTES = 45;
export const RELEASE_LIST_MAX = 50;

/** One pull request a release carries, as the build server read it from the git history (`pr` is null for a commit not made from a PR). */
export const releaseChangeSchema = z.object({
  pr: z.number().int().positive().nullable(),
  title: z.string().max(200),
  author: z.string().max(100),
});
export type ReleaseChange = z.infer<typeof releaseChangeSchema>;
export const RELEASE_CHANGES_MAX = 20;

export const releaseRowSchema = z.object({
  /** The attempt id (uuid), shared by the build's steps and the release's steps. */
  id: z.string().uuid(),
  tag: z.string(),
  state: releaseStateSchema,
  /** The step in progress or the one that ended the attempt (`build`, `ship`, `start`, `dump`, `schema`, `idle`, `switch`, `worker`, `commit`). */
  step: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  stalled: z.boolean(),
  /** What the release carries: the pull requests merged since the previous release, newest first. Empty for releases recorded before this was kept. */
  changes: z.array(releaseChangeSchema).max(RELEASE_CHANGES_MAX),
});
export type ReleaseRow = z.infer<typeof releaseRowSchema>;

export const releasesResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  /** The most recent release that is live (state `ok`), or null before the first one. */
  live: z.object({ tag: z.string(), finishedAt: z.string().datetime() }).nullable(),
  /** Some attempt is building, shipping or releasing right now. */
  inProgress: z.boolean(),
  /** The newest attempts first, at most `RELEASE_LIST_MAX`. */
  rows: z.array(releaseRowSchema),
});
export type ReleasesResponse = z.infer<typeof releasesResponseSchema>;
