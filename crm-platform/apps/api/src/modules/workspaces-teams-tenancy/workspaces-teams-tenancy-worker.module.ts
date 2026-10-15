import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { LeaveSweepService } from './leave/leave-sweep.service';
import { LifecycleNotificationConsumer } from './lifecycle/lifecycle-notification.consumer';
import { LifecycleRepository } from './lifecycle/lifecycle.repository';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { LifecycleSweepService } from './lifecycle/lifecycle-sweep.service';
import { StoragePurgeService } from './lifecycle/storage-purge.service';

/**
 * The leave sweep (BL-112: starts and ends member leave on the workspace's own calendar), the daily inactivity sweep (remind, archive, erase) the consumer that tells the workspace's owner and admins, and the purge of an erased workspace's files. Imported ONLY by
 * WorkersModule (the worker process): the consumer registers itself with the kernel's OutboxSubscriberRegistry, and an API pod that also
 * swept would multiply the load. ADR-0028.
 */
@Module({
  imports: [PlatformSettingsModule],
  providers: [
    LifecycleRepository,
    LifecycleService,
    LifecycleSweepService,
    LeaveSweepService,
    LifecycleNotificationConsumer,
    StoragePurgeService,
  ],
})
export class WorkspacesTeamsTenancyWorkerModule {}
