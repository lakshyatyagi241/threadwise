import {
  DEVICE_CONNECTION_STATES,
  DEVICE_STATE_REASONS,
  type DeviceConnectionState,
} from '@crm/contracts';

/**
 * The connection state of a personal number as the screens read it (spec section 8). The eight values are the server's
 * `connection_state`; the browser never asserts one. Everything here is pure so the badge, the actions and the copy can be
 * tested without a screen.
 */
export const CONNECTION_STATES = DEVICE_CONNECTION_STATES;
export type ConnectionState = DeviceConnectionState;

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export function isConnectionState(value: unknown): value is ConnectionState {
  return typeof value === 'string' && (CONNECTION_STATES as readonly string[]).includes(value);
}

/**
 * The pill of a state. `labelKey` is under `whatsapp-devices-baileys`. A state this build does not know (the server can be
 * newer than the page) reads as a neutral "Unknown" instead of crashing or pretending to be connected.
 */
export function stateBadge(state: string): { tone: BadgeTone; labelKey: string } {
  switch (state) {
    case 'connected':
      return { tone: 'success', labelKey: 'state.connected' };
    case 'awaiting_qr':
      return { tone: 'warning', labelKey: 'state.awaiting_qr' };
    case 'awaiting_pairing_code':
      return { tone: 'warning', labelKey: 'state.awaiting_pairing_code' };
    case 'connecting':
      return { tone: 'warning', labelKey: 'state.connecting' };
    case 'created':
      return { tone: 'neutral', labelKey: 'state.created' };
    case 'disconnected':
      return { tone: 'neutral', labelKey: 'state.disconnected' };
    case 'logged_out':
      return { tone: 'danger', labelKey: 'state.logged_out' };
    case 'error':
      return { tone: 'danger', labelKey: 'state.error' };
    default:
      return { tone: 'neutral', labelKey: 'state.unknown' };
  }
}

/** The reasons the server may attach to a state (spec 8.1 and 8.3). Anything else is not shown as text. */
export const STATE_REASONS = DEVICE_STATE_REASONS;

/** Message key (under `whatsapp-devices-baileys`) for a reason, or null when there are no words for it. */
export function reasonKey(reason: string | null | undefined): string | null {
  return reason && (STATE_REASONS as readonly string[]).includes(reason)
    ? `reason.${reason}`
    : null;
}

/** What the primary button of a row does. `null`: nothing to offer right now (a link is being made or is live). */
export type RowAction = 'link' | 'relink' | 'retry' | 'reconnect' | null;

export function primaryAction(state: string): RowAction {
  switch (state) {
    case 'created':
      return 'link';
    case 'disconnected':
      return 'reconnect';
    case 'logged_out':
      return 'relink';
    case 'error':
      return 'retry';
    default:
      return null;
  }
}

/** A pairing may start from these states only; from any other the server wants `relink` (spec R1, 8.2). */
export function isPairable(state: string): boolean {
  return ['created', 'disconnected', 'logged_out', 'error'].includes(state);
}

/** A link or an attempt exists: it can be disconnected, and the phone number cannot be edited. */
export function hasLiveLink(state: string): boolean {
  return ['awaiting_qr', 'awaiting_pairing_code', 'connecting', 'connected'].includes(state);
}

/** The number of a device can be edited only while no session exists (spec 10.2, PATCH). */
export function canEditNumber(state: string): boolean {
  return ['created', 'error', 'logged_out'].includes(state);
}

/** Disconnect makes sense whenever a link or an attempt exists. */
export function canDisconnect(state: string): boolean {
  return hasLiveLink(state);
}

export type StateFilter = 'all' | 'connected' | 'disconnected';
export const STATE_FILTERS: readonly StateFilter[] = ['all', 'connected', 'disconnected'];

/** Tabs All / Connected / Disconnected (spec 13.2): "disconnected" holds everything that is not live. */
export function matchesFilter(state: string, filter: StateFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'connected') return state === 'connected';
  return !['connected', 'connecting', 'awaiting_qr', 'awaiting_pairing_code'].includes(state);
}

export interface FilterableDevice {
  name: string;
  phone: string;
  connectionState: string;
}

/** Narrowing of the loaded list by tab and by name or number. */
export function filterDevices<T extends FilterableDevice>(
  items: readonly T[],
  filter: StateFilter,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  return items.filter(
    (d) =>
      matchesFilter(d.connectionState, filter) &&
      (q === '' ||
        d.name.toLowerCase().includes(q) ||
        (digits !== '' && d.phone.replace(/\D/g, '').includes(digits))),
  );
}
