import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  announcementListQuerySchema,
  createAnnouncementRequestSchema,
  toggleAnnouncementRequestSchema,
  updateAnnouncementRequestSchema,
  uuidSchema,
  type AnnouncementListQuery,
  type CreateAnnouncementRequest,
  type ToggleAnnouncementRequest,
  type UpdateAnnouncementRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AnnouncementService } from './announcement.service';

/** Announcements (WD-CMS-039..041). Every operator role reads; super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/cms/announcements', version: '2' })
export class OperatorAnnouncementsController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @ApiOperation({ summary: 'Announcements with the four tiles; filter by status, search' })
  list(@Query(zodPipe(announcementListQuerySchema)) q: AnnouncementListQuery) {
    return this.announcements.list(q);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create an announcement' })
  create(@Body(zodPipe(createAnnouncementRequestSchema)) body: CreateAnnouncementRequest) {
    return this.announcements.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One announcement, for the editor' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.announcements.get(id);
  }

  @Put(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Replace an announcement (409 on a stale rowVersion)' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateAnnouncementRequestSchema)) body: UpdateAnnouncementRequest,
  ) {
    return this.announcements.update(id, body);
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Switch an announcement on or off' })
  toggle(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(toggleAnnouncementRequestSchema)) body: ToggleAnnouncementRequest,
  ) {
    return this.announcements.toggle(id, body.rowVersion);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete an announcement permanently' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.announcements.remove(id);
    return { ok: true as const };
  }
}
