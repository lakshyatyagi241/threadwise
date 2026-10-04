/** Messages the embedded connect page may send to the shell (WD-ASHELL-029). */
export const CONNECT_EVENTS = {
  /** A device finished connecting. */
  connected: 'wadesk:device-connected',
  /** The embedded page asks to close. */
  close: 'wadesk:connect-close',
} as const;

/** Any element or code can open the sheet by dispatching this on `window`. */
export const OPEN_CONNECT_EVENT = 'shell:connect-device';
/** Raised on `window` once a device is connected, for pickers that want to reload their list. */
export const DEVICE_CONNECTED_EVENT = 'device:connected';

/** The page embedded in the sheet. `embed=1` asks it to draw without the shell. */
export const CONNECT_URL = '/channels/whatsapp?embed=1';

export interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

/**
 * Reads a message from the embedded page. WaDesk acted on any window's message; here the sender must be this app's own origin
 * and the sheet's own frame, so no other page can close the sheet or trigger a refresh.
 */
export function parseConnectMessage(
  event: MessageLike,
  ownOrigin: string,
  frame: unknown,
): 'connected' | 'close' | null {
  if (event.origin !== ownOrigin || frame == null || event.source !== frame) return null;
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type === CONNECT_EVENTS.connected) return 'connected';
  if (type === CONNECT_EVENTS.close) return 'close';
  return null;
}
