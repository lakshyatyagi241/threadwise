import { Module } from '@nestjs/common';
import { RolesPermissionsModule } from '../roles-permissions';
import { PlatformStorageController } from './platform-storage.controller';
import { StorageFleetService } from './storage-fleet.service';
import { StorageMeterModule } from './storage-meter.module';

/**
 * The storage quota's HTTP side (phase S1): the operator's read-only fleet and workspace views. The meter itself is `StorageMeterModule`
 * (global); the backfill, the counter check and the reaper are `StorageQuotaWorkerModule` (worker only).
 */
@Module({
  imports: [StorageMeterModule, RolesPermissionsModule],
  controllers: [PlatformStorageController],
  providers: [StorageFleetService],
  exports: [StorageFleetService],
})
export class StorageQuotaModule {}
