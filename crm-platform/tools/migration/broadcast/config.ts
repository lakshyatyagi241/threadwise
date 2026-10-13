/**
 * The visible switches of the broadcast step (campaigns + recipient logs). Every default is the one recommended in spec A and is listed
 * in the README under "Stage 2: broadcasts". The values a run used are recorded in migration.run_log (`_bcast` / `options`), and
 * reconcile compares its own flags with them.
 */
export interface BroadcastOptions {
  /** Q-default 3: `send_attempts` written on a FAILED recipient. The campaign sweeper re-runs failed rows whose send_attempts is below 3. */
  failedSendAttempts?: number;
  /** default false: campaigns with test=true are excluded TEST_BROADCAST. */
  keepTestBroadcasts?: boolean;
  /** default cancelled: the terminal status a Waboo status that is not completed / failed / cancelled is imported as. */
  nonTerminalStatus?: 'cancelled' | 'failed';
}

export interface BroadcastSettings {
  failedSendAttempts: number;
  keepTestBroadcasts: boolean;
  nonTerminalStatus: 'cancelled' | 'failed';
}

/** The smallest value that keeps the sweeper (`status = 'failed' AND send_attempts < 3`) away from an imported failed row. */
export const MIN_FAILED_SEND_ATTEMPTS = 3;

export class BroadcastConfigError extends Error {
  constructor(message: string) {
    super(`BROADCAST_CONFIG: ${message}`);
  }
}

export function resolveBroadcast(o: BroadcastOptions = {}): BroadcastSettings {
  const failedSendAttempts = o.failedSendAttempts ?? MIN_FAILED_SEND_ATTEMPTS;
  if (
    !Number.isInteger(failedSendAttempts) ||
    failedSendAttempts < MIN_FAILED_SEND_ATTEMPTS ||
    failedSendAttempts > 100
  )
    throw new BroadcastConfigError(
      `--failed-send-attempts must be a whole number from ${MIN_FAILED_SEND_ATTEMPTS} to 100 (below ${MIN_FAILED_SEND_ATTEMPTS} the campaign sweeper would run an imported failed recipient again)`,
    );
  const nonTerminalStatus = o.nonTerminalStatus ?? 'cancelled';
  if (nonTerminalStatus !== 'cancelled' && nonTerminalStatus !== 'failed')
    throw new BroadcastConfigError(
      '--nonterminal-status must be "cancelled" or "failed": an imported campaign must end in a terminal status that no sender picks up',
    );
  return {
    failedSendAttempts,
    keepTestBroadcasts: o.keepTestBroadcasts ?? false,
    nonTerminalStatus,
  };
}
