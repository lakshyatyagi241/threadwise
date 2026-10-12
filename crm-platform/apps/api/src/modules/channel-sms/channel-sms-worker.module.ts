import { Module } from '@nestjs/common';
import { ChannelSmsModule } from './channel-sms.module';

/**
 * Registers the SMS engine in the worker process, where the broadcast and campaign dispatchers run. SMS has no processor of its
 * own: it sends through them. Imported ONLY by WorkersModule.
 */
@Module({ imports: [ChannelSmsModule] })
export class ChannelSmsWorkerModule {}
