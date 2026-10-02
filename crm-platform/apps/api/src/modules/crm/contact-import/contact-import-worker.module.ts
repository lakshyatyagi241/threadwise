import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { ContactImportProcessor } from './contact-import.processor';

/**
 * The con-import queue's processor. Imported ONLY by WorkersModule (the worker process): the
 * HTTP app enqueues import jobs but must never pick one up, so the processor is not part of
 * CrmModule.
 */
@Module({
  imports: [CrmModule],
  providers: [ContactImportProcessor],
})
export class ContactImportWorkerModule {}
