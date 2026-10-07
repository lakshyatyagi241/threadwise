import type { WizardBroadcastDetail } from '@crm/contracts';

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
