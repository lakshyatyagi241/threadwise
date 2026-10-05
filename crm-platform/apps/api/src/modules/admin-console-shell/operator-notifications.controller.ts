import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { operatorNotificationsQuerySchema, type OperatorNotificationsQuery } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { OperatorNotificationsService } from './operator-notifications.service';

const me = (): number => RequestContextStore.require().actorId!;

/**
 * The platform feed behind the console bell (WD-ASHELL-006). Every operator role reads it and moves their own
 * "seen" marker; nothing here changes shared data. Literal paths come before any parameter.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/notifications', version: '2' })
export class OperatorNotificationsController {
  constructor(private readonly feed: OperatorNotificationsService) {}

  @Get('recent')
  @ApiOperation({ summary: 'The bell: the 15 newest platform events and the unread count' })
  recent() {
    return this.feed.recent(me());
  }

  @Get()
  @ApiOperation({
    summary: 'The full feed with 30-day counts; opening it marks everything seen',
    description: '`type` narrows to one kind, `q` filters headline and detail.',
  })
  page(@Query(zodPipe(operatorNotificationsQuerySchema)) query: OperatorNotificationsQuery) {
    return this.feed.page(me(), query);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every event seen (moves my marker to now)' })
  readAll() {
    return this.feed.markSeen(me());
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear all: on a live feed this is the same as mark all read',
  })
  clear() {
    return this.feed.markSeen(me());
  }
}
