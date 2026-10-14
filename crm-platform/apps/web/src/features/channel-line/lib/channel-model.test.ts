import { describe, expect, it } from 'vitest';
import {
  channelHealth,
  connectReady,
  needsChannelId,
  rotationActionKey,
  rotationBody,
  shortWebhook,
  turnsRotationOff,
} from './channel-model';

describe('channelHealth', () => {
  it('paused wins, then an error means attention, else live', () => {
    expect(channelHealth({ active: false, lastError: 'x' })).toBe('paused');
    expect(channelHealth({ active: true, lastError: 'webhook refused' })).toBe('attention');
    expect(channelHealth({ active: true, lastError: null })).toBe('live');
  });
});

describe('connectReady', () => {
  it('needs both the token and the secret', () => {
    expect(connectReady('tok', 'sec')).toBe(true);
    expect(connectReady(' ', 'sec')).toBe(false);
    expect(connectReady('tok', '')).toBe(false);
  });
});

describe('needsChannelId', () => {
  it('asks while the channel has only the bot user id', () => {
    expect(needsChannelId({ lineChannelId: 'U4af49806' })).toBe(true);
    expect(needsChannelId({ lineChannelId: null })).toBe(true);
    expect(needsChannelId({ lineChannelId: '1234567890' })).toBe(false);
  });
});

describe('rotationBody', () => {
  it('trims everything and sends the Channel ID only when typed', () => {
    expect(rotationBody({ kid: ' k ', key: ' pem ', channelId: ' ' })).toEqual({
      assertionKid: 'k',
      assertionPrivateKey: 'pem',
    });
    expect(rotationBody({ kid: 'k', key: 'pem', channelId: '42' })).toEqual({
      assertionKid: 'k',
      assertionPrivateKey: 'pem',
      channelId: '42',
    });
  });

  it('a blank key id or key turns rotation off', () => {
    expect(turnsRotationOff({ kid: '', key: 'pem' })).toBe(true);
    expect(turnsRotationOff({ kid: 'k', key: ' ' })).toBe(true);
    expect(turnsRotationOff({ kid: 'k', key: 'pem' })).toBe(false);
  });

  it('the button says enable until rotation is on, then re-issue', () => {
    expect(rotationActionKey({ rotationEnabled: false })).toBe('enableRotation');
    expect(rotationActionKey({ rotationEnabled: true })).toBe('reissue');
  });
});

describe('shortWebhook', () => {
  it('cuts a long address and keeps a short one', () => {
    expect(shortWebhook('https://a.test/x')).toBe('https://a.test/x');
    expect(shortWebhook('h'.repeat(80))).toHaveLength(65);
  });
});
