import { Controller, Get, Inject, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';
import { NodeTokenGuard } from './node-token.guard';

/**
 * What the Node bridge calls on the API (the Laravel-to-Node contract, TW-NODE-002, 029). No session: the shared
 * `X-Node-Token` is the only credential. The path is the bridge's own (`/api/...`), not ours, so the existing bridge
 * works unchanged.
 */
@ApiExcludeController()
@Public()
@UseGuards(NodeTokenGuard)
@Controller({ path: 'api', version: VERSION_NEUTRAL })
export class NodeInternalController {
  constructor(
    private readonly settings: NodeBridgeSettingsService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  /**
   * With the unofficial engine off (owner decision 2026-10-05) the answer is inert: `success: false` and no pacing values,
   * so a bridge that still polls has nothing to act on. It stays a 200, so the poller does not alarm or retry in a loop.
   */
  @Get('whatsapp-message-settings')
  async messageSettings() {
    if (!(await this.unofficial.isEnabled())) {
      return { success: false as const, disabled: true as const };
    }
    return this.settings.messageSettings();
  }
}
