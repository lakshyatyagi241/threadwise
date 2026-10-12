import { forwardRef, Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { DeviceGroupsController } from './device-groups.controller';
import { DeviceGroupsLegacyDirectory } from './device-groups-legacy-directory';
import { DeviceGroupsRepository } from './device-groups.repository';
import { DeviceGroupsService } from './device-groups.service';
import { DeviceGroupsSyncService } from './device-groups-sync.service';
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
 * is the HTTP side and reaches the runtime only through DeviceControlService (Redis commands). It also serves the groups of a number
 * (`devices/:id/groups`, BL-095 groups) from the directory the worker keeps. The engine gate, audit, outbox, RBAC, the
 * database and Redis are global. Registered in app.module.ts.
 */
@Module({
  imports: [
    forwardRef(() => NodeBridgeRuntimeModule),
    forwardRef(() => ChatConversationsModule),
    PlansCoreModule,
  ],
  controllers: [DevicesController, DeviceGroupsController],
  providers: [
    DevicesRepository,
    DevicesService,
    DevicePairingService,
    RiskNoticeService,
    DeviceLimits,
    UnofficialEngineGuard,
    DeviceGroupsRepository,
    DeviceGroupsLegacyDirectory,
    DeviceGroupsSyncService,
    DeviceGroupsService,
  ],
  // The worker side (WhatsappDevicesBaileysWorkerModule) shares the directory sync; the groups API itself is HTTP only.
  exports: [DeviceGroupsSyncService],
})
export class WhatsappDevicesBaileysModule {}
