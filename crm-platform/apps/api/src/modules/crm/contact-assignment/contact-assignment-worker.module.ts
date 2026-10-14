import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { ContactAssignmentConsumer } from './contact-assignment.consumer';

/** The consumer that auto-assigns new contacts and deals (BL-013). Imported ONLY by WorkersModule (the outbox drain runs there). */
@Module({
  imports: [CrmModule],
  providers: [ContactAssignmentConsumer],
})
export class ContactAssignmentWorkerModule {}
