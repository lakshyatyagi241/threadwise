import { forwardRef, Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { DeviceLimits } from './device-limits.service';
import { DevicePairingService } from './device-pairing.service';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { RiskNoticeService } from './risk-notice.service';
import { UnofficialEngineGuard } from './unofficial-engine.guard';

/**
 * Personal WhatsApp numbers: add, link by QR or pairing code, rename, disconnect, delete, and the risk notice that must be accepted first
 * (docs/specs/personal-whatsapp-connect.md; BL-095 phase 1). The sockets live in the worker (NodeBridgeRuntimeWorkerModule); this module
 * is the HTTP side and reaches the runtime only through DeviceControlService (Redis commands). The engine gate, audit, outbox, RBAC, the
 * database and Redis are global. Registered in app.module.ts.
 */
@Module({
  imports: [
    forwardRef(() => NodeBridgeRuntimeModule),
    forwardRef(() => ChatConversationsModule),
    PlansCoreModule,
  ],
  controllers: [DevicesController],
  providers: [
    DevicesRepository,
    DevicesService,
    DevicePairingService,
    RiskNoticeService,
    DeviceLimits,
    UnofficialEngineGuard,
  ],
})
export class WhatsappDevicesBaileysModule {}
