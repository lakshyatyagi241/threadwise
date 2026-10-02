import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createBookingTypeSchema,
  listBookingTypesQuerySchema,
  localDateSchema,
  previewSlotsSchema,
  slotsQuerySchema,
  updateBookingTypeSchema,
  upsertOverrideSchema,
  type CreateBookingTypeInput,
  type ListBookingTypesQuery,
  type PreviewSlotsInput,
  type SlotsQuery,
  type UpdateBookingTypeInput,
  type UpsertOverrideInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentBookingGuard } from './booking-plan';
import { BookingTypesService } from './booking-types.service';

/**
 * Booking types (TW-APPT-005..016). Every route needs the plan's appointment booking (the flag Reference gated the area on) and the
 * capability it names. Literal paths (`options`, `preview-slots`) are declared before `:id`: Express matches in registration order.
 */
@ApiTags('booking-types')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'booking-types', version: '2' })
export class BookingTypesController {
  constructor(private readonly types: BookingTypesService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'List booking types',
    description:
      'Every type of the workspace with its hours, overrides, questions, reminders, messages, price and calendar target, newest first. Filters: q (name), active.',
  })
  list(@Query(zodPipe(listBookingTypesQuerySchema)) query: ListBookingTypesQuery) {
    return this.types.list(query);
  }

  @Get('options')
  @RequirePermission('record.booking-types.read')
  @ApiOperation({ summary: 'The lightweight picker list (the flow builder\'s "Service" dropdown)' })
  options() {
    return this.types.options();
  }

  @Post('preview-slots')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'Stateless slot preview from an unsaved draft',
    description:
      'Runs the slot engine over the posted draft (hours, overrides, buffers, notice, capacity) for 1 to 14 days from today. Bookings and reservations are not counted: the type is not saved.',
  })
  preview(@Body(zodPipe(previewSlotsSchema)) body: PreviewSlotsInput) {
    return this.types.preview(body);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.booking-types.create')
  @ApiOperation({
    summary: 'Create a booking type',
    description:
      'The type and its hours, overrides, questions, reminders, messages, price and calendar target in one body. The slug is made unique with a numeric suffix. Money is a decimal string in major units.',
  })
  create(@Body(zodPipe(createBookingTypeSchema)) body: CreateBookingTypeInput) {
    return this.types.create(body);
  }

  @Get(':id')
  @RequirePermission('record.booking-types.read')
  @ApiOperation({ summary: 'Get one booking type by uuid' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.types.get(id);
  }

  @Get(':id/slots')
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'The open slots of a type, as the customer sees them',
    description:
      "From / to are local dates (YYYY-MM-DD) in the type's time zone, at most 62 days (default 14 from today). Only days with an open slot appear.",
  })
  slots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(slotsQuerySchema)) query: SlotsQuery,
  ) {
    return this.types.slotsFor(id, query);
  }

  @Patch(':id')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Update a booking type',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Absent keeps; a child list that is sent replaces that list (items that carry an id keep their rows). Pausing is `isActive: false`.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBookingTypeSchema)) body: UpdateBookingTypeInput,
  ) {
    return this.types.update(id, body);
  }

  @Put(':id/overrides/:date')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({
    summary: 'Close a date, or give it special hours',
    description:
      "Adds or replaces the override of one date (YYYY-MM-DD in the type's zone) and leaves everything else alone.",
  })
  putOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date', zodPipe(localDateSchema)) date: string,
    @Body(zodPipe(upsertOverrideSchema)) body: UpsertOverrideInput,
  ) {
    return this.types.upsertOverride(id, date, body);
  }

  @Delete(':id/overrides/:date')
  @RequirePermission('record.booking-types.update')
  @ApiOperation({ summary: 'Remove the override of one date' })
  deleteOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('date', zodPipe(localDateSchema)) date: string,
  ) {
    return this.types.deleteOverride(id, date);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.booking-types.delete')
  @ApiOperation({
    summary: 'Delete a booking type',
    description:
      'Refused with 409 BOOKING_TYPE_HAS_UPCOMING while pending or confirmed bookings are still to come (pause it instead). Past bookings keep their snapshot.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.types.remove(id);
  }
}
