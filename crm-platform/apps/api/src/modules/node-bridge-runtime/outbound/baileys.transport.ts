import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
import type { EngineTransport, OpenTransport, SenderRef } from './outbound';
import { OutboundRegistry } from './outbound-registry.service';
import { DeviceControlService } from '../runtime/device-control.service';

/**
 * The unofficial engine's transport (TW-NODE-022 to 025): a send goes to the worker that owns the device's socket, or straight
 * to it when this process is that worker. The number must be connected: the answer says so, with Reference's own words.
 */
@Injectable()
export class BaileysTransport implements EngineTransport, OnModuleInit {
  constructor(
    private readonly registry: OutboundRegistry,
    private readonly control: DeviceControlService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  onModuleInit(): void {
    this.registry.register('baileys', this);
  }

  async open(orgId: number, sender: SenderRef): Promise<OpenTransport> {
    // The one door every send path (broadcast, campaign, scheduled message, flow) goes through to reach a Baileys socket.
    await this.unofficial.assertEnabled();
    return {
      send: (command, context) => this.control.sendMessage(orgId, sender.id, command, context),
    };
  }
}
