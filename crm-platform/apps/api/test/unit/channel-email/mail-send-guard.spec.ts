import { describe, expect, it } from 'vitest';
import { ChannelError } from '../../../src/infra/providers/chat-conversations/channel.port';
import { MailLimits } from '../../../src/modules/channel-email/mail-limits';
import { MailSendGuard } from '../../../src/modules/channel-email/mail-send.guard';
import type { MailboxRow } from '../../../src/modules/channel-email/mailboxes.repository';
import { slidingWindow } from '../../../src/modules/channel-email/mail-rate-rules';

/** An in-memory stand-in for the Redis counters with the same window rule. */
class FakeLimits extends MailLimits {
  hits = new Map<string, number[]>();
  bounced = new Set<string>();
  now = 1_000_000_000;
  constructor() {
    super(undefined as never);
  }
  override check(key: string, windowMs: number, limit: number) {
    return Promise.resolve(slidingWindow(this.hits.get(key) ?? [], this.now, windowMs, limit));
  }
  override hit(key: string) {
    this.hits.set(key, [...(this.hits.get(key) ?? []), this.now]);
    return Promise.resolve();
  }
  override bouncedAmong(_org: number, addresses: string[]) {
    return Promise.resolve(addresses.filter((a) => this.bounced.has(a)));
  }
}

const mailbox = (limit: number | null) =>
  ({ uuid: 'mb-1', sendLimitPerHour: limit }) as unknown as MailboxRow;

describe('TW-MAIL-032: MailSendGuard', () => {
  it('lets sends through up to the mailbox cap, then answers MAIL_RATE_LIMITED with a wait', async () => {
    const limits = new FakeLimits();
    const guard = new MailSendGuard(limits);
    const mb = mailbox(2);
    for (let i = 0; i < 2; i++) {
      await guard.assertAllowed(1, mb, [`r${i}@x.org`]);
      await guard.recordSent(1, mb, [`r${i}@x.org`]);
    }
    const err = (await guard
      .assertAllowed(1, mb, ['r9@x.org'])
      .catch((e: unknown) => e)) as ChannelError;
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code: 'MAIL_RATE_LIMITED', retryable: false });
    expect(err.retryAfterMs).toBe(3_600_000);
    expect(err.message).toContain('2 emails per hour');
  });

  it('frees a slot when the hour passes and keeps mailboxes apart', async () => {
    const limits = new FakeLimits();
    const guard = new MailSendGuard(limits);
    await guard.recordSent(1, mailbox(1), []);
    await expect(guard.assertAllowed(1, mailbox(1), [])).rejects.toBeInstanceOf(ChannelError);
    await expect(
      guard.assertAllowed(1, { ...mailbox(1), uuid: 'mb-2' } as MailboxRow, []),
    ).resolves.toBeUndefined();
    limits.now += 3_600_001;
    await expect(guard.assertAllowed(1, mailbox(1), [])).resolves.toBeUndefined();
  });

  it('the platform default applies when the mailbox has no cap of its own (100 an hour)', async () => {
    const limits = new FakeLimits();
    const guard = new MailSendGuard(limits);
    limits.hits.set(
      limits.hourlyKey(1, 'mb-1'),
      Array.from({ length: 99 }, () => limits.now),
    );
    await expect(guard.assertAllowed(1, mailbox(null), [])).resolves.toBeUndefined();
    await guard.recordSent(1, mailbox(null), []);
    await expect(guard.assertAllowed(1, mailbox(null), [])).rejects.toMatchObject({
      code: 'MAIL_RATE_LIMITED',
    });
  });

  it('a burst to one recipient is retryable; a hard-bounced recipient is refused for good', async () => {
    const limits = new FakeLimits();
    const guard = new MailSendGuard(limits);
    const mb = mailbox(1000);
    for (let i = 0; i < 5; i++) await guard.recordSent(1, mb, ['a@x.org']);
    await expect(guard.assertAllowed(1, mb, ['a@x.org'])).rejects.toMatchObject({
      code: 'MAIL_RATE_LIMITED',
      retryable: true,
    });
    await expect(guard.assertAllowed(1, mb, ['b@x.org'])).resolves.toBeUndefined();
    limits.bounced.add('gone@x.org');
    await expect(guard.assertAllowed(1, mb, ['b@x.org', 'gone@x.org'])).rejects.toMatchObject({
      code: 'MAIL_RECIPIENT_BOUNCED',
      retryable: false,
    });
  });
});
