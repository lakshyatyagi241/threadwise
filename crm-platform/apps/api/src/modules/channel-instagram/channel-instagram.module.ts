import { Module } from '@nestjs/common';
import { HttpInstagramBridgeFactory } from '../../infra/providers/channel-instagram/http-instagram-bridge.client';
import { INSTAGRAM_BRIDGE } from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { OpenInstagramPlanGate } from './_shims/open-gates';
import { INSTAGRAM_PLAN_GATE } from './_shims/tokens';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';

/**
 * The Instagram channel (IG), through the engine bridge. The shims below stand in for services other domains own; each is replaced
 * by binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [AddonsExtensionRegistryModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    AccountsRepository,
    HttpInstagramBridgeFactory,
    { provide: INSTAGRAM_BRIDGE, useExisting: HttpInstagramBridgeFactory },
    { provide: INSTAGRAM_PLAN_GATE, useClass: OpenInstagramPlanGate },
  ],
  exports: [AccountsService, AccountsRepository],
})
export class ChannelInstagramModule {}
