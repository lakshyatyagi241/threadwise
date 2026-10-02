import { Controller, Get, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';
import { NodeTokenGuard } from './node-token.guard';

/**
 * What the Node bridge calls on the API (the Laravel-to-Node contract, WD-NODE-002, 029). No session: the shared
 * `X-Node-Token` is the only credential. The path is the bridge's own (`/api/...`), not ours, so the existing bridge
 * works unchanged.
 */
@ApiExcludeController()
@Public()
@UseGuards(NodeTokenGuard)
@Controller({ path: 'api', version: VERSION_NEUTRAL })
export class NodeInternalController {
  constructor(private readonly settings: NodeBridgeSettingsService) {}

  @Get('whatsapp-message-settings')
  messageSettings() {
    return this.settings.messageSettings();
  }
}
