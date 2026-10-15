import { describe, expect, it } from 'vitest';
import { channelStatement, effectiveChannels, toggleChannel } from './channels';

const names = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'email' };

describe('notice channels', () => {
  it('a notice saved before the choice covers WhatsApp and email', () => {
    expect(effectiveChannels([])).toEqual(['whatsapp', 'email']);
    expect(effectiveChannels(['sms'])).toEqual(['sms']);
  });
  it('never unticks the last channel', () => {
    expect(toggleChannel(['sms'], 'sms', false)).toEqual(['sms']);
    expect(toggleChannel(['sms'], 'email', true)).toEqual(['sms', 'email']);
  });
  it('writes the chosen channels into the sentence', () => {
    expect(channelStatement('Updates on {channels}.', ['email', 'whatsapp'], names, 'en')).toBe(
      'Updates on WhatsApp and email.',
    );
  });
});
