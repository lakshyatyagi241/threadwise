import { Injectable } from '@nestjs/common';
import type { CampaignFlowStarter } from './tokens';

/** No flow runtime yet: a flow campaign cannot start sessions, so its recipients fail with the reason. */
@Injectable()
export class NoFlowStarter implements CampaignFlowStarter {
  readonly available = false;

  start(): Promise<{ ok: boolean; error: string | null }> {
    return Promise.resolve({
      ok: false,
      error: 'Flow campaigns need the flow runtime, which is not available yet.',
    });
  }
}
