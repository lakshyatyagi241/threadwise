import { describe, expect, it } from 'vitest';
import { evaluateOtpActivation } from '../../../src/modules/auth/platform/otp-activation';

const tpl = (sender: string, status: 'pending' | 'approved' | 'rejected' | 'local') => ({
  sender,
  status,
});
const base = {
  enabled: true,
  sender: 'twilio:ab12',
  template: null,
  senderState: 'ok' as const,
};

describe('registration OTP activation rule', () => {
  it('is off while the switch is off, whatever else is true', () => {
    expect(evaluateOtpActivation({ ...base, enabled: false })).toEqual({
      active: false,
      reason: 'disabled',
    });
  });

  it('needs a sender, and one that exists and is complete', () => {
    expect(evaluateOtpActivation({ ...base, sender: null, senderState: 'missing' }).reason).toBe(
      'no_sender',
    );
    expect(evaluateOtpActivation({ ...base, senderState: 'missing' }).reason).toBe(
      'sender_missing',
    );
    expect(evaluateOtpActivation({ ...base, sender: 'nonsense', senderState: 'ok' }).reason).toBe(
      'sender_missing',
    );
    expect(evaluateOtpActivation({ ...base, senderState: 'incomplete' }).reason).toBe(
      'sender_incomplete',
    );
    expect(evaluateOtpActivation({ ...base, senderState: 'dev_in_production' }).reason).toBe(
      'dev_in_production',
    );
  });

  it('is active for Twilio and bridge senders without any template', () => {
    expect(evaluateOtpActivation(base)).toEqual({ active: true, reason: 'active' });
    expect(evaluateOtpActivation({ ...base, sender: 'device:cd34' })).toMatchObject({
      active: true,
    });
    expect(evaluateOtpActivation({ ...base, sender: 'dev:log' })).toMatchObject({ active: true });
  });

  it('keeps a WhatsApp Business sender off until its template is APPROVED', () => {
    const waba = { ...base, sender: 'waba:ef56' };
    expect(evaluateOtpActivation(waba).reason).toBe('template_missing');
    expect(evaluateOtpActivation({ ...waba, template: tpl('waba:ef56', 'pending') }).reason).toBe(
      'template_pending',
    );
    expect(evaluateOtpActivation({ ...waba, template: tpl('waba:ef56', 'rejected') }).reason).toBe(
      'template_rejected',
    );
    expect(evaluateOtpActivation({ ...waba, template: tpl('waba:ef56', 'approved') })).toEqual({
      active: true,
      reason: 'active',
    });
  });

  it('ignores a template that was created for a different sender', () => {
    expect(
      evaluateOtpActivation({
        ...base,
        sender: 'waba:ef56',
        template: tpl('waba:other', 'approved'),
      }).reason,
    ).toBe('template_missing');
  });
});
