import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { saveQuickAccessRequestSchema, type SaveQuickAccessRequest } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AllowWhileGated } from '../auth';
import { ShellUserService } from './shell-user.service';

/**
 * The customer shell's own reads and the person's two shell writes. No permission key: every signed-in person has a shell,
 * and each call touches only the caller's own row (or platform-wide, read-only values).
 */
@ApiTags('shell')
@ActorKinds('user')
@AllowWhileGated()
@Controller({ path: 'shell', version: '2' })
export class ShellUserController {
  constructor(private readonly shell: ShellUserService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Navigation mode, rail colours, top bar entries and whether the tour runs',
  })
  config() {
    return this.shell.config();
  }

  @Post('tour/seen')
  @HttpCode(200)
  @ApiOperation({ summary: 'The guided tour was finished or skipped; it never auto-runs again' })
  tourSeen() {
    return this.shell.tourSeen();
  }

  @Get('announcements')
  @ApiOperation({ summary: 'Active announcements, grouped into one bar per tone' })
  announcements() {
    return this.shell.announcements();
  }

  @Get('quick-access')
  @ApiOperation({ summary: 'My pinned shortcuts (the ten defaults until I customise)' })
  quickAccess() {
    return this.shell.quickAccess();
  }

  @Put('quick-access')
  @ApiOperation({
    summary: 'Pin up to ten shortcuts: catalogue keys or custom links',
    description: 'Unknown keys, blank labels and unsafe links are dropped, not rejected.',
  })
  saveQuickAccess(@Body(zodPipe(saveQuickAccessRequestSchema)) body: SaveQuickAccessRequest) {
    return this.shell.saveQuickAccess(body.items);
  }
}
