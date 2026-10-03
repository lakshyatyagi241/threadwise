import { Module, type OnModuleInit } from '@nestjs/common';
import { BaileysSocketFactory } from '../../infra/providers/node-bridge-runtime/baileys.socket-factory';
import { DeviceAuthStore } from '../../infra/providers/node-bridge-runtime/device-auth-store';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DeviceRuntimeService } from './runtime/device-runtime.service';
import { WA_SOCKET_FACTORY } from '../../infra/providers/node-bridge-runtime/socket.port';
import { DeviceLease } from './runtime/wa-redis';
import { NodeBridgeRuntimeModule } from './node-bridge-runtime.module';

/**
 * The unofficial WhatsApp engine's runtime: sockets, leases, status, restore and commands. Imported ONLY by WorkersModule
 * (the worker process): the HTTP app never opens a WhatsApp connection.
 */
@Module({
  imports: [NodeBridgeRuntimeModule],
  providers: [
    CryptoService,
    DeviceAuthStore,
    DeviceLease,
    BaileysSocketFactory,
    { provide: WA_SOCKET_FACTORY, useExisting: BaileysSocketFactory },
    DeviceRuntimeService,
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
