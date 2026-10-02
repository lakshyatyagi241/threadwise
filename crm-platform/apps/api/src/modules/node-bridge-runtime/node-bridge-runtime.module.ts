import { Module } from '@nestjs/common';
import { NodeBridgeProbe } from '../../infra/providers/node-bridge-runtime/node-bridge.probe';
import { SafeFetch } from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { NodeBridgeController } from './node-bridge.controller';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';
import { NodeInternalController } from './node-internal.controller';
import { NodeTokenGuard } from './node-token.guard';

/**
 * The Node bridge runtime (NODE). This slice: the operator's address, token and pacing panel, the shared-secret guard
 * and the one route the bridge pulls its pacing from. The platform store (PlatformSettingsService) and the audit
 * service come from the global auth module. Registered in app.module.ts.
 */
@Module({
  controllers: [NodeBridgeController, NodeInternalController],
  providers: [NodeBridgeSettingsService, NodeBridgeProbe, NodeTokenGuard, SafeFetch],
  exports: [NodeBridgeSettingsService, SafeFetch],
})
export class NodeBridgeRuntimeModule {}
