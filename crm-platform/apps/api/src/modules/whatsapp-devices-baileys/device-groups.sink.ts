import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { GroupEvent, GroupSnapshot } from '../node-bridge-runtime';
import { InboundRouter, type InboundSink } from '../node-bridge-runtime';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { DeviceGroupsSyncService } from './device-groups-sync.service';

/**
 * The group directory's place on the runtime's inbound router (TW-NODE-021): what a device's socket reads about its groups becomes
 * `wa_device_groups` rows, and what changes in a group becomes an event. Runs in the worker (registered by
 * `WhatsappDevicesBaileysWorkerModule`); the HTTP app never reads a socket.
 *
 * A workspace that is not on the unofficial allow-list gets nothing written (the gate is the same one the devices routes use), and a
 * failure here is logged and swallowed by the router so it never blocks the inbox's own sink. Group MESSAGES are the inbox bridge's
 * business, not this sink's: it takes no message.
 */
@Injectable()
export class DeviceGroupsSink implements InboundSink, OnModuleInit {
  private readonly logger = new Logger(DeviceGroupsSink.name);

  constructor(
    private readonly router: InboundRouter,
    private readonly sync: DeviceGroupsSyncService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly gate: UnofficialWhatsappGate,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  /** Group messages go to the inbox sink; this one only keeps the directory. */
  async message(): Promise<void> {
    return;
  }

  async groups(
    ctx: { orgId: number; deviceId: number },
    groups: GroupSnapshot[],
    opts: { complete: boolean },
  ): Promise<void> {
    if (!(await this.gate.isEnabledFor(ctx.orgId))) return;
    const res = await this.sync.applySnapshots(ctx.orgId, ctx.deviceId, groups, opts);
    this.logger.debug(
      { orgId: ctx.orgId, deviceId: ctx.deviceId, groups: res.rows.length, left: res.left },
      '[GROUPS] directory synced',
    );
  }

  async groupEvent(ctx: { orgId: number; deviceId: number }, event: GroupEvent): Promise<void> {
    if (!(await this.gate.isEnabledFor(ctx.orgId))) return;
    await this.sync.applyEvent(ctx.orgId, ctx.deviceId, event);
  }
}
