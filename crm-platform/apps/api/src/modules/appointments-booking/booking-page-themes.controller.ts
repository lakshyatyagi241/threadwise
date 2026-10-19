import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BOOKING_PAGE_LIMITS,
  bookingPageAssetSlotSchema,
  updateBookingPageThemeSchema,
  updateBookingTypePageThemeSchema,
  type BookingPageAssetSlot,
  type UpdateBookingPageThemeInput,
  type UpdateBookingTypePageThemeInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { BookingPageThemesService, type UploadedPicture } from './booking-page-themes.service';

/** A little above the largest picture so a file just over its limit reaches the upload policy and gets the precise message. */
const TRANSPORT_LIMIT = Math.ceil(BOOKING_PAGE_LIMITS.coverBytes * 1.2);
const picture = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: TRANSPORT_LIMIT, files: 1 } }));

const need = (file: UploadedPicture | undefined): UploadedPicture => {
  if (!file)
    throw AppError.validation('Choose an image to upload', [
      { path: 'file', message: 'Required.' },
    ]);
  return file;
};

/**
 * The workspace's booking page appearance (BL-355, BL-357): how `/book/<workspace>` and every service page look. Reading needs
 * `record.booking-types.read`, changing needs `record.booking-types.update` (the same keys as the rest of the booking set-up).
 */
@ApiTags('booking-page')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'booking-page/theme', version: '2' })
export class BookingPageThemeController {
  constructor(private readonly themes: BookingPageThemesService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: "The workspace's booking page theme",
    description:
      'What is saved (null = inherit), what a visitor sees now, what an empty field would inherit, the brand kit values and the limits. `rowVersion` is null until the first save.',
  })
  get() {
    return this.themes.getWorkspace();
  }

  @Put()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Save the workspace theme',
    description:
      'Replaces the saved theme: a field that is sent null or left out inherits. Colours are #RRGGBB. Needs the rowVersion you read (null when nothing was saved) or 409 ROW_VERSION_CONFLICT. Hiding "Powered by" needs the plan feature remove_branding (422 otherwise).',
  })
  save(@Body(zodPipe(updateBookingPageThemeSchema)) body: UpdateBookingPageThemeInput) {
    return this.themes.saveWorkspace(body);
  }

  @Put('assets/:slot')
  @RequirePermission('record.booking-types.update')
  @ApiConsumes('multipart/form-data')
  @picture()
  @ApiOperation({
    summary: 'Upload the logo or the cover image',
    description:
      'Multipart field `file`: PNG, JPG, WebP or GIF (never SVG). Logo up to 1 MB, cover up to 3 MB. Returns the theme with the new picture and row version.',
  })
  putAsset(
    @Param('slot', zodPipe(bookingPageAssetSlotSchema)) slot: BookingPageAssetSlot,
    @UploadedFile() file: UploadedPicture | undefined,
  ) {
    return this.themes.putPicture(null, slot, need(file));
  }

  @Delete('assets/:slot')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({ summary: 'Remove the logo or the cover image' })
  removeAsset(@Param('slot', zodPipe(bookingPageAssetSlotSchema)) slot: BookingPageAssetSlot) {
    return this.themes.removePicture(null, slot);
  }
}

/** One service's override (BL-356): the same set of calls, scoped to a booking type. Anything left empty falls back to the workspace. */
@ApiTags('booking-page')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'booking-types/:id/page-theme', version: '2' })
export class BookingTypePageThemeController {
  constructor(private readonly themes: BookingPageThemesService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({ summary: "One service's booking page override, with the look it inherits" })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.themes.getType(id);
  }

  @Put()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: "Save one service's override",
    description:
      'Colours, cover style, welcome text and button label only; empty fields inherit the workspace theme. Needs the rowVersion you read (null when nothing was saved).',
  })
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBookingTypePageThemeSchema)) body: UpdateBookingTypePageThemeInput,
  ) {
    return this.themes.saveType(id, body);
  }

  @Delete()
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Back to the workspace look',
    description: 'Deletes the override and its pictures.',
  })
  reset(@Param('id', ParseUUIDPipe) id: string) {
    return this.themes.resetType(id);
  }

  @Put('assets/:slot')
  @RequirePermission('record.booking-types.update')
  @ApiConsumes('multipart/form-data')
  @picture()
  @ApiOperation({ summary: "Upload this service's logo or cover image" })
  putAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slot', zodPipe(bookingPageAssetSlotSchema)) slot: BookingPageAssetSlot,
    @UploadedFile() file: UploadedPicture | undefined,
  ) {
    return this.themes.putPicture(id, slot, need(file));
  }

  @Delete('assets/:slot')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({ summary: "Remove this service's logo or cover image" })
  removeAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slot', zodPipe(bookingPageAssetSlotSchema)) slot: BookingPageAssetSlot,
  ) {
    return this.themes.removePicture(id, slot);
  }
}
