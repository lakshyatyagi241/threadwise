import { Module } from '@nestjs/common';
import { MetaCloudChannelAdapter, WhatsappCloudModule } from '../whatsapp';
import {
  assertSimulatorBootSafe,
  simulatorAllowed,
} from '../../../config/domains/chat-conversations.env';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from './channel.port';
import { SimulatorAdapter } from './simulator.adapter';
import { WebchatChannelAdapter } from './webchat-channel.adapter';

/**
 * Binds the channel adapters of this deployment under `CHANNEL_ADAPTERS`. The WhatsApp Cloud adapter is built by `WhatsappCloudModule`.
 *
 * The simulator is bound only when the flag is on and the environment is not production, and a production process that sets the
 * flag fails right here, at boot, instead of quietly ignoring it.
 */
@Module({
  imports: [WhatsappCloudModule],
  providers: [
    {
      provide: CHANNEL_ADAPTERS,
      inject: [MetaCloudChannelAdapter],
      useFactory: (meta: MetaCloudChannelAdapter): ChannelAdapter[] => {
        assertSimulatorBootSafe();
        const adapters: ChannelAdapter[] = [meta, new WebchatChannelAdapter()];
        if (simulatorAllowed()) adapters.push(new SimulatorAdapter());
        return adapters;
      },
    },
  ],
  exports: [CHANNEL_ADAPTERS],
})
export class ChatChannelProvidersModule {}
