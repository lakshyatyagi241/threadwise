import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { ContactConsentModule } from './contact-consent.module';
import { ConsentExportProcessor } from './consent-export.processor';
import { ConsentExportRepository } from './consent-export.repository';
import { ConsentExportRunner } from './consent-export.runner';
import { ConsentExportSweepService } from './consent-export-sweep.service';
import { ConsentKeywordListener } from './consent-keyword.listener';
import { ConsentRepository } from './consent.repository';

/** What only the worker runs: the STOP / START listener on the shared inbound path and the consent proof export builder. Imported ONLY by WorkersModule. */
@Module({
  imports: [ContactConsentModule, ChatConversationsModule],
  providers: [
    ConsentKeywordListener,
    // The export builder (`consent-export`) and its daily sweep; the repositories are stateless SQL, provided here for the runner.
    ConsentRepository,
    ConsentExportRepository,
    ConsentExportRunner,
    ConsentExportProcessor,
    ConsentExportSweepService,
  ],
})
export class ContactConsentWorkerModule {}
