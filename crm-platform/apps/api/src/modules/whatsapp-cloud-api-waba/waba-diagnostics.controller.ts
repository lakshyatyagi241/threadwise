import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WabaDiagnosticsService } from './waba-diagnostics.service';

/** Where Meta delivers a number's events, and what to paste into a customer's own Meta app (TW-WABA-015). */
@ApiTags('whatsapp-numbers')
@ActorKinds('user')
@Controller({ path: 'waba', version: '2' })
export class WabaDiagnosticsController {
  constructor(private readonly diagnostics: WabaDiagnosticsService) {}

  @Get('webhook-config')
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: "Callback URL and verify token for a customer's own Meta app" })
  webhookConfig() {
    return this.diagnostics.webhookConfig();
  }

  @Get('numbers/:id/inbound-check')
  @RequirePermission('waba.numbers.manage')
  @ApiOperation({ summary: "Ask Meta where this number's webhooks are delivered right now" })
  inboundCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.diagnostics.inboundCheck(id);
  }
}

/** The platform's Meta app webhook fields (TW-WABA-002, 003). Super admin only. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/waba', version: '2' })
export class WabaPlatformDiagnosticsController {
  constructor(private readonly diagnostics: WabaDiagnosticsService) {}

  @Get('webhook-status')
  @ApiOperation({ summary: 'Which coexistence webhook fields the Meta app is subscribed to' })
  status() {
    return this.diagnostics.webhookStatus();
  }

  @Post('webhook-subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe the missing coexistence fields, keeping the existing ones' })
  subscribe() {
    return this.diagnostics.subscribeFields();
  }
}
