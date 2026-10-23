import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SMS_GATEWAY } from '../../infra/providers/channel-sms/sms.port';
import { SmsProviderGateway, smsEnvProvider } from '../../infra/providers/channel-sms/sms-gateway';
import { BroadcastsModule, EngineSenderRegistry } from '../broadcasts';
import { CampaignsModule } from '../campaigns';
import { ContactConsentModule } from '../contact-consent';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { SmsAvailability } from './sms-availability.service';
import { SmsEngineSender } from './sms-engine.sender';
import { SmsPlatformController } from './sms-platform.controller';
import { SmsPlatformService } from './sms-platform.service';
import { SmsSendersController } from './sms-senders.controller';
import { SmsSendersRepository } from './sms-senders.repository';
import { SmsSendersService } from './sms-senders.service';
import { SmsStatusController } from './sms-status.controller';
import { SmsStatusService } from './sms-status.service';
import { SmsUsageReporter } from './sms-usage.reporter';

/**
 * The SMS channel (TW-SMS), send-only: Twilio and MSG91 senders, the engine that broadcasts and campaigns send through, and the
 * delivery-report webhook. There is no receive path and no inbox thread.
 *
 * Imported by the API and by the worker: the engine must be registered in the process that sends. Whether the HTTP controllers
 * answer in the worker is harmless (it listens on no port).
 *
 * Every SMS is paid for from the workspace's wallet: the engine asks the wallet module whether it can pay before a message is sent and
 * reports the accepted one (`usage.reported`); the worker's billing consumer, registered by the wallet's own worker module, takes the
 * money. The delivery-report webhook reports a failed message so its charge is given back.
 */
@Module({
  imports: [
    BroadcastsModule,
    CampaignsModule,
    ContactConsentModule,
    PlansCoreModule,
    WalletMessageBillingModule,
  ],
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
    SmsUsageReporter,
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
