import { Module } from '@nestjs/common';
import { NotificationsRepository } from '../notifications';
import { LeadNotificationConsumer } from './lead-notification.consumer';
import { LeadRetentionSweepService } from './lead-retention-sweep.service';

/**
 * The outbox consumer that notifies people of a new lead and the sweep that purges raw payloads past their retention. Imported ONLY by
 * WorkersModule (the worker process): a consumer registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that
 * process fans events out to, and an API pod that also swept would multiply the polling load on the database.
 */
@Module({
  providers: [NotificationsRepository, LeadNotificationConsumer, LeadRetentionSweepService],
})
export class LeadsWorkerModule {}
