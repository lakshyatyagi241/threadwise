import { Module } from '@nestjs/common';
import { ChannelEmailModule } from './channel-email.module';
import { MAIL_WORKER_PROVIDERS } from './module-parts';
import { MailSyncProcessor } from './mail-sync.processor';
import { MailSyncSweep } from './mail-sync.sweep';

/** The mailbox sync job and its 60 second sweep. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never run them. */
@Module({
  imports: [ChannelEmailModule],
  providers: [MailSyncProcessor, MailSyncSweep, ...MAIL_WORKER_PROVIDERS],
})
export class ChannelEmailWorkerModule {}
