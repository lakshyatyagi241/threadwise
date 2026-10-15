/** Public surface of the LINE channel. Other domains import only from here. */
export { ChannelLineModule } from './channel-line.module';
export { LineSenderService, type ThreadReply } from './line-sender.service';
export type { Outcome as LineSendOutcome } from './line-sender.service';
export { ChannelLineWorkerModule } from './channel-line-worker.module';
