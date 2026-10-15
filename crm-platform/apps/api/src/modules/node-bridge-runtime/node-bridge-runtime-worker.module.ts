import { Module, type OnModuleInit } from '@nestjs/common';
import {
  BaileysSocketFactory,
  HISTORY_IMPORT_LIMITS,
  type HistoryImportLimits,
} from '../../infra/providers/node-bridge-runtime/baileys.socket-factory';
import { DeviceAuthStore } from '../../infra/providers/node-bridge-runtime/device-auth-store';
import {
  historyImportConfig,
  windowDaysOf,
} from '../../config/domains/whatsapp-history-import.env';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DeviceRuntimeService } from './runtime/device-runtime.service';
import { WA_SOCKET_FACTORY } from '../../infra/providers/node-bridge-runtime/socket.port';
import { DeviceLease } from './runtime/wa-redis';
import { ChatConversationsModule } from '../chat-conversations';
import { NodeBridgeRuntimeModule } from './node-bridge-runtime.module';
import { InboxBridge } from './inbox/inbox-bridge.service';

/**
 * The unofficial WhatsApp engine's runtime: sockets, leases, status, restore and commands. Imported ONLY by WorkersModule
 * (the worker process): the HTTP app never opens a WhatsApp connection.
 */
@Module({
  // ChatConversationsModule: InboxBridge injects its publisher, registry and conversations facade directly.
  imports: [NodeBridgeRuntimeModule, ChatConversationsModule],
  providers: [
    CryptoService,
    DeviceAuthStore,
    DeviceLease,
    {
      provide: HISTORY_IMPORT_LIMITS,
      useValue: {
        windowDays: (choice) => windowDaysOf(choice),
        batchSize: () => historyImportConfig().batchSize,
      } satisfies HistoryImportLimits,
    },
    BaileysSocketFactory,
    { provide: WA_SOCKET_FACTORY, useExisting: BaileysSocketFactory },
    DeviceRuntimeService,
    InboxBridge,
  ],
  exports: [DeviceRuntimeService, DeviceLease],
})
export class NodeBridgeRuntimeWorkerModule implements OnModuleInit {
  constructor(
    private readonly factory: BaileysSocketFactory,
    private readonly runtime: DeviceRuntimeService,
  ) {}

  onModuleInit(): void {
    // A proxy check made while building a socket is kept on the device row.
    this.factory.proxyResults = { report: (o, d, r) => this.runtime.recordProxyResult(o, d, r) };
  }
}
