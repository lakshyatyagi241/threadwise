import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  registrationSettingsResponseSchema,
  type OtpSenderView,
  type OtpTemplateOptionsResponse,
  type OtpTemplateState,
} from '@crm/contracts';
import { renderWithMessages } from '../render-test-utils';
import { registrationToDraft } from '../lib/registration-draft';
import { OtpSection } from './otp-section';
import { OTP_SENDERS_KEY, otpTemplatesKey } from './query-keys';

const waba = (over: Partial<OtpSenderView> = {}) =>
  ({
    kind: 'waba',
    id: 'ab12cd34',
    label: 'Main line',
    phoneNumberId: '100200300',
    wabaId: '555666777',
    graphBaseUrl: 'https://graph.facebook.com/v23.0',
    hasSecret: true,
    connected: true,
    ...over,
  }) as OtpSenderView;
const unfinished = waba({
  id: 'zz99yy88',
  label: 'Half done',
  hasSecret: false,
  connected: false,
});
const twilio = {
  kind: 'twilio',
  id: 'tw000001',
  label: 'Twilio line',
  accountSid: 'AC' + 'a'.repeat(32),
  fromNumber: '+14155238886',
  apiBaseUrl: 'https://api.twilio.com',
  hasSecret: true,
  connected: true,
} as OtpSenderView;

const template = (over: Partial<OtpTemplateState> = {}): OtpTemplateState => ({
  name: 'crm_signup_otp',
  kind: 'waba',
  sender: 'waba:ab12cd34',
  language: 'en_US',
  body: null,
  metaTemplateId: '99',
  status: 'approved',
  codeExpirationMinutes: 5,
  submittedAt: '2026-10-01T09:00:00.000Z',
  checkedAt: '2026-10-01T09:05:00.000Z',
  rejectedReason: null,
  ...over,
});

function settingsWith(otp: Record<string, unknown>) {
  return registrationSettingsResponseSchema.parse({
    otp,
    otpStatus: { active: true, reason: 'active' },
  });
}

function render(
  opts: {
    senders?: OtpSenderView[];
    sender?: string | null;
    tpl?: OtpTemplateState | null;
    options?: OtpTemplateOptionsResponse;
    draftSender?: string;
    role?: 'super_admin' | 'support';
    locale?: 'en' | 'ar';
  } = {},
) {
  const sender = opts.sender === undefined ? 'waba:ab12cd34' : opts.sender;
  const settings = settingsWith({ enabled: true, sender, template: opts.tpl ?? null });
  const draft = { ...registrationToDraft(settings), otpSender: opts.draftSender ?? sender ?? '' };
  const seed: [readonly unknown[], unknown][] = [
    [OTP_SENDERS_KEY, { senders: opts.senders ?? [waba(), unfinished, twilio], devAllowed: false }],
  ];
  if (opts.options) seed.push([otpTemplatesKey(settings.otp), opts.options]);
  return renderWithMessages(
    createElement(OtpSection, {
      settings,
      draft,
      errors: {},
      canEdit: opts.role !== 'support',
      set: () => undefined,
      onProblems: () => undefined,
      onApplied: () => undefined,
      onSenderGone: () => undefined,
    }),
    { role: opts.role, locale: opts.locale, seed },
  );
}

const optionsFor = (
  over: Partial<OtpTemplateOptionsResponse> = {},
): OtpTemplateOptionsResponse => ({
  sender: 'waba:ab12cd34',
  templates: [
    {
      id: '99',
      name: 'crm_signup_otp',
      language: 'en_US',
      kind: 'waba',
      status: 'approved',
      selected: true,
      buttonLabel: 'Copy code',
    },
    {
      id: '123',
      name: 'other_auth',
      language: 'en',
      kind: 'waba',
      status: 'approved',
      selected: false,
      buttonLabel: null,
    },
  ],
  unavailableReason: null,
  ...over,
});

/** The <option> elements of the select with this id. */
function optionsOf(html: string, id: string): string[] {
  const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  expect(select, id).not.toBeNull();
  return [...select![1]!.matchAll(/<option[^>]*>[^<]*<\/option>/g)].map((m) => m[0]);
}

describe('OtpSection sender picker', () => {
  it('lists only connected senders, plus the current choice when it is unfinished', () => {
    const html = render({ sender: null });
    const options = optionsOf(html, 'reg-otpSender').join('\n');
    expect(options).toContain('Main line (WhatsApp Business)');
    expect(options).toContain('Twilio line (Twilio)');
    expect(options).not.toContain('Half done');

    const kept = optionsOf(render({ sender: 'waba:zz99yy88' }), 'reg-otpSender').join('\n');
    expect(kept).toContain('Half done (WhatsApp Business, not finished)');
  });

  it('says so when no sender is connected yet', () => {
    const html = render({ senders: [unfinished], sender: null });
    expect(html).toContain('None of your senders is connected yet');
    expect(optionsOf(html, 'reg-otpSender').join('\n')).not.toContain('Half done');
  });

  it('treats a sender without the flag as connected (an older API)', () => {
    const old = { ...waba(), connected: undefined } as OtpSenderView;
    expect(optionsOf(render({ senders: [old], sender: null }), 'reg-otpSender').join('')).toContain(
      'Main line',
    );
  });
});

describe('OtpSection template picker', () => {
  it('lists the saved template first and selected, and the other approved ones as read-only rows', () => {
    const html = render({ tpl: template(), options: optionsFor() });
    const options = optionsOf(html, 'reg-otpTemplate');
    expect(options[0]).toContain('None yet');
    expect(options[1]).toContain('crm_signup_otp (en_US), Approved');
    expect(options[1]).toContain('selected');
    expect(options[1]).not.toContain('disabled');
    expect(options[2]).toContain('other_auth (en), Approved');
    expect(options[2]).toContain('disabled');
  });

  it('shows the saved template with its own status even when Meta does not list it', () => {
    const html = render({
      tpl: template({ status: 'pending' }),
      options: optionsFor({
        templates: [
          {
            id: '99',
            name: 'crm_signup_otp',
            language: 'en_US',
            kind: 'waba',
            status: 'pending',
            selected: true,
            buttonLabel: 'Copy code',
          },
        ],
      }),
    });
    expect(optionsOf(html, 'reg-otpTemplate')[1]).toContain('Waiting for Meta');
  });

  it('names the reason when the live list could not be read', () => {
    const html = render({
      tpl: template(),
      options: optionsFor({ unavailableReason: 'The access token was refused.' }),
    });
    expect(html).toContain(
      'Meta&#x27;s template list could not be read: The access token was refused.',
    );
  });

  it('shows nothing to choose for a sender that has no template yet', () => {
    const html = render({ options: optionsFor({ templates: [] }) });
    expect(optionsOf(html, 'reg-otpTemplate')).toHaveLength(1);
  });

  it('shows no rows for an unsaved sender and asks to save it first', () => {
    const html = render({
      tpl: template(),
      options: optionsFor(),
      draftSender: 'twilio:tw000001',
    });
    expect(optionsOf(html, 'reg-otpTemplate')).toHaveLength(1);
    expect(html).toContain('Save the sender to see its templates.');
  });

  it('keeps the picker readable for roles that cannot edit', () => {
    const html = render({ tpl: template(), options: optionsFor(), role: 'support' });
    expect(optionsOf(html, 'reg-otpTemplate')).toHaveLength(3);
    expect(html).not.toMatch(/<select[^>]*id="reg-otpTemplate"[^>]*disabled/);
  });
});

describe('OtpSection template action', () => {
  it('calls the button "Create & submit OTP template" and says what it does', () => {
    const html = render();
    expect(html).toContain('Create &amp; submit OTP template');
    expect(html).toContain('WhatsApp Business goes to Meta for review');
  });

  it('has Arabic text for the new strings', () => {
    const html = render({ tpl: template(), options: optionsFor(), locale: 'ar' });
    expect(html).toContain('قالب واتساب للأعمال');
    expect(html).toContain('إنشاء قالب رمز التحقق وإرساله');
  });
});
