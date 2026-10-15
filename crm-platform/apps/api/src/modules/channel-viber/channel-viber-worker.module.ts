import { Module } from '@nestjs/common';
import { ChannelViberModule } from './channel-viber.module';
import { VibBroadcastProcessor } from './vib-broadcast.processor';

/** The Viber broadcast sender. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never send them. */
@Module({
  imports: [ChannelViberModule],
  providers: [VibBroadcastProcessor],
})
export class ChannelViberWorkerModule {}
