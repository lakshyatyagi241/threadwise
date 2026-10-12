import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SMS_GATEWAY } from '../../infra/providers/channel-sms/sms.port';
import { SmsProviderGateway, smsEnvProvider } from '../../infra/providers/channel-sms/sms-gateway';
import { BroadcastsModule, EngineSenderRegistry } from '../broadcasts';
import { CampaignsModule } from '../campaigns';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { SmsAvailability } from './sms-availability.service';
import { SmsEngineSender } from './sms-engine.sender';
import { SmsPlatformController } from './sms-platform.controller';
import { SmsPlatformService } from './sms-platform.service';
import { SmsSendersController } from './sms-senders.controller';
import { SmsSendersRepository } from './sms-senders.repository';
import { SmsSendersService } from './sms-senders.service';
import { SmsStatusController } from './sms-status.controller';
import { SmsStatusService } from './sms-status.service';

/**
 * The SMS channel (TW-SMS), send-only: Twilio and MSG91 senders, the engine that broadcasts and campaigns send through, and the
 * delivery-report webhook. There is no receive path and no inbox thread.
 *
 * Imported by the API and by the worker: the engine must be registered in the process that sends. Whether the HTTP controllers
 * answer in the worker is harmless (it listens on no port).
 */
@Module({
  imports: [BroadcastsModule, CampaignsModule, PlansCoreModule],
  controllers: [SmsSendersController, SmsStatusController, SmsPlatformController],
  providers: [
    CryptoService,
    smsEnvProvider,
    SmsProviderGateway,
    { provide: SMS_GATEWAY, useExisting: SmsProviderGateway },
    SmsAvailability,
    SmsPlatformService,
    SmsSendersRepository,
    SmsSendersService,
    SmsStatusService,
    SmsEngineSender,
  ],
  exports: [SmsSendersService, SmsAvailability, SmsEngineSender],
})
export class ChannelSmsModule implements OnModuleInit {
  constructor(
    private readonly engines: EngineSenderRegistry,
    private readonly sender: SmsEngineSender,
  ) {}

  /** The `sms` engine had no adapter: a broadcast on it failed at dispatch. This is the adapter. */
  onModuleInit(): void {
    this.engines.register('sms', this.sender);
  }
}
