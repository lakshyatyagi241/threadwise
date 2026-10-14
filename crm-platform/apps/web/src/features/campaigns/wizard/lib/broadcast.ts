import {
  RESENDABLE_STATUSES,
  type CampaignStatus,
  type WizardBroadcastDetail,
} from '@crm/contracts';
import { can } from '../../lib/list-model';

export type ControlAction = 'pause' | 'resume' | 'cancel';

/**
 * Which controls a broadcast offers in its status. A series (recurring): active can be paused or cancelled, paused resumed or
 * cancelled. A campaign (now, scheduled): scheduled can be cancelled, running paused or cancelled, paused resumed or cancelled.
 * Ended work (completed, ended, cancelled, failed) has none.
 */
export function controlsFor(b: Pick<WizardBroadcastDetail, 'kind' | 'status'>): ControlAction[] {
  switch (b.status) {
    case 'active':
    case 'running':
      return ['pause', 'cancel'];
    case 'paused':
      return ['resume', 'cancel'];
    case 'scheduled':
    case 'queued':
      return b.kind === 'campaign' ? ['cancel'] : ['pause', 'cancel'];
    default:
      return [];
  }
}

/**
 * How many failed recipients "Retry failed" would send to. The API refuses a run that is still going, and a series never restarts a
 * run that was cancelled (a one-off campaign can be resent after a cancel, as it can from its campaign page), so the button counts only
 * what it can act on. Zero hides the button.
 */
export function retryableFailed(b: Pick<WizardBroadcastDetail, 'kind' | 'runList'>): number {
  const ok: readonly string[] = b.kind === 'series' ? ['completed', 'failed'] : RESENDABLE_STATUSES;
  return b.runList.filter((r) => ok.includes(r.status)).reduce((n, r) => n + r.counts.failed, 0);
}

/**
 * Whether Delete is offered. A one-off broadcast follows the campaign rule (still waiting for its time, or failed outright). A recurring
 * series can go while none of its runs has sent a message or is going right now, whatever its own status: once a run has sent, its
 * history is kept and the series is only cancelled. The API makes the same decision; this just hides a button that would be refused.
 */
export function deletable(b: Pick<WizardBroadcastDetail, 'kind' | 'status' | 'runList'>): boolean {
  if (b.kind === 'campaign') return can.delete(b.status as CampaignStatus);
  return b.runList.every((r) => r.status !== 'running' && r.counts.sent === 0);
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand';
export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'active':
    case 'running':
    case 'completed':
      return 'success';
    case 'scheduled':
    case 'queued':
      return 'brand';
    case 'paused':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The broadcast's own page for a run: the campaign detail screen. */
export const runPath = (runId: string): string => `/campaigns/${runId}`;
