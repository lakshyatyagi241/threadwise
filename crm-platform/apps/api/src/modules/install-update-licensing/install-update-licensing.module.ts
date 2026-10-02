import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { INST_ENV, readInstEnv } from '../../config/domains/install-update-licensing.env';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { DatabaseTestService } from './database-test.service';
import { DemoModeGuard } from './demo-mode.guard';
import { InstallSettingsService } from './install-settings.service';
import { INST_FETCH, LicenceService } from './licence.service';
import { MigrationStateService } from './migration-state.service';
import { ReleaseInfoService } from './release-info.service';
import { RequirementsService } from './requirements.service';
import { SetupController } from './setup.controller';
import { SetupRepository } from './setup.repository';
import { SetupService } from './setup.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

/**
 * First-run setup, the operator Updater page and the live-demo guard (WD-INST).
 *
 * The auth barrel supplies the sanctioned doors to platform-wide data (PlatformStore, TenantDirectory), the platform
 * settings store and the operator guard; AuthModule is global, so its exports resolve here without an import. The
 * platform-settings domain supplies the typed "General" settings the wizard fills in. The environment is parsed once
 * at construction, so a malformed SETUP_TOKEN or an incomplete LICENCE_MODE stops the process at boot.
 */
@Module({
  imports: [PlatformSettingsModule],
  controllers: [SetupController, SystemController],
  providers: [
    { provide: INST_ENV, useFactory: () => readInstEnv(process.env) },
    { provide: INST_FETCH, useValue: (...args: Parameters<typeof fetch>) => fetch(...args) },
    SetupRepository,
    MigrationStateService,
    ReleaseInfoService,
    LicenceService,
    RequirementsService,
    DatabaseTestService,
    SetupService,
    SystemService,
    InstallSettingsService,
    // Registered here, enforced app-wide: APP_GUARD providers are global whichever module declares them.
    { provide: APP_GUARD, useClass: DemoModeGuard },
  ],
  exports: [InstallSettingsService],
})
export class InstallUpdateLicensingModule {}
