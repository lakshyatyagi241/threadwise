import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { SlaService } from './sla.service';
import { SupportSlaScanService } from './support-sla-scan.service';
import { SupportStore } from './support-store';

/** Background work of the support desk (the SLA breach scan). Imported by WorkersModule only, never by the HTTP app. */
@Module({
  imports: [AuthModule],
  providers: [SupportStore, SlaService, SupportSlaScanService],
})
export class PlatformSupportDeskWorkerModule {}
