import { Module } from '@nestjs/common';
import { ConferencingReleaseConsumer } from './conferencing-release.consumer';
import { MeetingConferencingModule } from './meeting-conferencing.module';

/**
 * The outbox consumer that removes a meeting's video room and calendar event when the meeting no longer holds them (BL-361, BL-362).
 * Imported ONLY by WorkersModule (the worker process): a consumer registers itself with the kernel's OutboxSubscriberRegistry, which the
 * drain loop in that process fans events out to.
 */
@Module({
  imports: [MeetingConferencingModule],
  providers: [ConferencingReleaseConsumer],
})
export class MeetingConferencingWorkerModule {}
