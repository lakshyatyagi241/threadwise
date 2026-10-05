import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../../../infra/queue/queues';

export interface FlowRunJob {
  orgId: number;
  runId: number;
  /** The step this job is for: the worker does it only if the run is still at this step. */
  seq: number;
}

/** BullMQ forbids ':' in a custom job id. */
export const stepJobId = (orgId: number, runId: number, seq: number) =>
  `flr-${orgId}-${runId}-${seq}`;

/**
 * Queues the next step of a run. The job carries no state: the worker reads the run and does the step only if the run is still at
 * the step number in the job id, so a duplicate, a late or a replayed job is a no-op. Queueing is after the commit; a crash between
 * the two leaves a `running` run with no job, which the sweeper finds and queues again.
 */
@Injectable()
export class FlowRunPublisher {
  constructor(@InjectQueue(QUEUES.FLOW_RUN) private readonly queue: Queue<FlowRunJob>) {}

  async schedule(orgId: number, runId: number, seq: number, delayMs = 0): Promise<void> {
    const old = await this.queue.getJob(stepJobId(orgId, runId, seq));
    if (old) {
      const state = await old.getState();
      // A finished job with this id would swallow the new one (BullMQ keeps its id): when a step is queued again it must really run.
      if (state === 'completed' || state === 'failed') await old.remove().catch(() => undefined);
      // A step still waiting out its delay but wanted now (the run is due and the sweeper found it): bring it forward.
      else if (state === 'delayed' && delayMs <= 0) {
        await old.promote().catch(() => undefined);
        return;
      } else return;
    }
    await this.queue.add(
      'step',
      { orgId, runId, seq },
      { jobId: stepJobId(orgId, runId, seq), delay: Math.max(0, Math.round(delayMs)), attempts: 3 },
    );
  }

  /** Drops a queued step (a run cancelled or replaced): best effort, the step number check is what really stops it. */
  async drop(orgId: number, runId: number, seq: number): Promise<void> {
    const job = await this.queue.getJob(stepJobId(orgId, runId, seq));
    await job?.remove().catch(() => undefined);
  }
}
