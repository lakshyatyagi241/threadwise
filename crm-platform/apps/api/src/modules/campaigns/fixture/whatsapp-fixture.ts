import { FREQUENCY_CAP_ERROR_CODE } from '@crm/contracts';

/**
 * What the sandbox does with a message, decided by the recipient's number and which attempt this is, so a demo and a test can make
 * any outcome happen on purpose without any server state (the API and the worker are different processes):
 *
 *   ...<d>049   Meta's frequency cap (131049) on the first <d> sends to this number, accepted from the next: `1049` fails the original
 *               send and lets the first retry through, `2049` also fails the first retry, `9049` never goes through.
 *   ...0000     permanently undeliverable (131026) once accepted: no retry can help.
 *   ...9999     refused on the spot, as Meta refuses a number it will not message (131030): the send itself throws.
 *   anything    accepted, then delivered.
 *
 * The attempt is read from the message reference: a retry ends in `-r<k>`, the original send has no suffix (attempt 0).
 */
export type FixtureOutcome =
  | { kind: 'delivered' }
  | { kind: 'frequency_cap'; code: string; message: string }
  | { kind: 'undeliverable'; code: string; message: string }
  | { kind: 'rejected'; code: string; message: string };

export const FREQUENCY_CAP_MESSAGE =
  'This message was not delivered to maintain healthy ecosystem engagement.';

/** The retry number a message reference carries: 0 for the original send. */
export function attemptOf(clientReference: string): number {
  const m = /-r(\d+)$/.exec(clientReference);
  return m ? Number(m[1]) : 0;
}

export function fixtureOutcome(to: string, clientReference: string): FixtureOutcome {
  const digits = to.replace(/\D+/g, '');
  if (digits.endsWith('9999')) {
    return {
      kind: 'rejected',
      code: '131030',
      message: 'Recipient phone number not in allowed list',
    };
  }
  if (digits.endsWith('0000')) {
    return { kind: 'undeliverable', code: '131026', message: 'Message undeliverable' };
  }
  const cap = /(\d)049$/.exec(digits);
  if (cap) {
    const failing = Number(cap[1]);
    const attempt = attemptOf(clientReference);
    if (failing === 9 || attempt < failing) {
      return {
        kind: 'frequency_cap',
        code: FREQUENCY_CAP_ERROR_CODE,
        message: FREQUENCY_CAP_MESSAGE,
      };
    }
  }
  return { kind: 'delivered' };
}
