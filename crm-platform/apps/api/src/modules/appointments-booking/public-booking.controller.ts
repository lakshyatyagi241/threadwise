import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  publicBookInputSchema,
  publicCancelInputSchema,
  publicRescheduleInputSchema,
  slotsQuerySchema,
  type PublicBookInput,
  type PublicCancelInput,
  type PublicRescheduleInput,
  type SlotsQuery,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { Public } from '../../common/decorators';
import { Throttle } from '../platform-infrastructure';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PublicBookingService } from './public-booking.service';

/** A booking page and a manage page carry a customer's details and a bearer link: never cached, never indexed, never leaked through a referrer. */
const privatePage = () =>
  applyDecorators(
    Header('Cache-Control', 'no-store'),
    Header('X-Robots-Tag', 'noindex, nofollow'),
    Header('Referrer-Policy', 'no-referrer'),
  );

/**
 * The customer's booking page (EXT-APPT-01). Unauthenticated by design: `/v2/public/booking/<workspace slug>/<service slug>`. The web
 * app serves the page at `/book/<workspace slug>/<service slug>` and calls these routes. Throttled per IP and per page (browsing 120 / 240
 * a minute, booking 10 / 60); an unknown workspace or service is 404; booking turned off by the plan is 409 APPT_BOOKING_UNAVAILABLE.
 */
@ApiTags('booking-public')
@Public()
@Controller({ path: 'public/booking', version: '2' })
export class PublicBookingController {
  constructor(private readonly pub: PublicBookingService) {}

  @Get(':orgSlug')
  @privatePage()
  @ApiOperation({
    summary: "A workspace's bookable services",
    description:
      'Active services only, each with its price, questions and the zone its days are cut in. No staff or customer data.',
  })
  page(@Param('orgSlug') orgSlug: string) {
    return this.pub.page(orgSlug);
  }

  @Get(':orgSlug/:typeSlug')
  @privatePage()
  @ApiOperation({ summary: 'One service: what to show above the calendar and the form' })
  type(@Param('orgSlug') orgSlug: string, @Param('typeSlug') typeSlug: string) {
    return this.pub.typeView(orgSlug, typeSlug);
  }

  @Get(':orgSlug/:typeSlug/slots')
  @privatePage()
  @ApiOperation({
    summary: 'Open slots of a service',
    description:
      "From / to are local dates (YYYY-MM-DD) in the service's zone, at most 62 days (default 14 from today). Computed live: a slot taken a second ago is gone.",
  })
  slots(
    @Param('orgSlug') orgSlug: string,
    @Param('typeSlug') typeSlug: string,
    @Query(zodPipe(slotsQuerySchema)) query: SlotsQuery,
  ) {
    return this.pub.slotsFor(orgSlug, typeSlug, query);
  }

  @Post(':orgSlug/:typeSlug/book')
  @HttpCode(HttpStatus.CREATED)
  @privatePage()
  @ApiOperation({
    summary: 'Book a slot',
    description:
      'A name and an email or a phone number are required. 409 APPT_SLOT_TAKEN when the seat was just taken, 422 APPT_SLOT_UNAVAILABLE when the time is not on the schedule. The same visitor booking the same slot again gets their booking back (`replay: true`). The response carries the bearer manage token: keep it private.',
  })
  book(
    @Param('orgSlug') orgSlug: string,
    @Param('typeSlug') typeSlug: string,
    @Body(zodPipe(publicBookInputSchema)) body: PublicBookInput,
  ) {
    return this.pub.book(orgSlug, typeSlug, body);
  }
}

/**
 * A booking managed with its token (TW-APPT-024..026): `/v2/public/booking-manage/<token>`, the 43-character token in the path is the
 * credential. GET only reads (a chat link preview cannot cancel anything); every change is a POST.
 */
@ApiTags('booking-public')
@Public()
@Controller({ path: 'public/booking-manage', version: '2' })
export class PublicBookingManageController {
  constructor(private readonly pub: PublicBookingService) {}

  @Get(':token')
  @privatePage()
  @ApiOperation({
    summary: 'The booking as the customer sees it',
    description: 'Service, time, place, status and what they may do. No customer data and no ids.',
  })
  view(@Param('token') token: string) {
    return this.pub.manageView(token);
  }

  @Get(':token/slots')
  @privatePage()
  @ApiOperation({ summary: 'Open slots to move this booking to (its own slot is free for it)' })
  slots(@Param('token') token: string, @Query(zodPipe(slotsQuerySchema)) query: SlotsQuery) {
    return this.pub.manageSlots(token, query);
  }

  @Get(':token/ics')
  @privatePage()
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @ApiOperation({ summary: 'The booking as an iCalendar (.ics) file' })
  async ics(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const f = await this.pub.ics(token);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    return f.body;
  }

  @Post(':token/reschedule')
  @HttpCode(HttpStatus.OK)
  @privatePage()
  @ApiOperation({
    summary: 'Move the booking to another slot',
    description:
      'The target must be a slot the service offers (409 APPT_SLOT_TAKEN / 422 APPT_SLOT_UNAVAILABLE); 410 APPT_LINK_UNAVAILABLE when the booking is over; 409 APPT_ALREADY_STARTED after its start.',
  })
  reschedule(
    @Param('token') token: string,
    @Body(zodPipe(publicRescheduleInputSchema)) body: PublicRescheduleInput,
  ) {
    return this.pub.reschedule(token, body);
  }

  @Post(':token/cancel')
  @HttpCode(HttpStatus.OK)
  @privatePage()
  @ApiOperation({
    summary: 'Cancel the booking',
    description:
      'Frees the slot. A cancel fee inside the cancel window is recorded, never charged. 410 when the booking is already over.',
  })
  cancel(
    @Param('token') token: string,
    @Body(zodPipe(publicCancelInputSchema)) body: PublicCancelInput,
  ) {
    return this.pub.cancel(token, body);
  }
}

/** The uuid of an uploaded picture, or the workspace brand kit's logo. Anything else is not a picture of ours. */
const ASSET_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|brand-logo)$/;

/**
 * The pictures of a booking page (BL-358): `/v2/public/booking-assets/<workspace slug>/<asset id>`. The theme names an id and a version
 * (`?v=`), the web relay serves it at `/api/public/appointments/assets/...`. A picture a workspace chose for its public page is public by
 * design, so it is cached for a year (the version changes with the file) and served so a browser cannot run it as anything but an
 * image: a fixed raster type from a stored allow-list, `nosniff`, and a policy that allows nothing.
 */
@ApiTags('booking-public')
@Public()
@Controller({ path: 'public/booking-assets', version: '2' })
export class PublicBookingAssetsController {
  constructor(private readonly pub: PublicBookingService) {}

  @Get(':orgSlug/:assetId')
  @Throttle({ limit: 600, windowSeconds: 60, by: 'ip' })
  @ApiOperation({ summary: "A booking page's logo or cover image" })
  async asset(
    @Param('orgSlug') orgSlug: string,
    @Param('assetId') assetId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!ASSET_ID.test(assetId)) throw AppError.notFound('Picture');
    const found = await this.pub.pageAsset(orgSlug, assetId);
    const etag = `"${found.etag}"`;
    res
      .setHeader('etag', etag)
      .setHeader('cache-control', 'public, max-age=31536000, immutable')
      .setHeader('x-content-type-options', 'nosniff')
      .setHeader('content-security-policy', "default-src 'none'; sandbox")
      .setHeader('cross-origin-resource-policy', 'same-site')
      .setHeader('referrer-policy', 'no-referrer');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.status(200).setHeader('content-type', found.mime).send(found.bytes);
  }
}
