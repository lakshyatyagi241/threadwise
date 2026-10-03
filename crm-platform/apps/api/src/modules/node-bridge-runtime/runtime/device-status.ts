/**
 * Device status (TW-NODE-012). Reference's bridge posted free-text strings and Laravel bucketed them by substring; here the
 * runtime reports a small closed set, and the same bucketing rules are kept for the label each one maps to, so the screens and
 * the sender checks read what they always did.
 */

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
