import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type WabaPlatformCallback } from '@crm/contracts';
import { ConfigService } from '@nestjs/config';
import { ActorKinds } from '../../common/decorators';
import type { Env } from '../../config/env.schema';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WabaConfigService } from './waba-config.service';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { Inject } from '@nestjs/common';
import { inboundUrlKey, verifyTokenFor, webhookUrl } from './waba-rules';

/**
 * What the console's WhatsApp page shows read-only: the URL and token to paste into the Meta app (TW-WABA-001).
 * Super admin only: the verify token is a handshake secret.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/waba', version: '2' })
export class WabaPlatformController {
  constructor(
    private readonly cfg: WabaConfigService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  @Get('callback')
  @ApiOperation({ summary: 'Webhook URL and verify token to set in the Meta app' })
  async callback(): Promise<WabaPlatformCallback> {
    await this.cfg.refresh();
    const key = this.config.get('CREDENTIALS_ENCRYPTION_KEY', { infer: true });
    const base = this.env.WABA_WEBHOOK_PUBLIC_URL ?? this.config.get('APP_URL', { infer: true });
    return {
      webhookUrl: webhookUrl(base, inboundUrlKey(key)),
      verifyToken: verifyTokenFor(
        this.env.WABA_VERIFY_TOKEN ?? this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true }),
        key,
      ),
      fields: ['messages', 'message_template_status_update'],
    };
  }
}
