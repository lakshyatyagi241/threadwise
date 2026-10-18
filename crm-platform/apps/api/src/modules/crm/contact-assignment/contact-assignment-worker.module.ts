import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { AssignmentRunSweepService } from './assignment-run-sweep.service';
import { ContactAssignmentConsumer } from './contact-assignment.consumer';
import { ContactAssignmentRepository } from './contact-assignment.repository';

/**
 * The consumer that auto-assigns contacts, companies and deals (BL-013, BL-340..345) and the sweep that keeps its run log to 90 days.
 * Imported ONLY by WorkersModule (the outbox drain runs there).
 */
@Module({
  imports: [CrmModule],
  providers: [ContactAssignmentConsumer, ContactAssignmentRepository, AssignmentRunSweepService],
})
export class ContactAssignmentWorkerModule {}
