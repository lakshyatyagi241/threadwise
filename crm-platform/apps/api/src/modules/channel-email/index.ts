/** Public surface of the channel-email domain. Other modules import from here, never from the files behind it. */
export { ChannelEmailModule } from './channel-email.module';
export { ChannelEmailWorkerModule } from './channel-email-worker.module';
export { MailPlan, MAIL_FEATURE } from './mail-plan';
