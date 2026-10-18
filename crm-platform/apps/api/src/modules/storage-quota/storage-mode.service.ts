import { Injectable, Logger } from '@nestjs/common';
import { STORAGE_MODE_SETTING_KEY, type StorageMode } from '@crm/contracts';
import { PlatformSettingsService } from '../auth';
import { effectiveMode } from './storage-quota.rules';

/**
 * Which mode the storage guard runs in: the platform setting `storage.quota.mode` (`off` | `observe` | `enforce`), read through the
 * 5-second snapshot of `PlatformSettingsService`. A missing row is `observe` (the default of phases S0 and S1).
 *
 * `enforce` is not built (phase S2). A build that finds the value anyway runs as `observe` and says so once in the log, so setting it
 * early cannot start refusing uploads. A failed read of the setting is `observe` too: the guard may measure, it may never be the reason
 * a read of a setting fails a file write.
 */
@Injectable()
export class StorageModeService {
  private readonly logger = new Logger(StorageModeService.name);
  private warnedEnforce = false;

  constructor(private readonly settings: PlatformSettingsService) {}

  /** The raw value as stored, for the console. */
  async configured(): Promise<StorageMode> {
    try {
      const raw = await this.settings.get<unknown>(STORAGE_MODE_SETTING_KEY);
      return raw === 'off' || raw === 'enforce' ? raw : 'observe';
    } catch {
      return 'observe';
    }
  }

  /** The mode the guard acts in. */
  async current(): Promise<'off' | 'observe'> {
    const configured = await this.configured();
    if (configured === 'enforce' && !this.warnedEnforce) {
      this.warnedEnforce = true;
      this.logger.warn(
        `${STORAGE_MODE_SETTING_KEY}=enforce is not available in this build (phase S2); running in observe mode, nothing is refused`,
      );
    }
    return effectiveMode(configured);
  }
}
