import type {
  MessageAction,
  SendCommand,
  SendContext,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import type {
  GroupAction,
  GroupResult,
} from '../../../infra/providers/node-bridge-runtime/socket.port';

/**
 * What the API asks a device's worker to do (TW-NODE-008, 009, 010). Reference's Laravel called the bridge's HTTP endpoints and
 * waited; here the API publishes a command and waits for the result, and the worker that owns the device's lease answers.
 */
export type DeviceCommand =
  | { id: string; type: 'qr'; orgId: number; deviceId: number }
  | { id: string; type: 'code'; orgId: number; deviceId: number }
  | { id: string; type: 'terminate'; orgId: number; deviceId: number }
  | {
      id: string;
      type: 'send';
      orgId: number;
      deviceId: number;
      command: SendCommand;
      context: SendContext;
    }
  | { id: string; type: 'act'; orgId: number; deviceId: number; action: MessageAction }
  | { id: string; type: 'group'; orgId: number; deviceId: number; action: GroupAction };

export type DeviceCommandResult =
  /** `qr_ready` with the QR string, or `connected` when the device was already linked. */
  | { ok: true; status: 'qr_ready'; qr: string }
  | { ok: true; status: 'connected'; qr: null; message: string }
  | { ok: true; status: 'code_ready'; code: string; expiresIn: number }
  | { ok: true; status: 'terminated' }
  | { ok: true; status: 'sent'; providerMessageId: string | null }
  | { ok: true; status: 'acted' }
  | { ok: true; status: 'group'; result: GroupResult }
  | {
      ok: false;
      status: 'busy' | 'timeout' | 'error' | 'not_found' | 'not_ready' | 'unsupported';
      message: string;
    };

/** How long each command may take before the API gives up (Reference: 30 s for a QR, 45 s for a code). */
export const COMMAND_TIMEOUT_MS: Record<DeviceCommand['type'], number> = {
  qr: 35_000,
  code: 50_000,
  terminate: 15_000,
  // The socket's own query timeout is 120 s: a slow send must not be reported failed while it may still be delivered.
  send: 130_000,
  act: 130_000,
  group: 60_000,
};
