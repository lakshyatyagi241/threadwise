import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { listNotificationsQuerySchema, type ListNotificationsQuery } from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

/**
 * The signed-in user's in-app notifications (the header bell). No permission key: a person always sees their own feed,
 * and the service pins every query to them. Literal paths (`unread-count`, `read-all`) come before `:id/read`.
 */
@ApiTags('notifications')
@ActorKinds('user')
@Controller({ path: 'notifications', version: '2' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first (cursor paginated)',
    description:
      '`unreadOnly=true` narrows to unread. `meta.unread` is the real unread total, not the page count.',
  })
  async list(@Query(zodPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many unread notifications I have (the bell badge)' })
  async unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark all my notifications read',
    description: 'Returns how many changed.',
  })
  async markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark one of my notifications read',
    description: "Idempotent. Someone else's notification, or an unknown id, is 404.",
  })
  async markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }
}
