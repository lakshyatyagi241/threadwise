import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { COMMAND_TIMEOUT_MS, type DeviceCommand, type DeviceCommandResult } from './device-command';
import { waKeys } from './wa-redis';

const POLL_MS = 200;

export interface DeviceStatusView {
  /** `connected`, `disconnected` or `needs_pair`: the device row's own status. */
  status: string;
  /** What the runtime last reported (`Ready`, `Qr generated`, `Reconnecting`, ...), when it said anything recently. */
  label: string | null;
  /** The QR waiting to be scanned, if any. */
  qr: string | null;
  /** WaDesk's progress bar: 100 when linked, 30 with a QR showing, else 50. */
  progress: number;
}

/**
 * What the Devices screens call to pair, link by code and unlink a number (WD-NODE-008, 009, 010). The work is done by the
 * worker that owns the device; this publishes the command and waits for its answer. WaDesk's Laravel made the same calls as
 * HTTP requests to the bridge and answered a 502 when the bridge was not there; here a missing worker is a clear message.
 */
@Injectable()
export class DeviceControlService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Starts a pairing and returns the QR (or `connected` when the device is already linked). Within 35 s. */
  requestQr(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    return this.send({ type: 'qr', orgId, deviceId });
  }

  /** The 8-character code that links the phone without a QR. The same code is returned for 2 minutes. */
  requestPairingCode(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    return this.send({ type: 'code', orgId, deviceId });
  }

  /** Unlinks the device from the phone and forgets its session (the product's "Disconnect"). */
  terminate(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    return this.send({ type: 'terminate', orgId, deviceId });
  }

  /**
   * A pure read (WaDesk's `client-status`): nothing is started or stopped. WaDesk also had `check-connection`, a GET that
   * unlinked any device that was not ready at that moment, including one that was merely reconnecting. It is not ported.
   */
  async status(orgId: number, deviceId: number): Promise<DeviceStatusView | null> {
    const device = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT status FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`,
      );
      return res.rows[0] as { status: string } | undefined;
    });
    if (!device) return null;
    const [reported, qr] = await Promise.all([
      this.redis.get(waKeys.status(orgId, deviceId)),
      this.redis.get(waKeys.qr(orgId, deviceId)),
    ]);
    const label = reported ? (JSON.parse(reported) as { label: string }).label : null;
    return {
      status: device.status,
      label,
      qr,
      progress: device.status === 'connected' ? 100 : qr ? 30 : 50,
    };
  }

  private async send(command: {
    type: DeviceCommand['type'];
    orgId: number;
    deviceId: number;
  }): Promise<DeviceCommandResult> {
    const id = randomUUID();
    const receivers = await this.redis.publish(
      waKeys.commandChannel,
      JSON.stringify({ ...command, id }),
    );
    if (receivers === 0) {
      return { ok: false, status: 'error', message: 'The WhatsApp worker is not running.' };
    }
    const until = Date.now() + COMMAND_TIMEOUT_MS[command.type];
    while (Date.now() < until) {
      const raw = await this.redis.get(waKeys.commandResult(id));
      if (raw) return JSON.parse(raw) as DeviceCommandResult;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return { ok: false, status: 'timeout', message: 'The WhatsApp worker did not answer in time.' };
  }
}
