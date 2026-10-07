/**
 * Which number a single send leaves from (TW-API-118). Pure: the reads are in the repository, so every rule below is testable on its own.
 *
 * A "sender" is something that can carry WhatsApp: an unofficial number (`device`) or a Cloud API connection (`config`); each one maps to
 * the inbox channel that sends for it. Reference's order is kept: an explicit pick wins, then the newest connected unofficial number, then the
 * primary connection, then any connected one, then any unofficial number even if it is not connected.
 */

/** Channel kinds a send can use: WhatsApp, and the development simulator, which stands in for it where it is switched on. */
export const SEND_CHANNEL_KINDS: ReadonlySet<string> = new Set([
  'whatsapp_qr',
  'whatsapp_cloud',
  'simulator',
]);

export interface SenderCandidate {
  /** The device's or the connection's uuid: what `GET /devices` lists and `device_id` takes. */
  id: string;
  source: 'device' | 'config';
  /** `baileys` for a device, else the connection's provider (`waba`, `twilio`). */
  provider: string;
  /** The inbox channel that sends for it; null while there is none (a number that never connected). */
  channelUuid: string | null;
  channelKind: string | null;
  channelConnected: boolean;
  /** Devices only: the stored pairing status. */
  deviceStatus: string | null;
  active: boolean;
  /** The row's internal order: higher is newer. */
  recency: number;
  isPrimary: boolean;
  connectedAt: Date | null;
}

export interface OtherChannel {
  uuid: string;
  kind: string;
  connected: boolean;
}

export type SenderChoice =
  | { outcome: 'channel'; channelUuid: string; kind: string }
  /** The pick is a channel that does not carry WhatsApp (Telegram, Instagram): rejected as `wrong_channel`. */
  | { outcome: 'wrong_channel' }
  /** The pick is a number that exists but has no channel to send through yet. */
  | { outcome: 'unlinked' }
  | { outcome: 'none' };

const CONFIG_ENGINES = new Set(['waba', 'twilio', 'whatsapp_cloud', 'wbiz', 'cloud']);

/** `cfg_<id>`, `cfg-<id>`, `cfg<id>` and `<engine>:<id>`, or a bare id. */
export function parseDeviceId(raw: string): { engine: string | null; id: string } {
  const text = raw.trim();
  const colon = text.indexOf(':');
  if (colon > 0)
    return { engine: text.slice(0, colon).toLowerCase(), id: text.slice(colon + 1).trim() };
  const cfg = /^cfg[_-]?(.+)$/i.exec(text);
  if (cfg) return { engine: 'cfg', id: cfg[1]!.trim() };
  return { engine: null, id: text };
}

const byRecencyDesc = (a: SenderCandidate, b: SenderCandidate): number => b.recency - a.recency;

function pick(sender: SenderCandidate): SenderChoice {
  return sender.channelUuid && sender.channelKind
    ? { outcome: 'channel', channelUuid: sender.channelUuid, kind: sender.channelKind }
    : { outcome: 'unlinked' };
}

export function resolveSender(
  senders: readonly SenderCandidate[],
  others: readonly OtherChannel[],
  requested: string | null | undefined,
): SenderChoice {
  const explicit = requested ? parseDeviceId(requested) : null;
  if (explicit && explicit.id !== '') {
    const id = explicit.id.toLowerCase();
    const wantDevice = explicit.engine === null || explicit.engine === 'baileys';
    const wantConfig =
      explicit.engine === null || explicit.engine === 'cfg' || CONFIG_ENGINES.has(explicit.engine);
    const found =
      (wantDevice && senders.find((s) => s.source === 'device' && s.id.toLowerCase() === id)) ||
      (wantConfig && senders.find((s) => s.source === 'config' && s.id.toLowerCase() === id));
    if (found) return pick(found);

    const channel = others.find((o) => o.uuid.toLowerCase() === id);
    if (channel && SEND_CHANNEL_KINDS.has(channel.kind))
      return { outcome: 'channel', channelUuid: channel.uuid, kind: channel.kind };
    // Only a connected sender of another kind counts as a pick (Reference's sender directory lists connected ones only).
    if (channel && channel.connected) return { outcome: 'wrong_channel' };
    // An id that names nothing here, or another workspace's, is not an error: the send falls through to the default sender.
  }

  const linked = senders.filter((s) => s.channelUuid !== null);
  const devices = linked
    .filter((s) => s.source === 'device')
    .sort((a, b) => Number(b.active) - Number(a.active) || byRecencyDesc(a, b));
  const configs = linked.filter((s) => s.source === 'config' && s.provider !== 'twilio');

  const connectedDevice = devices.find((s) => s.deviceStatus === 'connected' && s.channelConnected);
  if (connectedDevice) return pick(connectedDevice);

  const primary = configs
    .filter((s) => s.isPrimary)
    .sort(
      (a, b) =>
        (b.connectedAt?.getTime() ?? 0) - (a.connectedAt?.getTime() ?? 0) || byRecencyDesc(a, b),
    )[0];
  if (primary) return pick(primary);

  const connectedConfig = configs
    .filter((s) => s.channelConnected)
    .sort(
      (a, b) =>
        (b.connectedAt?.getTime() ?? 0) - (a.connectedAt?.getTime() ?? 0) || byRecencyDesc(a, b),
    )[0];
  if (connectedConfig) return pick(connectedConfig);

  const simulator = others.find((o) => o.kind === 'simulator' && o.connected);
  if (simulator) return { outcome: 'channel', channelUuid: simulator.uuid, kind: simulator.kind };

  if (devices[0]) return pick(devices[0]);
  return { outcome: 'none' };
}
