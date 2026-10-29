import { describe, expect, it, vi } from 'vitest';
import { MailCallbackController } from '../../../src/modules/channel-email/mail-callback.controller';

// Google may be registered with the mailbox address for the workspace Google account: that redirect must end in the consent flow.
const run = (owns: boolean) => {
  const connect = { callback: vi.fn().mockResolvedValue('web/mailbox') };
  const account = {
    ownsState: vi.fn().mockReturnValue(owns),
    callback: vi.fn().mockResolvedValue('web/google-account/confirm?request=r'),
  };
  const res = { redirect: vi.fn() };
  const ctl = new MailCallbackController(connect as never, account as never);
  return { connect, account, res, go: () => ctl.callback({ code: 'c', state: 's' }, res as never) };
};

describe('mail google callback', () => {
  it('hands a Google-account state to the consent flow', async () => {
    const t = run(true);
    await t.go();
    expect(t.res.redirect).toHaveBeenCalledWith(302, 'web/google-account/confirm?request=r');
    expect(t.connect.callback).not.toHaveBeenCalled();
  });

  it('keeps a mailbox state on the mailbox flow', async () => {
    const t = run(false);
    await t.go();
    expect(t.res.redirect).toHaveBeenCalledWith(302, 'web/mailbox');
    expect(t.account.callback).not.toHaveBeenCalled();
  });
});
