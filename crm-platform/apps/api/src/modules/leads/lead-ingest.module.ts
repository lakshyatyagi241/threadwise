import { Module } from '@nestjs/common';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { LEAD_INGEST } from './lead-ingest.port';
import { LeadIngestService } from './lead-ingest.service';
import { LEAD_SOURCE_DIRECTORY } from './lead-source-directory.port';
import { LeadSourceDirectoryService } from './lead-source-directory.service';
import { LeadAttributionsRepository } from './lead-attributions.repository';
import { LeadEventsRepository } from './lead-events.repository';
import { LeadsPlan } from './lead-plan';
import { LeadSourcesRepository } from './lead-sources.repository';

/**
 * The lead pipeline without any HTTP: the ingest service and the source directory, behind the `LEAD_INGEST` and `LEAD_SOURCE_DIRECTORY`
 * tokens. This is the module another domain imports (a marketplace connector, a channel); it brings the CRM and plans modules it needs
 * and no controller. The consumer injects the tokens and imports only the two leaf port files, never a class from here.
 */
@Module({
  imports: [CrmModule, PlansCoreModule, ContactConsentModule],
  providers: [
    LeadSourcesRepository,
    LeadEventsRepository,
    LeadAttributionsRepository,
    LeadsPlan,
    LeadIngestService,
    LeadSourceDirectoryService,
    { provide: LEAD_INGEST, useExisting: LeadIngestService },
    { provide: LEAD_SOURCE_DIRECTORY, useExisting: LeadSourceDirectoryService },
  ],
  exports: [
    LEAD_INGEST,
    LEAD_SOURCE_DIRECTORY,
    LeadIngestService,
    LeadSourcesRepository,
    LeadEventsRepository,
    LeadAttributionsRepository,
    LeadsPlan,
  ],
})
export class LeadIngestModule {}
