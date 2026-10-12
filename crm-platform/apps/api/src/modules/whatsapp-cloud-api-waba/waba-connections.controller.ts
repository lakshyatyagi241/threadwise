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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  connectEmbeddedInputSchema,
  connectManualInputSchema,
  registerNumberInputSchema,
  requestVerificationCodeInputSchema,
  verifyCodeInputSchema,
  setTokenInputSchema,
  updateBusinessProfileInputSchema,
  updateConnectionInputSchema,
  verifyTokenInputSchema,
  type ConnectEmbeddedInput,
  type ConnectManualInput,
  type RegisterNumberInput,
  type RequestVerificationCodeInput,
  type VerifyCodeInput,
  type SetTokenInput,
  type UpdateBusinessProfileInput,
  type UpdateConnectionInput,
  type VerifyTokenInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WabaConnectService } from './waba-connect.service';

/**
 * Connected WhatsApp numbers (TW-WABA-004..022). Reads need `waba.numbers.read`, connecting `waba.numbers.connect`, and the
 * per-number actions `waba.numbers.manage`. Every number is addressed by uuid and looked up through the caller's tenant, so
 * another workspace's id is a 404.
 *
 * Literal paths (`readiness`, `connect`, `verify-token`) come before the `:id` routes that share their first segment.
 */
@ApiTags('whatsapp-numbers')
@ActorKinds('user')
@Controller({ path: 'waba', version: '2' })
export class WabaConnectionsController {
  constructor(private readonly connections: WabaConnectService) {}

  @Get('readiness')
  @RequirePermission('waba.numbers.read', 'waba.numbers.connect')
  @ApiOperation({
    summary: 'What the browser needs to launch Embedded Signup, and what is still unset',
  })
  readiness() {
    return this.connections.readiness();
  }

  @Get('numbers')
  @RequirePermission('waba.numbers.read')
  @ApiOperation({ summary: 'Connected WhatsApp numbers, primary first' })
  async list() {
    return { items: await this.connections.list() };
  }

  @Post('numbers/connect/embedded')
  @RequirePermission('waba.numbers.connect')
  @Idempotent()
  @ApiOperation({
    summary: 'Finish Embedded Signup: exchange the code, subscribe, save the number',
  })
  connectEmbedded(@Body(zodPipe(connectEmbeddedInputSchema)) body: ConnectEmbeddedInput) {
    return this.connections.connectEmbedded(body);
  }

  @Post('numbers/connect/manual')
  @RequirePermission('waba.numbers.connect')
  @Idempotent()
  @ApiOperation({
    summary: 'Connect a number from pasted credentials (Phone Number ID, WABA ID, token)',
  })
  connectManual(@Body(zodPipe(connectManualInputSchema)) body: ConnectManualInput) {
    return this.connections.connectManual(body);
  }

  @Post('numbers/verify-token')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.connect')
  @ApiOperation({ summary: 'Check a pasted token before saving it' })
  verifyToken(@Body(zodPipe(verifyTokenInputSchema)) body: VerifyTokenInput) {
    return this.connections.verifyToken(body);
  }

  @Get('numbers/:id')
  @RequirePermission('waba.numbers.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.get(id);
  }

  @Patch('numbers/:id')
  @RequirePermission('waba.numbers.manage')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateConnectionInputSchema)) body: UpdateConnectionInput,
  ) {
    return this.connections.rename(id, body.displayLabel, body.rowVersion);
  }

  @Get('numbers/:id/health')
  @RequirePermission('waba.numbers.read')
  @ApiOperation({ summary: 'Live read of the number from Meta and the issues it has' })
  health(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.health(id);
  }

  @Post('numbers/:id/primary')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  setPrimary(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.setPrimary(id);
  }

  @Post('numbers/:id/resubscribe')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Fix inbound: re-subscribe the WABA to this platform and verify' })
  resubscribe(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.resubscribe(id);
  }

  @Post('numbers/:id/register')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Register the number on the Cloud API (optional two-step PIN)' })
  register(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(registerNumberInputSchema)) body: RegisterNumberInput,
  ) {
    return this.connections.register(id, body);
  }

  @Post('numbers/:id/verify/request')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({
    summary: 'Ask Meta to send the number its 6-digit ownership code (SMS or voice)',
  })
  requestCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(requestVerificationCodeInputSchema)) body: RequestVerificationCodeInput,
  ) {
    return this.connections.requestVerificationCode(id, body);
  }

  @Post('numbers/:id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Verify the number with the code Meta sent' })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(verifyCodeInputSchema)) body: VerifyCodeInput,
  ) {
    return this.connections.verifyCode(id, body);
  }

  @Put('numbers/:id/token')
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Replace the stored token with a verified one' })
  setToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setTokenInputSchema)) body: SetTokenInput,
  ) {
    return this.connections.setToken(id, body);
  }

  @Post('numbers/:id/token/renew')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Renew the stored token with Meta, in place' })
  renewToken(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.renewToken(id);
  }

  @Get('numbers/:id/profile')
  @RequirePermission('waba.numbers.read')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.getProfile(id);
  }

  @Put('numbers/:id/profile')
  @RequirePermission('waba.numbers.manage')
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateBusinessProfileInputSchema)) body: UpdateBusinessProfileInput,
  ) {
    return this.connections.updateProfile(id, body);
  }

  @Post('numbers/:id/disconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    return this.connections.disconnect(id);
  }

  @Delete('numbers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('waba.numbers.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.connections.remove(id);
  }
}
