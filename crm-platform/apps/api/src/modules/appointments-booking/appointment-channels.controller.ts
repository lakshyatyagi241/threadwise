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
  adoptAppointmentTemplateSchema,
  appointmentChannelSchema,
  createAppointmentTemplateSchema,
  listAppointmentTemplatesQuerySchema,
  updateAppointmentChannelSchema,
  updateAppointmentTemplateSchema,
  type AdoptAppointmentTemplateInput,
  type AppointmentChannel,
  type CreateAppointmentTemplateInput,
  type ListAppointmentTemplatesQuery,
  type UpdateAppointmentChannelInput,
  type UpdateAppointmentTemplateInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AppointmentChannelsService } from './appointment-channels.service';
import { AppointmentTemplatesService } from './appointment-templates.service';
import { AppointmentBookingGuard } from './booking-plan';

/**
 * Which channels may carry appointment messages (BL-350). Reading is open to anyone who can see booking types (the editor needs it);
 * changing the choice is the owner's and the admin's.
 */
@ApiTags('appointment-channels')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointment-channels', version: '2' })
export class AppointmentChannelsController {
  constructor(private readonly channels: AppointmentChannelsService) {}

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'The channels for appointment messages: enabled, connected, senders',
    description:
      'Email, WhatsApp and the reserved voice channel, each with whether the owner switched it on, whether a sender is connected, the connected senders and the chosen default. A booking type can use a channel only when `usable` is true.',
  })
  list() {
    return this.channels.list();
  }

  @Put(':channel')
  @Idempotent()
  @RequirePermission('appointments.channels.manage')
  @ApiOperation({
    summary: 'Switch a channel on or off and choose its default sender',
    description:
      '`voice` is reserved and answers 422 APPT_CHANNEL_COMING_SOON. Switching a channel off stops what is already scheduled on it (the sender skips it with the reason `channel_disabled`).',
  })
  update(
    @Param('channel', zodPipe(appointmentChannelSchema)) channel: AppointmentChannel,
    @Body(zodPipe(updateAppointmentChannelSchema)) body: UpdateAppointmentChannelInput,
  ) {
    return this.channels.update(channel, body);
  }
}

/** The appointment message library (BL-351). Literal paths (`predefined`, `adopt`) come before `:id`. */
@ApiTags('appointment-message-templates')
@ActorKinds('user')
@UseGuards(AppointmentBookingGuard)
@Controller({ path: 'appointment-message-templates', version: '2' })
export class AppointmentTemplatesController {
  constructor(private readonly templates: AppointmentTemplatesService) {}

  @Get('predefined')
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'The built-in messages (confirmation, reminder, reschedule, cancellation, follow-up)',
    description: 'Each entry says which library message was made from it, if any.',
  })
  predefined() {
    return this.templates.predefined();
  }

  @Get()
  @RequirePermission('record.booking-types.read')
  @ApiOperation({
    summary: 'The workspace library of appointment messages with their live status',
    description:
      "Filters: kind, channel, usable. A WhatsApp message carries the status of its template (draft, pending, approved, rejected with Meta's reason); only an approved one is `usable`.",
  })
  list(@Query(zodPipe(listAppointmentTemplatesQuerySchema)) query: ListAppointmentTemplatesQuery) {
    return this.templates.list(query);
  }

  @Post('adopt')
  @Idempotent()
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({
    summary: 'Adopt a built-in message',
    description:
      'Email: lands in the library at once. WhatsApp: creates the WhatsApp template (a draft, or with `submit` sent to Meta for review) and links it; needs the template permissions too.',
  })
  adopt(@Body(zodPipe(adoptAppointmentTemplateSchema)) body: AdoptAppointmentTemplateInput) {
    return this.templates.adopt(body);
  }

  @Post()
  @Idempotent()
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({ summary: "Create the owner's own email message" })
  create(@Body(zodPipe(createAppointmentTemplateSchema)) body: CreateAppointmentTemplateInput) {
    return this.templates.create(body);
  }

  @Get(':id')
  @RequirePermission('record.booking-types.read')
  @ApiOperation({ summary: 'One library message' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({
    summary: 'Edit a library message',
    description:
      'Email: name, subject, text, active. WhatsApp: the text of a draft or a rejected message, and `submit` to send it to Meta again.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateAppointmentTemplateSchema)) body: UpdateAppointmentTemplateInput,
  ) {
    return this.templates.update(id, body);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({
    summary: 'Send a WhatsApp message to Meta for review (or again after a refusal)',
  })
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.submit(id);
  }

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({ summary: "Read a WhatsApp message's status from Meta again" })
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.refresh(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('appointments.templates.manage')
  @ApiOperation({
    summary: 'Remove a message from the library (refused while a booking type chooses it)',
    description: 'A WhatsApp template stays in the WhatsApp template library.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
