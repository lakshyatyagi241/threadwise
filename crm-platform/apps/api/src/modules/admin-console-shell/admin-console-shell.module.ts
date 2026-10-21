import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { NavLayoutService } from './nav-layout.service';
import { AnalyticsModule } from '../analytics';
import { OverviewStatsService } from './overview-stats.service';
import { OperatorNotificationsController } from './operator-notifications.controller';
import { OperatorNotificationsService } from './operator-notifications.service';
import { PlatformShellController, ShellController } from './shell.controller';
import { ShellUserController } from './shell-user.controller';
import { ShellUserService } from './shell-user.service';
import { WorkspaceExportService } from './workspace-export.service';
import {
  PreferencesController,
  WorkspaceSettingsController,
} from './workspace-settings.controller';
import { WorkspaceSettingsService } from './workspace-settings.service';

/**
 * Shell configuration endpoints (menu layout), the console's platform feed and the customer Settings page's server side.
 * Registered in app.module.ts. The platform door (PlatformStore, PlatformSettingsService) comes from the global auth module.
 */
@Module({
  imports: [AnalyticsModule, PlatformSettingsModule],
  controllers: [
    ShellController,
    ShellUserController,
    PlatformShellController,
    OperatorNotificationsController,
    WorkspaceSettingsController,
    PreferencesController,
  ],
  providers: [
    CryptoService,
    NavLayoutService,
    ShellUserService,
    OverviewStatsService,
    OperatorNotificationsService,
    WorkspaceSettingsService,
    WorkspaceExportService,
  ],
})
export class AdminConsoleShellModule {}
