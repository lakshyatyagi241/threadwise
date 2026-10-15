import {
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acknowledgementInputSchema,
  createDeviceInputSchema,
  listDevicesQuerySchema,
  startPairingInputSchema,
  updateDeviceInputSchema,
  type AcknowledgementInput,
  type CreateDeviceInput,
  type ListDevicesQuery,
  type StartPairingInput,
  type UpdateDeviceInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Throttle } from '../platform-infrastructure';
import { DevicePairingService } from './device-pairing.service';
import { DevicesService } from './devices.service';
import { HistoryImportService } from './history-import.service';
import { RiskNoticeService } from './risk-notice.service';
import { UnofficialEngineGuard } from './unofficial-engine.guard';

/**
 * Personal WhatsApp numbers (the unofficial engine; docs/specs/personal-whatsapp-connect.md section 10). Every route first runs the engine
 * gate (422 WA_UNOFFICIAL_DISABLED), then needs one of the `wa.devices.*` keys, which only the Owner and Admin presets hold by default. A
 * device is addressed by uuid and read through the caller's tenant, so another workspace's id is a 404.
 *
 * Literal paths (`risk-notice`) come before the `:id` routes that share their first segment. Only the pairing START and the pairing READ
 * carry a QR or a code: they are `no-store` and never `@Idempotent` (a stored response would keep the secret).
 */
@ApiTags('whatsapp-devices')
@ActorKinds('user')
@UseGuards(UnofficialEngineGuard)
@Controller({ path: 'devices', version: '2' })
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly pairing: DevicePairingService,
    private readonly notice: RiskNoticeService,
    private readonly history: HistoryImportService,
  ) {}

  @Get()
  @RequirePermission('wa.devices.read')
  @ApiOperation({
    summary: 'Personal WhatsApp numbers of the workspace, with the cap and the notice standing',
  })
  list(@Query(zodPipe(listDevicesQuerySchema)) query: ListDevicesQuery) {
    return this.devices.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('wa.devices.create')
  @ApiOperation({
    summary: 'Add a personal number (needs the current risk notice accepted by the caller)',
  })
  create(@Body(zodPipe(createDeviceInputSchema)) body: CreateDeviceInput) {
    return this.devices.create(body);
  }

  @Get('risk-notice')
  @RequirePermission('wa.devices.read')
  @ApiOperation({ summary: "The caller's standing on the current version of the risk notice" })
  riskNotice() {
    return this.notice.status();
  }

  @Post('risk-notice')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.devices.create')
  @ApiOperation({
    summary:
      'Accept the current version of the risk notice (one acknowledgement row per person and version)',
  })
  acceptRiskNotice(@Body(zodPipe(acknowledgementInputSchema)) body: AcknowledgementInput) {
    return this.notice.accept(body);
  }

  @Get(':id')
  @RequirePermission('wa.devices.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.get(id);
  }

  @Patch(':id')
  @Idempotent()
  @RequirePermission('wa.devices.create')
  @ApiOperation({
    summary: 'Rename, change region or assignee, "use for sending", or (while unlinked) the number',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateDeviceInputSchema)) body: UpdateDeviceInput,
  ) {
    return this.devices.update(id, body);
  }

  @Post(':id/pairing/qr')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @RequirePermission('wa.devices.pair')
  @ApiOperation({ summary: 'Start a QR pairing; answers when the first QR exists (up to 35 s)' })
  startQr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(startPairingInputSchema)) body: StartPairingInput,
  ) {
    return this.pairing.startQr(id, body);
  }

  @Post(':id/pairing/code')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @RequirePermission('wa.devices.pair')
  @ApiOperation({ summary: 'Start a pairing-code link (needs the number with its country code)' })
  startCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(startPairingInputSchema)) body: StartPairingInput,
  ) {
    return this.pairing.startCode(id, body);
  }

  @Get(':id/pairing')
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Authorization')
  @Throttle({ limit: 1, windowSeconds: 1, by: 'actor' })
  @RequirePermission('wa.devices.pair')
  @ApiOperation({
    summary: 'The 2 s poll of a pairing attempt: state, progress, the rotating QR or the code',
  })
  readPairing(@Param('id', ParseUUIDPipe) id: string) {
    return this.pairing.read(id);
  }

  @Delete(':id/pairing')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('wa.devices.pair')
  @ApiOperation({ summary: 'End the pairing attempt now' })
  cancelPairing(@Param('id', ParseUUIDPipe) id: string) {
    return this.pairing.cancel(id);
  }

  @Get(':id/history-import')
  @Header('Cache-Control', 'no-store')
  @RequirePermission('wa.devices.read')
  @ApiOperation({
    summary:
      'The opt-in import of existing chats: state, counts, progress, last error (poll every few seconds while it runs)',
  })
  historyImport(@Param('id', ParseUUIDPipe) id: string) {
    return this.history.status(id);
  }

  @Post(':id/history-import/cancel')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.devices.pair')
  @ApiOperation({
    summary:
      'Stop the import of existing chats: no further batch is accepted, what was stored stays (409 when none is running)',
  })
  cancelHistoryImport(@Param('id', ParseUUIDPipe) id: string) {
    return this.history.cancel(id);
  }

  @Post(':id/disconnect')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @RequirePermission('wa.devices.disconnect')
  @ApiOperation({ summary: 'Unlink the number from the phone and forget its saved session' })
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.disconnect(id);
  }

  @Delete(':id')
  @Idempotent()
  @RequirePermission('wa.devices.delete')
  @ApiOperation({
    summary: 'Delete the number (unlinks it first; conversations stay readable but closed)',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.remove(id);
  }
}
