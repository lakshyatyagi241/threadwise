/**
 * Device status (TW-NODE-012). Reference's bridge posted free-text strings and Laravel bucketed them by substring; here the
 * runtime reports a small closed set, and the same bucketing rules are kept for the label each one maps to, so the screens and
 * the sender checks read what they always did.
 */

import type { DeviceConnectionState, DeviceStateReason } from '@crm/contracts';

export type RuntimeStatus =
  | 'connecting'
  | 'syncing'
  | 'reconnecting'
  | 'qr'
  | 'code'
  | 'open'
  | 'logged_out'
  | 'pair_failed'
  | 'code_failed'
  | 'mismatch'
  | 'disconnected';

/** `devices.status`: what the Devices screen and the senders read. */
export type DeviceStatus = 'connected' | 'disconnected' | 'needs_pair';

/** The bridge's label for a status, as Reference's panels showed it (`Qr generated`, `Ready`, ...). */
export function statusLabel(s: RuntimeStatus, reason?: string): string {
  switch (s) {
    case 'connecting':
      return 'Connecting';
    case 'syncing':
      return 'Syncing data';
    case 'reconnecting':
      return 'Reconnecting';
    case 'qr':
      return 'Qr generated';
    case 'code':
      return 'Code generated';
    case 'open':
      return 'Ready';
    case 'logged_out':
      return 'Logged Out';
    case 'mismatch':
      return 'Mismatch';
    case 'disconnected':
      return 'Disconnected';
    case 'pair_failed':
      return reason ?? 'Pair failed';
    case 'code_failed':
      return reason ?? 'Pairing failed';
  }
}

/**
 * Which of the three device states a label is (Reference `nodeStatusCallback`): connected only for exactly ready, connected,
 * paired or open; disconnected when it names a logout, a failed connection or pairing, or a mismatch; anything else is "needs
 * pairing" until it settles.
 */
export function deviceStatusOf(label: string): DeviceStatus {
  const l = label.toLowerCase();
  if (['ready', 'connected', 'paired', 'open'].includes(l)) return 'connected';
  if (
    [
      'logged out',
      'logged_out',
      'disconnected',
      'connection failed',
      'connection_failed',
      'pair failed',
      'mismatch',
    ].some((m) => l.includes(m))
  ) {
    return 'disconnected';
  }
  return 'needs_pair';
}

/**
 * The richer state beside `status` (spec section 8.1): what a person watching a pairing needs to see. Written by the runtime in the
 * same UPDATE as `status`, never by the browser. `status` stays the three-valued field the senders and dashboards read.
 */
export interface StateView {
  state: DeviceConnectionState;
  reason: DeviceStateReason | null;
}

/** The slice of a status report this mapping reads (a `StatusReport` satisfies it). */
export interface StateInput {
  status: RuntimeStatus;
  /** The label for a failed pairing (`Pair failed: QR timeout`). */
  reason?: string;
  /** The reason code when the session knows it (a close code, a user's disconnect, a swept session). */
  stateReason?: DeviceStateReason;
}

/**
 * Every runtime status to a state and a reason code (spec section 11.2). A reason is a short code, never the library's own words:
 * the pair-failure label is matched, not copied. `forbidden` and `unlinked_on_phone` are both "WhatsApp ended the link" (R8: a
 * ban cannot be told from an unlink, so there is no `banned` state).
 */
export function connectionStateOf(i: StateInput): StateView {
  switch (i.status) {
    case 'qr':
      return { state: 'awaiting_qr', reason: null };
    case 'code':
      return { state: 'awaiting_pairing_code', reason: null };
    case 'connecting':
    case 'syncing':
    case 'reconnecting':
      return { state: 'connecting', reason: null };
    case 'open':
      return { state: 'connected', reason: null };
    case 'logged_out':
      return { state: 'logged_out', reason: i.stateReason ?? 'unlinked_on_phone' };
    case 'pair_failed':
      return { state: 'error', reason: i.stateReason ?? pairFailureReason(i.reason) };
    case 'code_failed':
      return { state: 'error', reason: 'code_failed' };
    case 'mismatch':
      return { state: 'error', reason: 'mismatch' };
    case 'disconnected':
      return { state: 'disconnected', reason: i.stateReason ?? 'user' };
  }
}

/** `Pair failed: QR timeout`, `Pair failed: device limit reached`, anything else: a reason code. */
function pairFailureReason(label: string | undefined): DeviceStateReason {
  const l = (label ?? '').toLowerCase();
  if (l.includes('qr timeout') || l.includes('qr expired')) return 'qr_timeout';
  if (l.includes('device limit')) return 'device_limit_reached';
  return 'pair_failed';
}
