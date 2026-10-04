import { describe, expect, it } from 'vitest';
import { parseIceServersEnv } from '../../../src/modules/calling-voice/calling-support';

describe('the operator ICE list (TW-CALL-009)', () => {
  it('reads STUN and TURN entries and keeps their credentials', () => {
    const text = JSON.stringify([
      { urls: 'stun:stun.example.org:3478' },
      {
        urls: ['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:5349'],
        username: 'u',
        credential: 'p',
      },
    ]);
    expect(parseIceServersEnv(text)).toEqual([
      { urls: 'stun:stun.example.org:3478' },
      {
        urls: ['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:5349'],
        username: 'u',
        credential: 'p',
      },
    ]);
  });

  it('drops an entry that does not fit, and gives nothing for bad JSON, a non-list or nothing', () => {
    expect(
      parseIceServersEnv(JSON.stringify([{ urls: '' }, { nope: 1 }, { urls: 'stun:ok' }, 7])),
    ).toEqual([{ urls: 'stun:ok' }]);
    expect(parseIceServersEnv('not json')).toEqual([]);
    expect(parseIceServersEnv('{"urls":"stun:x"}')).toEqual([]);
    expect(parseIceServersEnv('')).toEqual([]);
    expect(parseIceServersEnv(undefined)).toEqual([]);
  });
});
