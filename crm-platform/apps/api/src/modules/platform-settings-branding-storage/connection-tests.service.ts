import { Injectable } from '@nestjs/common';
import type { SetTestResult } from '@crm/contracts';
import { ObjectStorageProbe } from '../../infra/providers/platform-settings-branding-storage/object-storage.probe';
import { PusherProbe } from '../../infra/providers/platform-settings-branding-storage/pusher.probe';
import { SettingsService } from './settings.service';

/** TW-SET-039 and 041: check the SAVED storage and real-time credentials against the real provider. */
@Injectable()
export class ConnectionTestsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly storage: ObjectStorageProbe,
    private readonly pusher: PusherProbe,
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

  async realtimeTest(): Promise<SetTestResult> {
    const v = await this.settings.values('realtime');
    return this.pusher.probe({
      appId: v.appId,
      key: v.appKey,
      secret: (await this.settings.secret('realtime', 'appSecret')) ?? '',
      cluster: v.cluster,
    });
  }
}
