import { Injectable } from '@nestjs/common';
import type { CampaignFlowStarter } from './tokens';

/**
 * The flow runtime plugs in here (`use`). Until it has (the HTTP process never runs a campaign), a flow campaign cannot start
 * sessions, so its recipients fail with the reason.
 */
@Injectable()
export class NoFlowStarter implements CampaignFlowStarter {
  private delegate: CampaignFlowStarter | null = null;

  /** Bound by the flow runtime's worker module when it starts. */
  use(starter: CampaignFlowStarter): void {
    this.delegate = starter;
  }

  get available(): boolean {
    return this.delegate?.available ?? false;
  }

  start(
    tx: Parameters<CampaignFlowStarter['start']>[0],
    orgId: number,
    input: Parameters<CampaignFlowStarter['start']>[2],
  ): Promise<{ ok: boolean; error: string | null }> {
    if (this.delegate) return this.delegate.start(tx, orgId, input);
    return Promise.resolve({
      ok: false,
      error: 'Flow campaigns need the flow runtime, which is not available yet.',
    });
  }
}
