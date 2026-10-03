import { Module } from '@nestjs/common';
import { NavLayoutService } from './nav-layout.service';
import { OperatorNotificationsController } from './operator-notifications.controller';
import { OperatorNotificationsService } from './operator-notifications.service';
import { PlatformShellController, ShellController } from './shell.controller';

/** Shell configuration endpoints (menu layout) and the console's platform feed. Registered in app.module.ts. */
@Module({
  controllers: [ShellController, PlatformShellController, OperatorNotificationsController],
  providers: [NavLayoutService, OperatorNotificationsService],
})
export class AdminConsoleShellModule {}
