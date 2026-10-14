import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { OwnerRestoreSweepService } from './owner-restore-sweep.service';

/** The automatic return of reassigned contacts (BL-112). Imported ONLY by WorkersModule: an API pod that also swept would multiply the load. */
@Module({
  imports: [CrmModule],
  providers: [OwnerRestoreSweepService],
})
export class OwnerReassignWorkerModule {}
