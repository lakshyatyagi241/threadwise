import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listNotificationsQuerySchema,
  readSubjectRequestSchema,
  updateNotificationPreferencesRequestSchema,
  type ListNotificationsQuery,
  type ReadSubjectRequest,
  type UpdateNotificationPreferencesRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

/**
 * The signed-in user's in-app notifications (the header bell). No permission key: a person always sees their own feed,
 * and the service pins every query to them. Literal paths (`unread-count`, `read-all`, `read-subject`) come before `:id/read`.
 */
@ApiTags('notifications')
@ActorKinds('user')
@Controller({ path: 'notifications', version: '2' })
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

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

  @Get('preferences')
  @ApiOperation({
    summary: 'My notification preferences: bell, toast and sound per type',
    description:
      'Every type in catalogue order with the values in force (your setting, else the workspace owner toggle, else the default), the defaults, what you set yourself (null = inherit) and the owner toggle you would inherit.',
  })
  async getPreferences() {
    return this.preferences.get();
  }

  @Put('preferences')
  @ApiOperation({
    summary: 'Change my notification preferences (partial, idempotent)',
    description:
      'Each item names a type and any of bell, toast, sound: true or false sets it, null goes back to inheriting, a missing key stays. Returns the full list as GET does.',
  })
  async updatePreferences(
    @Body(zodPipe(updateNotificationPreferencesRequestSchema))
    body: UpdateNotificationPreferencesRequest,
  ) {
    return this.preferences.update(body);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'The numbers around the Notifications page: unread, last 24 hours, last 7 days, count per type',
  })
  async summary() {
    return this.notifications.summary();
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

  @Post('read-subject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark my unread notifications about one conversation read',
    description:
      'Reading a conversation does this on the server already; this is for a client that shows the thread without the read call. Returns how many changed and the new unread total.',
  })
  async markSubjectRead(@Body(zodPipe(readSubjectRequestSchema)) body: ReadSubjectRequest) {
    return this.notifications.markSubjectRead(body);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Dismiss one of my notifications',
    description: "Removes it for good. Someone else's notification, or an unknown id, is 404.",
  })
  async dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.dismiss(id);
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
