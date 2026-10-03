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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  claimUsernameInputSchema,
  createQrCodeInputSchema,
  type ClaimUsernameInput,
  type CreateQrCodeInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { WabaExtrasService } from './waba-extras.service';

/**
 * What a connected number can do beyond connecting (WD-WABA-025, 027, 028): its business username, click-to-chat QR codes and the
 * coexistence history re-sync. Reads need `waba.numbers.read`; every change `waba.numbers.manage`.
 */
@ApiTags('whatsapp-numbers')
@ActorKinds('user')
@Controller({ path: 'waba/numbers/:id', version: '2' })
export class WabaExtrasController {
  constructor(private readonly extras: WabaExtrasService) {}

  @Get('username')
  @RequirePermission('waba.numbers.read')
  @ApiOperation({ summary: "The number's business username, or suggestions for one" })
  username(@Param('id', ParseUUIDPipe) id: string) {
    return this.extras.username(id);
  }

  @Post('username')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Claim a business username' })
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(claimUsernameInputSchema)) body: ClaimUsernameInput,
  ) {
    return this.extras.claimUsername(id, body);
  }

  @Delete('username')
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Release the business username' })
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.extras.releaseUsername(id);
  }

  @Get('qr-codes')
  @RequirePermission('waba.numbers.read')
  @ApiOperation({ summary: 'Click-to-chat QR codes of this number' })
  qrCodes(@Param('id', ParseUUIDPipe) id: string) {
    return this.extras.listQrCodes(id);
  }

  @Post('qr-codes')
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Create a QR code with a prefilled message (up to 140 characters)' })
  createQr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createQrCodeInputSchema)) body: CreateQrCodeInput,
  ) {
    return this.extras.createQrCode(id, body);
  }

  @Delete('qr-codes/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Delete a QR code' })
  async deleteQr(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string) {
    if (!/^[A-Za-z0-9]+$/.test(code)) return;
    await this.extras.deleteQrCode(id, code);
  }

  @Post('sync-history')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: 'Ask Meta to push the coexistence chat history again' })
  syncHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.extras.syncHistory(id);
  }
}
