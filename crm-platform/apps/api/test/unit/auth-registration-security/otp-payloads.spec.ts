import { describe, expect, it } from 'vitest';
import {
  LOCAL_OTP_TEMPLATE_NAME,
  OTP_TEMPLATE_LANGUAGE,
  WABA_OTP_TEMPLATE_NAME,
  buildBridgeBody,
  buildMetaTemplateCreateBody,
  buildMetaTemplateUpdateBody,
  buildTwilioForm,
  buildWabaSendBody,
  digitsOf,
  e164Of,
  localTemplateBody,
  mapMetaTemplateStatus,
  renderOtpText,
} from '../../../src/infra/providers/auth-registration-security/otp-payloads';

describe('Meta authentication template (create / update)', () => {
  it('builds the AUTHENTICATION template with a copy-code button and the TTL as its expiry', () => {
    expect(
      buildMetaTemplateCreateBody({
        name: WABA_OTP_TEMPLATE_NAME,
        language: OTP_TEMPLATE_LANGUAGE,
        ttlMinutes: 7,
      }),
    ).toEqual({
      name: 'crm_signup_otp',
      language: 'en_US',
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 7 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    });
  });

  it('uses the same components when an existing template is edited', () => {
    const create = buildMetaTemplateCreateBody({ name: 'x', language: 'en_US', ttlMinutes: 30 });
    expect(buildMetaTemplateUpdateBody({ ttlMinutes: 30 })).toEqual({
      components: create.components,
    });
  });

  it('names templates with characters Meta accepts', () => {
    expect(WABA_OTP_TEMPLATE_NAME).toMatch(/^[a-z0-9_]+$/);
    expect(LOCAL_OTP_TEMPLATE_NAME).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('Meta Cloud API send body', () => {
  it('sends the approved template with the code as body variable and as the copy-code button', () => {
    expect(
      buildWabaSendBody({
        to: '+91 98765-43221',
        templateName: 'crm_signup_otp',
        language: 'en_US',
        code: '482915',
      }),
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543221',
      type: 'template',
      template: {
        name: 'crm_signup_otp',
        language: { code: 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482915' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '482915' }],
          },
        ],
      },
    });
  });
});

describe('Twilio form body', () => {
  it('addresses WhatsApp numbers: From whatsapp:+<from>, To whatsapp:+<digits>', () => {
    const form = buildTwilioForm({
      from: '+1 (415) 523-8886',
      to: '+919876543221',
      body: '_123456_ is your code.',
    });
    expect(Object.fromEntries(form)).toEqual({
      From: 'whatsapp:+14155238886',
      To: 'whatsapp:+919876543221',
      Body: '_123456_ is your code.',
    });
    expect(form.toString()).toContain('From=whatsapp%3A%2B14155238886');
  });

  it('adds the plus to a From number stored without one', () => {
    expect(e164Of('14155238886')).toBe('+14155238886');
    expect(
      buildTwilioForm({ from: '14155238886', to: '+44 7700 900123', body: 'x' }).get('To'),
    ).toBe('whatsapp:+447700900123');
  });
});

describe('bridge body', () => {
  it('posts the digits of the destination and the message', () => {
    expect(buildBridgeBody({ to: '+919876543221', message: 'hi' })).toEqual({
      targetPhoneNumber: '919876543221',
      message: 'hi',
    });
    expect(digitsOf('+91 (987) 654-3221')).toBe('919876543221');
  });
});

describe('message text for non-template senders', () => {
  it('replaces {{1}}, {{code}} and {{otp}} (any case, any spacing) in the template body', () => {
    expect(
      renderOtpText({
        templateBody: '{{1}} / {{ code }} / {{OTP}} expires in 5 minutes',
        code: '1234',
        ttlMinutes: 5,
        appName: 'Acme',
      }),
    ).toBe('1234 / 1234 / 1234 expires in 5 minutes');
  });

  it('falls back to a plain sentence with the code, the expiry and a do-not-share warning', () => {
    const text = renderOtpText({
      templateBody: null,
      code: '654321',
      ttlMinutes: 10,
      appName: 'Acme CRM',
    });
    expect(text).toContain('654321');
    expect(text).toContain('Acme CRM');
    expect(text).toContain('10 minutes');
    expect(text.toLowerCase()).toContain('do not share');
  });

  it('treats a blank body like no template, and says "1 minute" in the singular', () => {
    expect(renderOtpText({ templateBody: '  ', code: '1', ttlMinutes: 1, appName: 'A' })).toContain(
      '1 minute.',
    );
    expect(localTemplateBody(1)).toBe('{{1}} is your verification code. It expires in 1 minute.');
    expect(localTemplateBody(15)).toBe(
      '{{1}} is your verification code. It expires in 15 minutes.',
    );
  });
});

describe('Meta template status mapping', () => {
  it('maps Meta words onto pending / approved / rejected', () => {
    expect(mapMetaTemplateStatus('APPROVED')).toEqual({ status: 'approved', rejectedReason: null });
    expect(mapMetaTemplateStatus('pending')).toEqual({ status: 'pending', rejectedReason: null });
    expect(mapMetaTemplateStatus('IN_APPEAL').status).toBe('pending');
    expect(mapMetaTemplateStatus(undefined).status).toBe('pending');
    expect(mapMetaTemplateStatus('REJECTED', 'INVALID_FORMAT')).toEqual({
      status: 'rejected',
      rejectedReason: 'INVALID_FORMAT',
    });
    expect(mapMetaTemplateStatus('REJECTED', 'NONE').rejectedReason).toMatch(/rejected/i);
    expect(mapMetaTemplateStatus('PAUSED')).toMatchObject({ status: 'rejected' });
    expect(mapMetaTemplateStatus('DISABLED').rejectedReason).toContain('DISABLED');
  });
});
