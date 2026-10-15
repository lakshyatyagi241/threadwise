import { Module } from '@nestjs/common';
import { ChannelLineModule } from './channel-line.module';
import { LineBroadcastProcessor } from './line-broadcast.processor';

/** The LINE broadcast sender. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never send them. */
@Module({
  imports: [ChannelLineModule],
  providers: [LineBroadcastProcessor],
})
export class ChannelLineWorkerModule {}
