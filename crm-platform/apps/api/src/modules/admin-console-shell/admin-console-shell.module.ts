import { Module } from '@nestjs/common';
import { NavLayoutService } from './nav-layout.service';
import { PlatformShellController, ShellController } from './shell.controller';

/** Shell configuration endpoints (menu layout today). Registered in app.module.ts. */
@Module({
  controllers: [ShellController, PlatformShellController],
  providers: [NavLayoutService],
})
export class AdminConsoleShellModule {}
