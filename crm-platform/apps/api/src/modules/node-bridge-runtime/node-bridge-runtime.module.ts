import { Module } from '@nestjs/common';
import { NodeBridgeProbe } from '../../infra/providers/node-bridge-runtime/node-bridge.probe';
import { SafeFetch } from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DeviceControlService } from './runtime/device-control.service';
import { BaileysTransport } from './outbound/baileys.transport';
import { TwilioTransport } from './outbound/twilio.transport';
import { InboundRouter, ReceiptRouter } from './runtime/routers';
import { OutboundRegistry } from './outbound/outbound-registry.service';
import { SenderResolver } from './outbound/sender-resolver.service';
import { WabaTransport } from './outbound/waba.transport';
import { NodeBridgeController } from './node-bridge.controller';
import { NodeBridgeSettingsService } from './node-bridge-settings.service';
import { NodeInternalController } from './node-internal.controller';
import { NodeTokenGuard } from './node-token.guard';

/**
 * The Node bridge runtime (NODE), API side: the operator's address, token and pacing panel, the shared-secret guard, the
 * outbound send port with its transports (Cloud API, Twilio, the unofficial engine), device control and the routers that
 * deliver inbound messages and receipts to the domains that consume them. The sockets themselves live in the worker
 * (NodeBridgeRuntimeWorkerModule). The platform store and the audit service come from the global auth module.
 * Registered in app.module.ts.
 */
@Module({
  controllers: [NodeBridgeController, NodeInternalController],
  providers: [
    NodeBridgeSettingsService,
    NodeBridgeProbe,
    NodeTokenGuard,
    SafeFetch,
    CryptoService,
    WabaTransport,
    OutboundRegistry,
    SenderResolver,
    DeviceControlService,
    BaileysTransport,
    TwilioTransport,
    InboundRouter,
    ReceiptRouter,
  ],
  exports: [
    NodeBridgeSettingsService,
    SafeFetch,
    OutboundRegistry,
    SenderResolver,
    DeviceControlService,
    InboundRouter,
    ReceiptRouter,
  ],
})
export class NodeBridgeRuntimeModule {}
