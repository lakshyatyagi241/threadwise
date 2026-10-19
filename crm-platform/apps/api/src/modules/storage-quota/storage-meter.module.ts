import { Global, Module } from '@nestjs/common';
import { STORAGE_METER } from '../../common/storage-meter/storage-meter.port';
import { StorageMeterService } from './storage-meter.service';
import { StorageModeService } from './storage-mode.service';
import { StorageQuotaRepository } from './storage-quota.repository';

/**
 * The storage meter, bound to `STORAGE_METER` for every process (the HTTP app and the worker import it). Global, because the write doors
 * (`ChatMediaStore`, `MediaStorageService`, the training file store, team chat) inject the token as optional and may not import this
 * module (see `common/storage-meter/storage-meter.port.ts`). It needs only the database, the platform settings (auth, global) and nothing
 * from the plans domain: deciding to REFUSE is phase S2's job and will bring that dependency with it.
 */
@Global()
@Module({
  providers: [
    StorageQuotaRepository,
    StorageModeService,
    StorageMeterService,
    { provide: STORAGE_METER, useExisting: StorageMeterService },
  ],
  exports: [STORAGE_METER, StorageMeterService, StorageModeService, StorageQuotaRepository],
})
export class StorageMeterModule {}
