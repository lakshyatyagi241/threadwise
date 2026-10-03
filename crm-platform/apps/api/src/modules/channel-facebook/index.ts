/** Public surface of the Facebook channel. Other domains import only from here. */
export { ChannelFacebookModule } from './channel-facebook.module';
export { ChannelFacebookWorkerModule } from './channel-facebook-worker.module';
export {
  SenderService as FacebookSenderService,
  type ThreadReply as FacebookThreadReply,
  type SendOutcome as FacebookSendOutcome,
} from './sender.service';
