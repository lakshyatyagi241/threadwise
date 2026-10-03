import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  guidebookBrowseQuerySchema,
  guidebookVoteRequestSchema,
  type GuidebookBrowseQuery,
  type GuidebookVoteRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AnnouncementService } from './announcement.service';
import { GuidebookService } from './guidebook.service';

/** The in-app announcement bar (TW-CMS-017): the same live rows as the public ticker. Any signed-in workspace user. */
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

/** The in-app help centre (TW-CMS-047..049). Any signed-in workspace user; the content is the same for every workspace. */
@ApiTags('cms')
@ActorKinds('user')
@Controller({ path: 'cms/guidebook', version: '2' })
export class WorkspaceGuidebookController {
  constructor(private readonly guidebook: GuidebookService) {}

  @Get()
  @ApiOperation({
    summary: 'Published articles with the category sidebar counts; search and category filter',
  })
  browse(@Query(zodPipe(guidebookBrowseQuerySchema)) q: GuidebookBrowseQuery) {
    return this.guidebook.browse(q);
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'One published article as sanitised HTML (counts a view); a draft is 404',
  })
  article(@Param('slug') slug: string) {
    return this.guidebook.article(slug);
  }

  @Post(':slug/vote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark an article helpful or not; one vote per user, changeable' })
  async vote(
    @Param('slug') slug: string,
    @Body(zodPipe(guidebookVoteRequestSchema)) body: GuidebookVoteRequest,
  ) {
    return { vote: await this.guidebook.vote(slug, body.vote) };
  }
}
