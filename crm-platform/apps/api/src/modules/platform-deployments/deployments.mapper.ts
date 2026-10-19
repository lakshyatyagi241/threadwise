import {
  DEPLOYMENT_ERROR_MAX_CHARS,
  deploymentRowSchema,
  publishRowSchema,
  type DeploymentCounts,
  type DeploymentRow,
  type PublishCounts,
  type PublishRow,
} from '@crm/contracts';
import type { Raw } from './deployments.store';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const cut = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v).slice(0, DEPLOYMENT_ERROR_MAX_CHARS);

/** One stored row to the wire shape. The error is cut here, so no longer text ever leaves the API. */
export function toDeploymentRow(r: Raw): DeploymentRow {
  return deploymentRowSchema.parse({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    workspaceName: String(r.workspace_name),
    flowId: String(r.flow_id),
    flowName: String(r.flow_name),
    publishVersion: Number(r.publish_version),
    status: r.status,
    step: r.step ?? null,
    failedStep: r.failed_step ?? null,
    lastError: cut(r.last_error),
    attemptedAt: iso(r.attempted_at),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    stalled: r.stalled === true,
  });
}

export function toDeploymentCounts(r: Raw): DeploymentCounts {
  return {
    running: Number(r.running ?? 0),
    queued: Number(r.queued ?? 0),
    failed: Number(r.failed ?? 0),
    live: Number(r.live ?? 0),
    stalled: Number(r.stalled ?? 0),
  };
}

/** One flow publish (outbox event) to the wire shape. The error is cut here, as for Geta deployments. */
export function toPublishRow(r: Raw): PublishRow {
  return publishRowSchema.parse({
    workspaceId: String(r.workspace_id),
    workspaceName: String(r.workspace_name),
    flowId: String(r.flow_id),
    flowName: String(r.flow_name),
    status: r.publish_status,
    attempts: Number(r.attempts ?? 0),
    lastError: cut(r.last_error),
    queuedAt: new Date(r.queued_at as string).toISOString(),
    processedAt: iso(r.processed_at),
    stalled: r.stalled === true,
  });
}

export function toPublishCounts(r: Raw): PublishCounts {
  return {
    running: Number(r.running ?? 0),
    queued: Number(r.queued ?? 0),
    failed: Number(r.failed ?? 0),
    done: Number(r.done ?? 0),
    stalled: Number(r.stalled ?? 0),
  };
}
