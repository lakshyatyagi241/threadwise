import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { readCampaignsEnv } from '../../../config/domains/campaigns.env';
import { EngineSenderRegistry } from '../../broadcasts';
import { FixtureEngineSender } from './fixture-engine-sender';
import { FixtureReceiptQueue } from './fixture-receipts';

/**
 * With `CAMP_PROVIDER_MODE=fixture`, the sandbox takes the Cloud API engine's place in the sender registry, in the API (a wizard test
 * send) and in the worker (runs and retries) alike. Without it nothing changes: the real sender stays.
 */
@Injectable()
export class FixtureRegistrar implements OnModuleInit {
  private readonly logger = new Logger(FixtureRegistrar.name);

  constructor(
    private readonly engines: EngineSenderRegistry,
    private readonly queue: FixtureReceiptQueue,
  ) {}

  onModuleInit(): void {
    if (readCampaignsEnv().CAMP_PROVIDER_MODE !== 'fixture') return;
    this.engines.register('waba', new FixtureEngineSender(this.queue));
    this.logger.warn(
      'CAMP_PROVIDER_MODE=fixture: WhatsApp Cloud API sends are simulated, nothing reaches Meta',
    );
  }
}
