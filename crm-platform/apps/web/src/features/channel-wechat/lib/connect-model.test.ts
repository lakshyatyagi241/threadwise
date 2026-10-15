import { describe, expect, it } from 'vitest';
import { connectErrors, type ConnectDraft } from './connect-model';

const KEY = 'a'.repeat(43);
const draft = (over: Partial<ConnectDraft> = {}): ConnectDraft => ({
  accountName: '',
  appId: 'wx0123456789abcdef',
  appSecret: 'secret',
  verifyToken: 'token',
  encodingAesKey: '',
  encMode: 'compat',
  ...over,
});

describe('connectErrors', () => {
  it('a complete form has no errors; the name and the key are optional', () => {
    expect(connectErrors(draft())).toEqual({});
    expect(connectErrors(draft({ encodingAesKey: KEY, accountName: 'Shop' }))).toEqual({});
  });

  it('the AppID, the AppSecret and the Token are required, and blanks count as empty', () => {
    expect(connectErrors(draft({ appId: ' ', appSecret: '', verifyToken: '  ' }))).toEqual({
      appId: 'required',
      appSecret: 'required',
      verifyToken: 'required',
    });
  });

  it('a key that is not 43 characters is refused, whatever the mode', () => {
    expect(connectErrors(draft({ encodingAesKey: 'short' }))).toEqual({
      encodingAesKey: 'keyLength',
    });
    expect(connectErrors(draft({ encodingAesKey: KEY + 'a', encMode: 'safe' }))).toEqual({
      encodingAesKey: 'keyLength',
    });
  });

  it('safe mode needs the key', () => {
    expect(connectErrors(draft({ encMode: 'safe' }))).toEqual({ encodingAesKey: 'safeNeedsKey' });
    expect(connectErrors(draft({ encMode: 'safe', encodingAesKey: KEY }))).toEqual({});
  });
});
