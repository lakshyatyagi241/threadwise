import { describe, expect, it } from 'vitest';
import {
  defaultSender,
  engineLabelState,
  isUnofficialChannelKind,
  isUnofficialDisabledError,
  isUnofficialEngine,
  isUnofficialOnlyLimit,
  isUnofficialSenderKey,
  offerChannels,
  offerEngines,
  offerSenders,
  offerSendersFor,
  submittableSenderKey,
  submittableSenderKeys,
  unofficialEnabledIn,
} from './unofficial-whatsapp';
import { ApiError } from './api/errors';

const waba = { key: 'waba:1', engine: 'waba', isDefault: false };
const twilio = { key: 'twilio:2', engine: 'twilio', isDefault: false };
const phone = { key: 'baileys:3', engine: 'baileys', isDefault: true };

describe('unofficial WhatsApp switch (pure rules)', () => {
  it('reads the switch from the entitlement set; unknown or missing counts as off', () => {
    expect(unofficialEnabledIn(new Set(['automation']))).toBe(false);
    expect(unofficialEnabledIn(new Set(['unofficial_whatsapp']))).toBe(true);
    expect(unofficialEnabledIn(['unofficial_whatsapp'])).toBe(true);
    expect(unofficialEnabledIn(null)).toBe(false);
    expect(unofficialEnabledIn(undefined)).toBe(false);
  });

  it('recognises the unofficial engine, sender keys, channel kind and the devices limit', () => {
    expect(isUnofficialEngine('baileys')).toBe(true);
    expect(isUnofficialEngine('BAILEYS')).toBe(true);
    expect(isUnofficialEngine('waba')).toBe(false);
    expect(isUnofficialEngine(null)).toBe(false);
    expect(isUnofficialSenderKey('baileys:abc')).toBe(true);
    expect(isUnofficialSenderKey('waba:abc')).toBe(false);
    expect(isUnofficialChannelKind('whatsapp_qr')).toBe(true);
    expect(isUnofficialChannelKind('whatsapp_cloud')).toBe(false);
    expect(isUnofficialOnlyLimit('devices')).toBe(true);
    expect(isUnofficialOnlyLimit('contacts')).toBe(false);
  });

  it('offers no baileys sender while the switch is off, and all of them while it is on', () => {
    expect(offerSenders([waba, phone, twilio], false).map((s) => s.key)).toEqual([
      'waba:1',
      'twilio:2',
    ]);
    expect(offerSenders([waba, phone], true).map((s) => s.key)).toEqual(['waba:1', 'baileys:3']);
  });

  it('falls back to the key prefix when a sender carries no engine', () => {
    expect(offerSenders([{ key: 'baileys:9' }, { key: 'waba:9' }], false)).toEqual([
      { key: 'waba:9' },
    ]);
  });

  it('never defaults to an unofficial sender while off, even when it is the account default', () => {
    expect(defaultSender([phone, waba, twilio], false)?.key).toBe('waba:1');
    expect(defaultSender([phone, waba], true)?.key).toBe('baileys:3');
    expect(defaultSender([phone], false)).toBeNull();
    expect(defaultSender([], false)).toBeNull();
    // the account default wins among the offered ones
    expect(defaultSender([waba, { ...twilio, isDefault: true }], false)?.key).toBe('twilio:2');
  });

  it('never submits a baileys sender key while off', () => {
    expect(submittableSenderKeys(['waba:1', 'baileys:3'], false)).toEqual(['waba:1']);
    expect(submittableSenderKeys(['waba:1', 'baileys:3'], true)).toEqual(['waba:1', 'baileys:3']);
  });

  it('makes a blank or leftover unofficial single sender the default official one while off', () => {
    const senders = [phone, waba];
    expect(submittableSenderKey('', senders, false)).toBe('waba:1');
    expect(submittableSenderKey('baileys:3', senders, false)).toBe('waba:1');
    expect(submittableSenderKey('twilio:2', senders, false)).toBe('twilio:2');
    expect(submittableSenderKey('', [phone], false)).toBe('');
    expect(submittableSenderKey('', senders, true)).toBe('');
    expect(submittableSenderKey('baileys:3', senders, true)).toBe('baileys:3');
  });

  it('drops the unofficial engine and QR channels from pickers while off', () => {
    expect(offerEngines(['waba', 'twilio', 'baileys'], false)).toEqual(['waba', 'twilio']);
    expect(offerEngines(['waba', 'baileys'], true)).toEqual(['waba', 'baileys']);
    const channels = [{ kind: 'whatsapp_cloud' }, { kind: 'whatsapp_qr' }, { kind: 'telegram' }];
    expect(offerChannels(channels, false).map((c) => c.kind)).toEqual([
      'whatsapp_cloud',
      'telegram',
    ]);
    expect(offerChannels(channels, true)).toHaveLength(3);
  });

  it('labels an existing record by engine and switch state', () => {
    expect(engineLabelState('baileys', false)).toBe('unofficialDisabled');
    expect(engineLabelState('baileys', true)).toBe('unofficial');
    expect(engineLabelState('waba', false)).toBe('official');
    expect(engineLabelState(undefined, false)).toBe('official');
  });

  it('recognises the refusal by its stable code, not by its wording', () => {
    expect(
      isUnofficialDisabledError(new ApiError(422, 'WA_UNOFFICIAL_DISABLED', 'anything at all')),
    ).toBe(true);
    expect(isUnofficialDisabledError(new ApiError(422, 'VALIDATION_FAILED', 'unofficial'))).toBe(
      false,
    );
    expect(isUnofficialDisabledError(new Error('WA_UNOFFICIAL_DISABLED'))).toBe(false);
    expect(isUnofficialDisabledError(null)).toBe(false);
  });
});

describe('offerSendersFor: the campaign screens wait for the switch instead of reading "loading" as "off"', () => {
  const all = [waba, twilio, phone];

  it('is undefined while the answer is pending or there is no list yet: show a skeleton, not an empty list', () => {
    expect(offerSendersFor(all, 'pending')).toBeUndefined();
    expect(offerSendersFor(undefined, 'on')).toBeUndefined();
  });

  it('hides the personal numbers only when the switch is known to be off', () => {
    expect(offerSendersFor(all, 'off')).toEqual([waba, twilio]);
    expect(offerSendersFor(all, 'on')).toEqual(all);
  });

  it('trusts the server list when the answer could not be read (the server never lists a personal number while the engine is off)', () => {
    expect(offerSendersFor(all, 'unknown')).toEqual(all);
  });

  it('reads the engine from the key when a sender has none', () => {
    const bare = [{ key: 'baileys:9' }, { key: 'waba:8' }];
    expect(offerSendersFor(bare, 'off')).toEqual([{ key: 'waba:8' }]);
  });
});
