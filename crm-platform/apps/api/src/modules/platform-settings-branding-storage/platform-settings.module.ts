import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthProvidersModule } from '../../infra/providers/auth-registration-security/auth-providers.module';
import { ObjectStorageProbe } from '../../infra/providers/platform-settings-branding-storage/object-storage.probe';
import { PusherProbe } from '../../infra/providers/platform-settings-branding-storage/pusher.probe';
import { ConnectionTestsService } from './connection-tests.service';
import { MailRuntimeService } from './mail-runtime.service';
import { MaintenanceGuard } from './maintenance.guard';
import { ProjectionService } from './projection.service';
import { SitePublicController } from './public.controller';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Platform system settings, branding, storage, real-time, mail and SEO (TW-SET). Depends on the auth module
 * (global, through its barrel) for the operator guard, the audit writer and the platform settings store;
 * registered in app.module.ts. Exports the typed reader so other domains consume settings through one door.
 */
@Module({
  imports: [AuthProvidersModule],
  controllers: [SettingsController, SitePublicController],
  providers: [
    SettingsService,
    ProjectionService,
    MailRuntimeService,
    ConnectionTestsService,
    ObjectStorageProbe,
    PusherProbe,
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
  exports: [SettingsService, ProjectionService],
})
export class PlatformSettingsModule {}
