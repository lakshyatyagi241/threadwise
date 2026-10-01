import { describe, expect, it } from 'vitest';
import type { OtpSenderView, OtpTemplateState } from '@crm/contracts';
import {
  addableKinds,
  buildSenderCreate,
  buildSenderPatch,
  canRefreshTemplate,
  emptySenderDraft,
  normalizePhoneInput,
  senderFieldForPath,
  senderRef,
  senderSummary,
  senderToDraft,
  templateFor,
  templateIsStale,
  templateState,
} from './otp-senders';

const waba: OtpSenderView = {
  kind: 'waba',
  id: 'ab12cd34',
  label: 'Main',
  phoneNumberId: '100200300',
  wabaId: '555666777',
  graphBaseUrl: 'https://graph.facebook.com/v21.0',
  hasSecret: true,
};
const twilio: OtpSenderView = {
  kind: 'twilio',
  id: 'tw000001',
  label: 'Twilio',
  accountSid: 'AC' + 'a'.repeat(32),
  fromNumber: '+14155238886',
  apiBaseUrl: 'https://api.twilio.com',
  hasSecret: true,
};
const device: OtpSenderView = {
  kind: 'device',
  id: 'dv000001',
  label: 'Bridge',
  bridgeUrl: 'http://127.0.0.1:3003',
  senderNumber: '919000000001',
  hasSecret: false,
};

const tpl = (over: Partial<OtpTemplateState> = {}): OtpTemplateState => ({
  name: 'crm_signup_otp',
  kind: 'waba',
  sender: 'waba:ab12cd34',
  language: 'en_US',
  body: null,
  metaTemplateId: '99',
  status: 'pending',
  codeExpirationMinutes: 5,
  submittedAt: '2026-10-01T09:00:00.000Z',
  checkedAt: null,
  rejectedReason: null,
  ...over,
});

describe('sender references and kinds', () => {
  it('builds <kind>:<id> and offers the log sender only outside production', () => {
    expect(senderRef(waba)).toBe('waba:ab12cd34');
    expect(addableKinds(true)).toEqual(['waba', 'twilio', 'device', 'dev']);
    expect(addableKinds(false)).toEqual(['waba', 'twilio', 'device']);
  });

  it('describes a sender in one line', () => {
    expect(senderSummary(waba)).toBe('100200300');
    expect(senderSummary(twilio)).toBe('+14155238886');
    expect(senderSummary(device)).toBe('919000000001 @ 127.0.0.1:3003');
    expect(senderSummary({ kind: 'dev', id: 'x', label: 'l', hasSecret: false })).toBe('');
  });

  it('maps an API field path to a control, ignoring unknown ones', () => {
    expect(senderFieldForPath('bridgeUrl')).toBe('bridgeUrl');
    expect(senderFieldForPath('secret')).toBe('secret');
    expect(senderFieldForPath('nope')).toBeNull();
  });
});

describe('buildSenderCreate', () => {
  it('requires every field of the kind and the secret', () => {
    const { body, problems } = buildSenderCreate(emptySenderDraft('waba'));
    expect(body).toBeNull();
    expect(problems).toEqual({
      label: { code: 'required' },
      phoneNumberId: { code: 'required' },
      wabaId: { code: 'required' },
      secret: { code: 'required' },
    });
  });

  it('builds a WhatsApp Business sender, leaving the address out when blank so the default applies', () => {
    const { body } = buildSenderCreate({
      ...emptySenderDraft('waba'),
      label: ' Main ',
      phoneNumberId: '100200300',
      wabaId: '555666777',
      secret: ' EAAG-token ',
    });
    expect(body).toEqual({
      kind: 'waba',
      label: 'Main',
      phoneNumberId: '100200300',
      wabaId: '555666777',
      secret: 'EAAG-token',
    });
  });

  it('checks ids, SIDs, numbers and addresses', () => {
    const w = buildSenderCreate({
      ...emptySenderDraft('waba'),
      label: 'x',
      phoneNumberId: 'abc',
      wabaId: '12',
      graphBaseUrl: 'ftp://graph',
      secret: 's',
    });
    expect(w.problems).toEqual({
      phoneNumberId: { code: 'digits' },
      wabaId: { code: 'digits' },
      graphBaseUrl: { code: 'url' },
    });
    const t = buildSenderCreate({
      ...emptySenderDraft('twilio'),
      label: 'x',
      accountSid: 'AC123',
      fromNumber: '12',
      secret: 's',
    });
    expect(t.problems).toEqual({
      accountSid: { code: 'accountSid' },
      fromNumber: { code: 'phone' },
    });
    const d = buildSenderCreate({
      ...emptySenderDraft('device'),
      label: 'x'.repeat(61),
      bridgeUrl: 'http://user:pw@host',
      senderNumber: '0123456789',
      secret: 's',
    });
    expect(d.problems).toEqual({
      label: { code: 'tooLong', max: 60 },
      bridgeUrl: { code: 'url' },
      senderNumber: { code: 'phone' },
    });
  });

  it('builds Twilio, bridge and log senders', () => {
    expect(
      buildSenderCreate({
        ...emptySenderDraft('twilio'),
        label: 'T',
        accountSid: 'AC' + 'b'.repeat(32),
        fromNumber: '+1 415 523 8886',
        apiBaseUrl: 'https://api.example.test',
        secret: 'tok',
      }).body,
    ).toEqual({
      kind: 'twilio',
      label: 'T',
      accountSid: 'AC' + 'b'.repeat(32),
      fromNumber: '+1 415 523 8886',
      apiBaseUrl: 'https://api.example.test',
      secret: 'tok',
    });
    expect(
      buildSenderCreate({
        ...emptySenderDraft('device'),
        label: 'D',
        bridgeUrl: 'http://127.0.0.1:3003',
        senderNumber: '919000000001',
        secret: 'tok',
      }).body,
    ).toMatchObject({ kind: 'device', senderNumber: '919000000001' });
    expect(buildSenderCreate({ ...emptySenderDraft('dev'), label: 'Log' }).body).toEqual({
      kind: 'dev',
      label: 'Log',
    });
  });
});

describe('buildSenderPatch', () => {
  it('sends nothing when nothing changed, and never the secret when it is blank', () => {
    expect(buildSenderPatch(waba, senderToDraft(waba))).toEqual({ patch: {}, problems: {} });
  });

  it('sends only changed fields, and a typed secret', () => {
    const { patch } = buildSenderPatch(twilio, {
      ...senderToDraft(twilio),
      label: 'Renamed',
      fromNumber: '+14155550000',
      secret: ' new-token ',
    });
    expect(patch).toEqual({ label: 'Renamed', fromNumber: '+14155550000', secret: 'new-token' });
  });

  it('restores the default address when it is cleared', () => {
    const custom = { ...waba, graphBaseUrl: 'http://127.0.0.1:9' } as OtpSenderView;
    expect(buildSenderPatch(custom, { ...senderToDraft(custom), graphBaseUrl: '' }).patch).toEqual({
      graphBaseUrl: 'https://graph.facebook.com/v21.0',
    });
  });

  it('refuses a required field that was emptied and a malformed one', () => {
    const { patch, problems } = buildSenderPatch(device, {
      ...senderToDraft(device),
      label: '  ',
      bridgeUrl: 'nope',
    });
    expect(patch).toEqual({});
    expect(problems).toEqual({ label: { code: 'required' }, bridgeUrl: { code: 'url' } });
  });
});

describe('template presentation', () => {
  it('shows a template only for the sender it was made for', () => {
    const settings = { otp: { template: tpl() } };
    expect(templateFor(settings as never, 'waba:ab12cd34')).toEqual(tpl());
    expect(templateFor(settings as never, 'waba:other')).toBeNull();
    expect(templateFor(settings as never, '')).toBeNull();
    expect(templateState(null)).toBe('none');
    expect(templateState(tpl({ status: 'approved' }))).toBe('approved');
    expect(templateState(tpl({ status: 'local', kind: 'local' }))).toBe('local');
  });

  it('can refresh only a template Meta knows about', () => {
    expect(canRefreshTemplate(tpl())).toBe(true);
    expect(canRefreshTemplate(tpl({ metaTemplateId: null }))).toBe(false);
    expect(canRefreshTemplate(tpl({ kind: 'local' }))).toBe(false);
    expect(canRefreshTemplate(null)).toBe(false);
  });

  it('notices a template made for another expiry', () => {
    expect(templateIsStale(tpl({ codeExpirationMinutes: 5 }), 5)).toBe(false);
    expect(templateIsStale(tpl({ codeExpirationMinutes: 5 }), 10)).toBe(true);
    expect(templateIsStale(null, 10)).toBe(false);
    expect(templateIsStale(tpl(), null)).toBe(false);
  });
});

describe('normalizePhoneInput', () => {
  it('turns a typed number into E.164', () => {
    expect(normalizePhoneInput('+91 98765-43221')).toBe('+919876543221');
    expect(normalizePhoneInput('919876543221')).toBe('+919876543221');
    expect(normalizePhoneInput('0091 (98765) 43221')).toBe('+919876543221');
  });
  it('refuses what cannot be an international number', () => {
    for (const bad of ['', '12345', '+0123456789', 'abc', '+1234567890123456', '+91 98765 abc'])
      expect(normalizePhoneInput(bad)).toBeNull();
  });
});
