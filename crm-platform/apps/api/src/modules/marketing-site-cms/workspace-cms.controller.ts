import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds } from '../../common/decorators';
import { AnnouncementService } from './announcement.service';

/** The in-app announcement bar (WD-CMS-017): the same live rows as the public ticker. Any signed-in workspace user. */
@ApiTags('cms')
@ActorKinds('user')
@Controller({ path: 'cms/announcements', version: '2' })
export class WorkspaceAnnouncementsController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @ApiOperation({ summary: 'Announcements live right now, in display order' })
  live() {
    return this.announcements.live();
  }
}
