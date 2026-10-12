import { MAIL_CONNECT_OUTCOMES, type MailConnectOutcome } from '@crm/contracts';

export interface OutcomeView {
  tone: 'success' | 'danger' | 'warning';
  /** Message key under `email.outcome`. */
  key: MailConnectOutcome;
}

/** Reads the `?email=<outcome>` the OAuth callback redirect carries back; anything else is not an outcome. */
export function outcomeFromParam(value: string | null | undefined): MailConnectOutcome | null {
  if (!value) return null;
  return (MAIL_CONNECT_OUTCOMES as readonly string[]).includes(value)
    ? (value as MailConnectOutcome)
    : null;
}

export function outcomeView(outcome: MailConnectOutcome): OutcomeView {
  switch (outcome) {
    case 'connected':
      return { tone: 'success', key: outcome };
    case 'denied':
    case 'limit':
    case 'not_configured':
      return { tone: 'warning', key: outcome };
    default:
      return { tone: 'danger', key: outcome };
  }
}
