import { Module } from '@nestjs/common';
import { ChannelWechatModule } from './channel-wechat.module';
import { BroadcastProcessor } from './broadcast.processor';

/** The WeChat broadcast sender. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never send them. */
@Module({
  imports: [ChannelWechatModule],
  providers: [BroadcastProcessor],
})
export class ChannelWechatWorkerModule {}
