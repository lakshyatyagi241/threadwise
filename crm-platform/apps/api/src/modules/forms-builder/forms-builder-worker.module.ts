import { Module } from '@nestjs/common';
import { NotificationPublisher, NotificationsRepository } from '../notifications';
import { FormNotificationConsumer } from './form-notification.consumer';
import { FormPaymentSweepService } from './form-payment-sweep.service';
import { FormPaymentsRepository } from './form-payments.repository';
import { FormRetentionSweepService } from './form-retention-sweep.service';

/**
 * The outbox consumer that notifies people of a form submission (in-app and email) and the daily sweep that purges answers past their
 * retention. Imported ONLY by WorkersModule (the worker process): a consumer registers itself with the kernel's OutboxSubscriberRegistry,
 * which the drain loop in that process fans events out to, and an API pod that also swept would multiply the polling load.
 */
@Module({
  providers: [
    NotificationsRepository,
    NotificationPublisher,
    FormNotificationConsumer,
    FormRetentionSweepService,
    FormPaymentsRepository,
    FormPaymentSweepService,
  ],
})
export class FormsBuilderWorkerModule {}
