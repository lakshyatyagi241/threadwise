import { WECHAT_AES_KEY_LENGTH, type WechatEncMode } from '@crm/contracts';

/** What the connect form decides without the network (the server checks the same). Pure. */

export interface ConnectDraft {
  accountName: string;
  appId: string;
  appSecret: string;
  verifyToken: string;
  encodingAesKey: string;
  encMode: WechatEncMode;
}

export type ConnectField = 'appId' | 'appSecret' | 'verifyToken' | 'encodingAesKey';
export type ConnectError = 'required' | 'keyLength' | 'safeNeedsKey';

/** The first problem of each field. Empty when the form can be sent. */
export function connectErrors(d: ConnectDraft): Partial<Record<ConnectField, ConnectError>> {
  const errors: Partial<Record<ConnectField, ConnectError>> = {};
  if (d.appId.trim() === '') errors.appId = 'required';
  if (d.appSecret.trim() === '') errors.appSecret = 'required';
  if (d.verifyToken.trim() === '') errors.verifyToken = 'required';
  const key = d.encodingAesKey.trim();
  if (key !== '' && key.length !== WECHAT_AES_KEY_LENGTH) errors.encodingAesKey = 'keyLength';
  else if (key === '' && d.encMode === 'safe') errors.encodingAesKey = 'safeNeedsKey';
  return errors;
}
