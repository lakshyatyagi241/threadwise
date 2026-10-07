import { Injectable } from '@nestjs/common';
import type { SetTestResult } from '@crm/contracts';
import { ObjectStorageProbe } from '../../infra/providers/platform-settings-branding-storage/object-storage.probe';
import { SettingsService } from './settings.service';

/** WD-SET-039: check the SAVED storage credentials against the real provider. */
@Injectable()
export class ConnectionTestsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly storage: ObjectStorageProbe,
  ) {}

  async storageTest(): Promise<SetTestResult> {
    const v = await this.settings.values('storage');
    return this.storage.probe({
      provider: v.provider,
      basePath: v.basePath,
      accessKeyId: v.accessKeyId,
      region: v.region,
      bucket: v.bucket,
      endpoint: v.endpoint,
      pathStyle: v.pathStyle,
      storageZone: v.storageZone,
      secret: await this.settings.secret('storage', 'secret'),
      storagePassword: await this.settings.secret('storage', 'storagePassword'),
    });
  }
}
