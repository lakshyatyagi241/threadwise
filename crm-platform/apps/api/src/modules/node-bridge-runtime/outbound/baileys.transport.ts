import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { EngineTransport, OpenTransport, SenderRef } from './outbound';
import { OutboundRegistry } from './outbound-registry.service';
import { DeviceControlService } from '../runtime/device-control.service';

/**
 * The unofficial engine's transport (WD-NODE-022 to 025): a send goes to the worker that owns the device's socket, or straight
 * to it when this process is that worker. The number must be connected: the answer says so, with WaDesk's own words.
 */
@Injectable()
export class BaileysTransport implements EngineTransport, OnModuleInit {
  constructor(
    private readonly registry: OutboundRegistry,
    private readonly control: DeviceControlService,
  ) {}

  onModuleInit(): void {
    this.registry.register('baileys', this);
  }

  async open(orgId: number, sender: SenderRef): Promise<OpenTransport> {
    return {
      send: (command, context) => this.control.sendMessage(orgId, sender.id, command, context),
    };
  }
}
