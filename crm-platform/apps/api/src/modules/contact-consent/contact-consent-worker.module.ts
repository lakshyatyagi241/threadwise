import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { ContactConsentModule } from './contact-consent.module';
import { ConsentKeywordListener } from './consent-keyword.listener';

/** What only the worker runs: the STOP / START listener on the shared inbound path. Imported ONLY by WorkersModule. */
@Module({
  imports: [ContactConsentModule, ChatConversationsModule],
  providers: [ConsentKeywordListener],
})
export class ContactConsentWorkerModule {}
