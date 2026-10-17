/** Public surface of the Facebook channel. Other domains import only from here. */
export { ChannelFacebookModule } from './channel-facebook.module';
export { ChannelFacebookWorkerModule } from './channel-facebook-worker.module';
// What the Meta lead ads door needs of a connected Page: its row (token sealed), and the sealed login that asks for the lead permissions.
export { PagesService as FacebookPagesService } from './pages.service';
export {
  PagesRepository as FacebookPagesRepository,
  type PageRow as FacebookPageRow,
} from './pages.repository';
export {
  SenderService as FacebookSenderService,
  type ThreadReply as FacebookThreadReply,
  type SendOutcome as FacebookSendOutcome,
} from './sender.service';
