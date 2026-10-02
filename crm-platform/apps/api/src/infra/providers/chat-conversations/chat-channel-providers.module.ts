import { Module } from '@nestjs/common';
import { MetaCloudProvider } from '../whatsapp/meta-cloud.provider';
import {
  assertSimulatorBootSafe,
  simulatorAllowed,
} from '../../../config/domains/chat-conversations.env';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from './channel.port';
import { MetaCloudChannelAdapter } from './meta-cloud-channel.adapter';
import { SimulatorAdapter } from './simulator.adapter';
import { WebchatChannelAdapter } from './webchat-channel.adapter';

/**
 * Binds the channel adapters of this deployment under `CHANNEL_ADAPTERS`. `MetaCloudProvider` comes from the global providers module.
 *
 * The simulator is bound only when the flag is on and the environment is not production, and a production process that sets the
 * flag fails right here, at boot, instead of quietly ignoring it.
 */
@Module({
  providers: [
    {
      provide: CHANNEL_ADAPTERS,
      inject: [MetaCloudProvider],
      useFactory: (meta: MetaCloudProvider): ChannelAdapter[] => {
        assertSimulatorBootSafe();
        const adapters: ChannelAdapter[] = [
          new MetaCloudChannelAdapter(meta),
          new WebchatChannelAdapter(),
        ];
        if (simulatorAllowed()) adapters.push(new SimulatorAdapter());
        return adapters;
      },
    },
  ],
  exports: [CHANNEL_ADAPTERS],
})
export class ChatChannelProvidersModule {}
