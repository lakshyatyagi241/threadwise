import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createIcsFeedInputSchema,
  updateIcsFeedInputSchema,
  type CreateIcsFeedInput,
  type UpdateIcsFeedInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, Public, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { BookingsFeedService } from './bookings-feed.service';
import { IcsFeedsService } from './ics-feeds.service';

/**
 * Read-only iCal subscriptions (BL-035): calendars a workspace cannot connect with OAuth, read for BUSY TIME only. Editing them is part of editing
 * booking configuration (`record.booking-types.update`); seeing them is `record.booking-types.read`. The address is a secret and is never returned:
 * a feed shows its host, its name and how its last read went.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments/calendar/ics-feeds', version: '2' })
export class IcsFeedsController {
  constructor(private readonly feeds: IcsFeedsService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({ summary: "The workspace's iCal subscriptions (busy time only)" })
  list() {
    return this.feeds.list();
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Subscribe to an iCal calendar',
    description:
      'The address (`https://`, `http://` or `webcal://`) is read ONCE before anything is saved, so a wrong address is told now: 422 APPT_ICS_FEED_INVALID (not an address we read), 422 APPT_ICS_FEED_UNREADABLE (details `url` with the reason: unreachable, timeout, not_found, forbidden, not_a_calendar, too_large, blocked_address), 409 APPT_ICS_FEED_DUPLICATE, 422 APPT_ICS_FEED_LIMIT (10 per workspace). Only busy time is used; nothing of the feed is shown or stored besides that.',
  })
  create(@Body(zodPipe(createIcsFeedInputSchema)) body: CreateIcsFeedInput) {
    return this.feeds.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Rename, pause or resume a feed, or change whether all-day events block',
    description:
      'Needs `rowVersion` (409 ROW_VERSION_CONFLICT). Resuming or changing the all-day rule reads the feed again at once.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateIcsFeedInputSchema)) body: UpdateIcsFeedInput,
  ) {
    return this.feeds.update(id, body);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Read the feed now',
    description:
      'A feed read within the last half minute is left alone. A failed read keeps the busy time of the last good one.',
  })
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.feeds.refreshNow(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Unsubscribe',
    description: 'The slots the feed was closing are free again at once.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.feeds.remove(id);
  }
}

/**
 * The signed-in person's own bookings as a subscribable feed (BL-035). The link is theirs alone: it is returned only to them, a new one replaces the
 * old at once, and ending it stops the feed. Anyone with `record.appointments.read` has the feed of what they can read.
 */
@ApiTags('appointments')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointments/calendar/bookings-feed', version: '2' })
export class BookingsFeedController {
  constructor(private readonly feed: BookingsFeedService) {}

  @Get()
  @RequirePermission('record.appointments.read')
  @ApiOperation({ summary: 'My bookings feed link (null until I make one)' })
  link() {
    return this.feed.link();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.appointments.read')
  @ApiOperation({
    summary: 'Make my bookings feed link, or replace it with a new one',
    description:
      'Anyone who holds the link sees your bookings (title, time and place, no contact details), so treat it as a password. A new link stops the old one at once.',
  })
  rotate() {
    return this.feed.rotate();
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.appointments.read')
  @ApiOperation({ summary: 'Stop my bookings feed' })
  async revoke(): Promise<void> {
    await this.feed.revoke();
  }
}

/** The feed carries names and times behind a bearer link: never indexed, never leaked through a referrer; short private caching so a calendar app polling does not hammer. */
const feedHeaders = () =>
  applyDecorators(
    Header('Content-Type', 'text/calendar; charset=utf-8'),
    Header('Cache-Control', 'private, max-age=300'),
    Header('X-Robots-Tag', 'noindex, nofollow'),
    Header('Referrer-Policy', 'no-referrer'),
  );

/**
 * What a calendar app reads: `/v2/public/appointments/feed/<token>.ics`. No login: the 43-character token is the credential. An unknown, revoked or
 * malformed link is a 404; the person's CURRENT access decides what the feed shows. Throttled per IP and per link.
 */
@ApiTags('appointments')
@Public()
@Controller({ path: 'public/appointments/feed', version: '2' })
export class BookingsFeedPublicController {
  constructor(private readonly feed: BookingsFeedService) {}

  @Get(':file')
  @feedHeaders()
  @ApiOperation({ summary: "A person's bookings as an iCalendar subscription" })
  ics(@Param('file') file: string): Promise<string> {
    return this.feed.render(file);
  }
}
