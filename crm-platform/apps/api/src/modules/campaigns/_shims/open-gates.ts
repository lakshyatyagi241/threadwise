import { Injectable } from '@nestjs/common';
import type {
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
