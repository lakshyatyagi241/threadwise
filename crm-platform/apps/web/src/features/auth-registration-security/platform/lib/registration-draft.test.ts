import { describe, expect, it } from 'vitest';
import {
  otpTemplateCreateRequestSchema,
  registrationSettingsPatchSchema,
  registrationSettingsSchema,
} from '@crm/contracts';
import {
  buildOtpTemplateRequest,
  buildRegistrationPatch,
  isValidLegalLink,
  parseDomainList,
  patchSize,
  registrationFieldForPath,
  registrationToDraft,
} from './registration-draft';

const base = registrationSettingsSchema.parse({});
const draftOf = (over: Partial<ReturnType<typeof registrationToDraft>> = {}) => ({
  ...registrationToDraft(base),
  ...over,
});

describe('sign-up protection settings', () => {
  it('starts with work email, no temporary mail and the mobile check on', () => {
    const d = registrationToDraft(base);
    expect(d).toMatchObject({
      businessEmailOnly: true,
      blockDisposableEmail: true,
      requirePhoneVerification: true,
      blockedEmailDomains: '',
    });
  });

  it('sends only the switches that changed', () => {
    const { patch } = buildRegistrationPatch(
      base,
      draftOf({ businessEmailOnly: false, requirePhoneVerification: false }),
    );
    expect(patch).toEqual({ businessEmailOnly: false, requirePhoneVerification: false });
    expect(registrationSettingsPatchSchema.safeParse(patch).success).toBe(true);
  });

  it('reads the blocked-domain box one per line, lower-cased and without repeats', () => {
    expect(parseDomainList('Rival.com\n@other.io, rival.com;  sub.third.co.uk.\n')).toEqual({
      domains: ['rival.com', 'other.io', 'sub.third.co.uk'],
      invalid: null,
    });
    const { patch } = buildRegistrationPatch(
      base,
      draftOf({ blockedEmailDomains: 'A.com\nb.com' }),
    );
    expect(patch).toEqual({ blockedEmailDomains: ['a.com', 'b.com'] });
    expect(registrationSettingsPatchSchema.safeParse(patch).success).toBe(true);
  });

  it('names the first entry that is not a domain and sends nothing for it', () => {
    const { patch, problems } = buildRegistrationPatch(
      base,
      draftOf({ blockedEmailDomains: 'ok.com\nnot a domain!\nlocalhost' }),
    );
    expect(patch).toEqual({});
    expect(problems.blockedEmailDomains).toEqual({ code: 'domainFormat', entry: 'not' });
    expect(
      buildRegistrationPatch(base, draftOf({ blockedEmailDomains: 'localhost' })).problems
        .blockedEmailDomains,
    ).toEqual({ code: 'domainFormat', entry: 'localhost' });
  });

  it('refuses more than 500 domains and sends nothing when the list is unchanged', () => {
    const many = Array.from({ length: 501 }, (_, i) => `d${i}.com`).join('\n');
    expect(
      buildRegistrationPatch(base, draftOf({ blockedEmailDomains: many })).problems
        .blockedEmailDomains,
    ).toEqual({ code: 'tooMany', max: 500 });
    const withList = { ...base, blockedEmailDomains: ['a.com'] };
    expect(buildRegistrationPatch(withList, { ...registrationToDraft(withList) }).patch).toEqual(
      {},
    );
  });

  it('maps API paths to the new controls', () => {
    expect(registrationFieldForPath('requirePhoneVerification')).toBe('requirePhoneVerification');
    expect(registrationFieldForPath('blockedEmailDomains')).toBe('blockedEmailDomains');
  });
});

describe('buildRegistrationPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildRegistrationPatch(base, draftOf())).toEqual({ patch: {}, problems: {} });
  });

  it('sends only changed top-level fields', () => {
    const { patch } = buildRegistrationPatch(
      base,
      draftOf({ publicRegistration: false, emailVerification: 'block', trialDays: '30' }),
    );
    expect(patch).toEqual({ publicRegistration: false, emailVerification: 'block', trialDays: 30 });
  });

  it('keeps trial days when blank and rejects out-of-range values', () => {
    expect(buildRegistrationPatch(base, draftOf({ trialDays: '' })).patch).toEqual({});
    expect(
      buildRegistrationPatch(base, draftOf({ trialDays: '366' })).problems.trialDays,
    ).toMatchObject({ code: 'range', max: 365 });
    expect(
      buildRegistrationPatch(base, draftOf({ trialDays: '-1' })).problems.trialDays,
    ).toMatchObject({ code: 'range' });
    expect(buildRegistrationPatch(base, draftOf({ trialDays: '0' })).patch).toEqual({
      trialDays: 0,
    });
  });

  it('turns blank plan and cookies link into null, and a country into upper case', () => {
    const withValues = {
      ...base,
      defaultPlanId: 'pro',
      cookiesUrl: '/legal/cookies',
      defaultCountryIso: 'IN',
    };
    const { patch } = buildRegistrationPatch(
      withValues,
      draftOf({ defaultPlanId: '', cookiesUrl: '', defaultCountryIso: '' }),
    );
    expect(patch).toEqual({ defaultPlanId: null, cookiesUrl: null, defaultCountryIso: null });
    expect(buildRegistrationPatch(base, draftOf({ defaultCountryIso: 'ae' })).patch).toEqual({
      defaultCountryIso: 'AE',
    });
    expect(
      buildRegistrationPatch(base, draftOf({ defaultCountryIso: 'uae' })).problems
        .defaultCountryIso,
    ).toEqual({ code: 'countryFormat' });
  });

  it('requires the terms and privacy links and refuses unsafe ones', () => {
    expect(buildRegistrationPatch(base, draftOf({ termsUrl: '  ' })).problems.termsUrl).toEqual({
      code: 'required',
    });
    expect(
      buildRegistrationPatch(base, draftOf({ privacyUrl: 'javascript:alert(1)' })).problems
        .privacyUrl,
    ).toEqual({ code: 'link' });
    expect(
      buildRegistrationPatch(base, draftOf({ termsUrl: 'https://example.com/terms' })).patch,
    ).toEqual({ termsUrl: 'https://example.com/terms' });
  });

  it('puts OTP settings under `otp` and only when they changed', () => {
    const { patch } = buildRegistrationPatch(
      base,
      draftOf({ otpEnabled: true, otpSender: 'device:12', ttlMinutes: '10' }),
    );
    expect(patch).toEqual({ otp: { enabled: true, sender: 'device:12', ttlMinutes: 10 } });
  });

  it('sends null for a blank OTP knob (the default applies), never 0', () => {
    const custom = {
      ...base,
      otp: { ...base.otp, ttlMinutes: 20, length: 8, resendCooldownSec: 120, maxAttempts: 9 },
    };
    const { patch } = buildRegistrationPatch(
      custom,
      registrationToDraftWith(custom, {
        ttlMinutes: '',
        length: ' ',
        resendCooldownSec: '',
        maxAttempts: '',
      }),
    );
    expect(patch.otp).toEqual({
      ttlMinutes: null,
      length: null,
      resendCooldownSec: null,
      maxAttempts: null,
    });
    expect(JSON.stringify(patch)).not.toMatch(/:0[,}]/);
  });

  it('sends nothing for a blank knob when the default already applies', () => {
    const { patch } = buildRegistrationPatch(
      base,
      draftOf({ ttlMinutes: '', length: '', resendCooldownSec: '', maxAttempts: '' }),
    );
    expect(patch.otp).toBeUndefined();
  });

  it('accepts the contract: a blank knob parses as null and 0 is refused', () => {
    const custom = { ...base, otp: { ...base.otp, ttlMinutes: 20 } };
    const { patch } = buildRegistrationPatch(
      custom,
      registrationToDraftWith(custom, { ttlMinutes: '' }),
    );
    expect(registrationSettingsPatchSchema.parse(patch).otp?.ttlMinutes).toBeNull();
    expect(registrationSettingsPatchSchema.safeParse({ otp: { ttlMinutes: 0 } }).success).toBe(
      false,
    );
  });

  it('checks the OTP knob ranges and the sender format', () => {
    const { problems } = buildRegistrationPatch(
      base,
      draftOf({
        ttlMinutes: '91',
        length: '3',
        resendCooldownSec: '14',
        maxAttempts: '21',
        otpSender: 'sms:1',
      }),
    );
    expect(problems.ttlMinutes).toMatchObject({ code: 'range', min: 1, max: 90 });
    expect(problems.length).toMatchObject({ min: 4, max: 8 });
    expect(problems.resendCooldownSec).toMatchObject({ min: 15, max: 600 });
    expect(problems.maxAttempts).toMatchObject({ min: 1, max: 20 });
    expect(problems.otpSender).toEqual({ code: 'senderFormat' });
  });

  it('never writes the template: it is not a form field', () => {
    const { otp } = base;
    const withTemplate = {
      ...base,
      otp: {
        ...otp,
        template: {
          name: 'crm_signup_otp',
          kind: 'waba' as const,
          sender: 'waba:ab12',
          language: 'en_US',
          body: null,
          metaTemplateId: '1',
          status: 'pending' as const,
          codeExpirationMinutes: 5,
          submittedAt: null,
          checkedAt: null,
          rejectedReason: null,
        },
      },
    };
    expect(buildRegistrationPatch(withTemplate, registrationToDraft(withTemplate))).toEqual({
      patch: {},
      problems: {},
    });
    expect(Object.keys(registrationToDraft(withTemplate))).not.toContain('otpTemplateId');
  });

  it('accepts a registry sender reference and refuses anything else', () => {
    for (const ok of ['waba:ab12cd34', 'twilio:1', 'device:zz9', 'dev:log'])
      expect(buildRegistrationPatch(base, draftOf({ otpSender: ok })).problems).toEqual({});
    for (const bad of ['device:', 'sms:1', 'WABA:AB12', 'device:a-b', ':x'])
      expect(buildRegistrationPatch(base, draftOf({ otpSender: bad })).problems.otpSender).toEqual({
        code: 'senderFormat',
      });
  });
});

describe('buildOtpTemplateRequest', () => {
  it('asks for a sender first', () => {
    expect(buildOtpTemplateRequest(base, draftOf())).toEqual({
      body: null,
      problems: { otpSender: { code: 'senderRequired' } },
    });
    expect(buildOtpTemplateRequest(base, draftOf({ otpSender: '   ' })).problems.otpSender).toEqual(
      { code: 'senderRequired' },
    );
  });

  it('posts the sender with the changed knobs, so both are saved in the same request', () => {
    const { body, problems } = buildOtpTemplateRequest(
      base,
      draftOf({ otpSender: 'waba:ab12', otpEnabled: true, ttlMinutes: '10', length: '8' }),
    );
    expect(problems).toEqual({});
    expect(body).toEqual({
      otp: { sender: 'waba:ab12', enabled: true, ttlMinutes: 10, length: 8 },
    });
  });

  it('sends only the sender when nothing else changed, and sends null for blank knobs', () => {
    expect(buildOtpTemplateRequest(base, draftOf({ otpSender: 'twilio:cd34' })).body).toEqual({
      otp: { sender: 'twilio:cd34' },
    });
    const custom = {
      ...base,
      otp: { ...base.otp, sender: 'twilio:cd34', ttlMinutes: 20 },
    };
    expect(
      buildOtpTemplateRequest(custom, { ...registrationToDraft(custom), ttlMinutes: '' }).body,
    ).toEqual({ otp: { sender: 'twilio:cd34', ttlMinutes: null } });
    expect(
      otpTemplateCreateRequestSchema.parse(
        buildOtpTemplateRequest(custom, { ...registrationToDraft(custom), ttlMinutes: '' }).body,
      ).otp.ttlMinutes,
    ).toBeNull();
  });

  it('checks the OTP fields only: a bad field elsewhere does not block the action', () => {
    expect(
      buildOtpTemplateRequest(base, draftOf({ otpSender: 'waba:ab12', trialDays: '999' })).body,
    ).toEqual({ otp: { sender: 'waba:ab12' } });
    const bad = buildOtpTemplateRequest(
      base,
      draftOf({ otpSender: 'waba:ab12', ttlMinutes: '500' }),
    );
    expect(bad.body).toBeNull();
    expect(bad.problems.ttlMinutes).toMatchObject({ code: 'range', max: 90 });
  });
});

function registrationToDraftWith(
  settings: typeof base,
  over: Partial<ReturnType<typeof registrationToDraft>>,
) {
  return { ...registrationToDraft(settings), ...over };
}

describe('isValidLegalLink', () => {
  it('accepts site paths and http(s) URLs', () => {
    for (const ok of ['/legal/terms', 'https://example.com/t', 'http://example.com'])
      expect(isValidLegalLink(ok)).toBe(true);
  });
  it('refuses anything that could run script or leave to another host silently', () => {
    for (const bad of [
      '',
      'javascript:alert(1)',
      '//evil.test',
      'legal/terms',
      '/a b',
      'ftp://x.test',
      '/\\evil',
    ])
      expect(isValidLegalLink(bad)).toBe(false);
  });
});

describe('patchSize / registrationFieldForPath', () => {
  it('counts OTP knobs individually', () => {
    expect(patchSize({ trialDays: 3, otp: { enabled: true, length: 6 } })).toBe(3);
    expect(patchSize({})).toBe(0);
  });
  it('maps API paths to controls', () => {
    expect(registrationFieldForPath('otp.ttlMinutes')).toBe('ttlMinutes');
    expect(registrationFieldForPath('termsUrl')).toBe('termsUrl');
    expect(registrationFieldForPath('nope')).toBeNull();
  });
});
