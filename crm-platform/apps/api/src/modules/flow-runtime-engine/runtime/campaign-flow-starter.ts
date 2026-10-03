import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { FlowRunPublisher } from './flow-run.publisher';
import { FlowLaunchService } from './launch.service';

/** Gives the caller's own transaction time to commit before the first step of the run is looked for. */
const COMMIT_GRACE_MS = 5_000;

/**
 * Starts a flow for one campaign recipient (TW-FLR-010 rule 2). Runs in the campaign's transaction, so a recipient the campaign marks
 * sent and the run it started stand or fall together. The first step is queued a few seconds out, after that transaction has
 * committed; if it ever runs early it finds no run and stops, and the sweeper queues a run that has no step again.
 *
 * Reference's version marked a recipient `sent` the moment Node accepted the request and wrote no run row, so a flow campaign could not
 * be counted or retried; here the run is written with `source = campaign`.
 */
@Injectable()
export class CampaignFlowStarterImpl {
  readonly available = true;

  constructor(
    private readonly launch: FlowLaunchService,
    private readonly publisher: FlowRunPublisher,
  ) {}

  async start(
    tx: Tx,
    orgId: number,
    input: { flowId: number; contactId: number; campaignId: number; variant: string | null },
  ): Promise<{ ok: boolean; error: string | null }> {
    try {
      const out = await this.launch.startIn(tx, orgId, {
        flowId: input.flowId,
        contactId: input.contactId,
        source: 'campaign',
        triggerRef: `campaign:${input.campaignId}`,
        campaignId: input.campaignId,
        variant: input.variant,
        requirePublished: true,
        withSubscriber: true,
      });
      if (out.outcome === 'started') {
        await this.publisher.schedule(orgId, out.runId, 0, COMMIT_GRACE_MS);
        return { ok: true, error: null };
      }
      if (out.outcome === 'already_enrolled') return { ok: true, error: null };
      return { ok: false, error: out.reason };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
