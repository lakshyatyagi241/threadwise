import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { INST_ENV, readInstEnv } from '../../config/domains/install-update-licensing.env';
import { DemoModeGuard } from './demo-mode.guard';
import { MigrationStateService } from './migration-state.service';
import { ReleaseInfoService } from './release-info.service';
import { SetupController } from './setup.controller';
import { SetupRepository } from './setup.repository';
import { SetupService } from './setup.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

/**
 * First-run setup, the operator System page and the live-demo guard (TW-INST).
 *
 * The auth barrel supplies the sanctioned doors to platform-wide data (PlatformStore, TenantDirectory) and the
 * operator guard; AuthModule is global, so its exports resolve here without an import. The environment is parsed
 * once at construction, so a malformed SETUP_TOKEN stops the process at boot.
 */
@Module({
  controllers: [SetupController, SystemController],
  providers: [
    { provide: INST_ENV, useFactory: () => readInstEnv(process.env) },
    SetupRepository,
    MigrationStateService,
    ReleaseInfoService,
    SetupService,
    SystemService,
    // Registered here, enforced app-wide: APP_GUARD providers are global whichever module declares them.
    { provide: APP_GUARD, useClass: DemoModeGuard },
  ],
})
export class InstallUpdateLicensingModule {}
