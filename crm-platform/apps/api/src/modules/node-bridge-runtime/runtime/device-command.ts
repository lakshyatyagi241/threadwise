/**
 * What the API asks a device's worker to do (WD-NODE-008, 009, 010). WaDesk's Laravel called the bridge's HTTP endpoints and
 * waited; here the API publishes a command and waits for the result, and the worker that owns the device's lease answers.
 */
export type DeviceCommand =
  | { id: string; type: 'qr'; orgId: number; deviceId: number }
  | { id: string; type: 'code'; orgId: number; deviceId: number }
  | { id: string; type: 'terminate'; orgId: number; deviceId: number };

export type DeviceCommandResult =
  /** `qr_ready` with the QR string, or `connected` when the device was already linked. */
  | { ok: true; status: 'qr_ready'; qr: string }
  | { ok: true; status: 'connected'; qr: null; message: string }
  | { ok: true; status: 'code_ready'; code: string; expiresIn: number }
  | { ok: true; status: 'terminated' }
  | { ok: false; status: 'busy' | 'timeout' | 'error' | 'not_found'; message: string };

/** How long each command may take before the API gives up (WaDesk: 30 s for a QR, 45 s for a code). */
export const COMMAND_TIMEOUT_MS: Record<DeviceCommand['type'], number> = {
  qr: 35_000,
  code: 50_000,
  terminate: 15_000,
};
