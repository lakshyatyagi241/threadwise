import { Module } from '@nestjs/common';
import { ChannelTelegramModule } from './channel-telegram.module';
import { TgBroadcastProcessor } from './tg-broadcast.processor';

/** The Telegram broadcast sender. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never send them. */
@Module({
  imports: [ChannelTelegramModule],
  providers: [TgBroadcastProcessor],
})
export class ChannelTelegramWorkerModule {}
