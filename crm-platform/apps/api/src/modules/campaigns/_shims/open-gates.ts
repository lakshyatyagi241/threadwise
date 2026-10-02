import { Injectable } from '@nestjs/common';
import type {
  BilledSend,
  CampaignBilling,
  CampaignFlowStarter,
  CampaignPlanGate,
  CampaignSettings,
  CampaignSettingsSource,
} from './tokens';

/**
 * The `campaign` flag and `total_campaigns_limit` are not in the plan catalogue yet (only `broadcasts` and the other numeric caps
 * are), so every check passes.
 */
@Injectable()
export class OpenCampaignPlanGate implements CampaignPlanGate {
  assertEnabled(): Promise<void> {
    return Promise.resolve();
  }

  assertWithinCap(): Promise<void> {
    return Promise.resolve();
  }
}

/** No wallet integration yet: every send is allowed and nothing is charged or refunded. */
@Injectable()
export class OpenCampaignBilling implements CampaignBilling {
  consume(_send: BilledSend): Promise<boolean> {
    return Promise.resolve(true);
  }

  settleDelivered(): Promise<void> {
    return Promise.resolve();
  }

  settleFailed(): Promise<void> {
    return Promise.resolve();
  }
}

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

/** WaDesk's defaults until the settings domain exposes the real values. */
@Injectable()
export class DefaultCampaignSettings implements CampaignSettingsSource {
  get(): Promise<CampaignSettings> {
    return Promise.resolve({
      retryAttempts: 3,
      retryBackoffSec: 60,
      autoExpiryEnabled: true,
      defaultExpiryHours: 24,
    });
  }
}
