import { describe, expect, it } from 'vitest';
import { GoogleMailDriver } from '../../../src/modules/channel-email/drivers/google-mail.driver';
import { MicrosoftMailDriver } from '../../../src/modules/channel-email/drivers/microsoft-mail.driver';
import {
  MailDriverError,
  sendMayHaveCommitted,
} from '../../../src/modules/channel-email/drivers/mail-driver';
import { EmailChannelAdapter } from '../../../src/modules/channel-email/email-channel.adapter';
import { GoogleMailError } from '../../../src/infra/providers/channel-email/google-mail.errors';
import { MicrosoftMailError } from '../../../src/infra/providers/channel-email/microsoft-mail.errors';

type Failing = { fail(err: unknown, op: 'send' | 'sync'): MailDriverError };
const google = Object.create(GoogleMailDriver.prototype) as Failing;
const microsoft = Object.create(MicrosoftMailDriver.prototype) as Failing;

describe('a mail send that timed out or was cut off is never resent by itself (RF-01)', () => {
  it('only a connection that provably never left is safe to repeat', () => {
    for (const c of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
      expect(sendMayHaveCommitted(c)).toBe(false);
    for (const c of ['timeout', 'ECONNRESET', 'network', '', null, undefined])
      expect(sendMayHaveCommitted(c)).toBe(true);
  });

  it('Gmail: a send timeout or reset is outcome unknown and not retryable; a refused connection still retries', () => {
    const timeout = google.fail(new GoogleMailError('timeout', 0, 'timeout'), 'send');
    expect(timeout).toMatchObject({ outcomeMayHaveCommitted: true, retryable: false });
    const reset = google.fail(new GoogleMailError('network', 0, 'ECONNRESET'), 'send');
    expect(reset.outcomeMayHaveCommitted).toBe(true);
    const refused = google.fail(new GoogleMailError('network', 0, 'ECONNREFUSED'), 'send');
    expect(refused).toMatchObject({ outcomeMayHaveCommitted: false, retryable: true });
  });

  it('Gmail: the same timeout while syncing is an ordinary retryable failure (reads are safe to repeat)', () => {
    const sync = google.fail(new GoogleMailError('timeout', 0, 'timeout'), 'sync');
    expect(sync).toMatchObject({ outcomeMayHaveCommitted: false, retryable: true });
  });

  it('Microsoft: a send timeout is outcome unknown; a 5xx answer is a real refusal and retries', () => {
    const timeout = microsoft.fail(new MicrosoftMailError('timeout', 0, 'timeout'), 'send');
    expect(timeout).toMatchObject({ outcomeMayHaveCommitted: true, retryable: false });
    const server = microsoft.fail(
      new MicrosoftMailError('server', 503, 'ServiceUnavailable'),
      'send',
    );
    expect(server).toMatchObject({ outcomeMayHaveCommitted: false, retryable: true });
  });

  it('the channel adapter turns it into a non-retryable ChannelError carrying the flag', () => {
    const adapter = Object.create(EmailChannelAdapter.prototype) as {
      asChannelError(e: unknown): unknown;
    };
    const err = google.fail(new GoogleMailError('timeout', 0, 'timeout'), 'send');
    expect(adapter.asChannelError(err)).toMatchObject({
      code: 'MAIL_SEND_OUTCOME_UNKNOWN',
      retryable: false,
      outcomeMayHaveCommitted: true,
    });
  });
});
