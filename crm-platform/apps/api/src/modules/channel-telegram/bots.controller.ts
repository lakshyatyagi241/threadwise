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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  connectBotSchema,
  savePaymentSettingsSchema,
  type ConnectBotInput,
  type SavePaymentSettingsInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BotsService } from './bots.service';

/** Telegram bots: connect by token, pause, fix the webhook, payment settings, disconnect (TW-TG-001, 002, 007). */
@ApiTags('telegram')
@ActorKinds('user')
@Controller({ path: 'telegram/bots', version: '2' })
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get()
  @RequirePermission('tg.bots.read')
  @ApiOperation({ summary: "The workspace's connected bots, oldest first (never any token)" })
  list() {
    return this.bots.list();
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('tg.bots.manage')
  @ApiOperation({
    summary: 'Connect a bot from a pasted @BotFather token',
    description:
      '422 TG_TOKEN_REJECTED when Telegram does not accept the token. The same Telegram bot pasted again updates its row. ' +
      'When Telegram refuses the webhook the bot is saved and `webhookError` says why.',
  })
  connect(@Body(zodPipe(connectBotSchema)) body: ConnectBotInput) {
    return this.bots.connect(body);
  }

  @Post(':id/retry-webhook')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.bots.manage')
  @ApiOperation({ summary: 'Register the webhook again ("Fix inbound")' })
  retryWebhook(@Param('id', ParseUUIDPipe) id: string) {
    return this.bots.retryWebhook(id);
  }

  @Post(':id/toggle')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.bots.manage')
  @ApiOperation({ summary: 'Pause or resume a bot' })
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.bots.toggle(id);
  }

  @Put(':id/payments')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('tg.bots.manage')
  @ApiOperation({
    summary: 'Save the payment provider settings',
    description:
      'A blank `paymentProviderToken` keeps the saved token; a value replaces it; `clearPaymentToken` removes it.',
  })
  savePayments(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(savePaymentSettingsSchema)) body: SavePaymentSettingsInput,
  ) {
    return this.bots.savePayments(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('tg.bots.manage')
  @ApiOperation({
    summary:
      'Disconnect a bot: its Telegram webhook is deleted and the bot removed; inbox threads stay',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.bots.remove(id);
  }
}
