import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../../infra/db/database.service';
import { UnsupportedSendError } from '../../../infra/providers/node-bridge-runtime/outbound.port';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { COMMAND_TIMEOUT_MS, type DeviceCommand, type DeviceCommandResult } from './device-command';
import type {
  MessageAction,
  SendCommand,
  SendContext,
  SendOutcome,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import type { GroupAction } from '../../../infra/providers/node-bridge-runtime/socket.port';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../../auth/unofficial-whatsapp.port';
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
  /**
   * Set by the worker's runtime: a send for a device this very process owns skips Redis. In the HTTP process it stays null and
   * every send goes to the owning worker.
   */
  local: {
    owns(orgId: number, deviceId: number): boolean;
    send(
      orgId: number,
      deviceId: number,
      command: SendCommand,
      context: SendContext,
    ): Promise<SendOutcome>;
    act(orgId: number, deviceId: number, action: MessageAction): Promise<void>;
    groups(orgId: number, deviceId: number, action: GroupAction): Promise<DeviceCommandResult>;
  } | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  /** Sends a message through a connected number. The error says what to do when the number is not connected. */
  async sendMessage(
    orgId: number,
    deviceId: number,
    command: SendCommand,
    context: SendContext,
  ): Promise<SendOutcome> {
    // Every action on a device refuses with WA_UNOFFICIAL_DISABLED while the platform switch is off or the workspace is not allowed (owner decisions 2026-10-05, 2026-10-06).
    await this.unofficial.assertEnabledFor(orgId);
    if (this.local?.owns(orgId, deviceId))
      return this.local.send(orgId, deviceId, command, context);
    // The file does not travel in the command (it is JSON on a channel): it waits in Redis for the worker that owns the device.
    let wire = command;
    if (command.type === 'media' && command.data) {
      const { data, ...rest } = command;
      const bufferKey = `wa:out:${orgId}:${deviceId}:${randomUUID()}`;
      await this.redis.set(bufferKey, data, 'EX', 300);
      wire = { ...rest, bufferKey };
    }
    const r = await this.sendIfOwned({
      type: 'send',
      orgId,
      deviceId,
      command: wire,
      context,
    });
    if (r.ok && r.status === 'sent') return { providerMessageId: r.providerMessageId };
    throw failure(r);
  }

  async messageAction(orgId: number, deviceId: number, action: MessageAction): Promise<void> {
    await this.unofficial.assertEnabledFor(orgId);
    if (this.local?.owns(orgId, deviceId)) return this.local.act(orgId, deviceId, action);
    const r = await this.sendIfOwned({ type: 'act', orgId, deviceId, action });
    if (!(r.ok && r.status === 'acted')) throw failure(r);
  }

  /** Group directory and management on a device's number (WD-NODE-021). */
  async groupAction(
    orgId: number,
    deviceId: number,
    action: GroupAction,
  ): Promise<DeviceCommandResult> {
    await this.unofficial.assertEnabledFor(orgId);
    if (this.local?.owns(orgId, deviceId)) return this.local.groups(orgId, deviceId, action);
    return this.sendIfOwned({ type: 'group', orgId, deviceId, action });
  }

  /** A device nobody owns cannot send: say so at once instead of waiting out the command's long timeout. */
  private async sendIfOwned(
    command:
      | {
          type: 'send';
          orgId: number;
          deviceId: number;
          command: SendCommand;
          context: SendContext;
        }
      | { type: 'act'; orgId: number; deviceId: number; action: MessageAction }
      | { type: 'group'; orgId: number; deviceId: number; action: GroupAction },
  ): Promise<DeviceCommandResult> {
    if (!(await this.redis.exists(waKeys.lease(command.orgId, command.deviceId)))) {
      return { ok: false, status: 'not_ready', message: 'Sender device is not connected.' };
    }
    return this.send(command);
  }

  /** Starts a pairing and returns the QR (or `connected` when the device is already linked). Within 35 s. */
  async requestQr(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    await this.unofficial.assertEnabledFor(orgId);
    return this.send({ type: 'qr', orgId, deviceId });
  }

  /** The 8-character code that links the phone without a QR. The same code is returned for 2 minutes. */
  async requestPairingCode(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    await this.unofficial.assertEnabledFor(orgId);
    return this.send({ type: 'code', orgId, deviceId });
  }

  /** Unlinks the device from the phone and forgets its session (the product's "Disconnect"). */
  async terminate(orgId: number, deviceId: number): Promise<DeviceCommandResult> {
    await this.unofficial.assertEnabledFor(orgId);
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

/** The error a failed command becomes for a caller that sends. */
function failure(r: DeviceCommandResult): Error {
  const message = 'message' in r ? r.message : 'The message could not be sent.';
  return r.ok === false && r.status === 'unsupported'
    ? new UnsupportedSendError(message)
    : new Error(message);
}
