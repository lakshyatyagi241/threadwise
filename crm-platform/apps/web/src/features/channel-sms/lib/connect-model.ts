import {
  connectSmsSenderSchema,
  type ConnectSmsSenderInput,
  type SmsProvider,
} from '@crm/contracts';

/** The connect form as typed (TW-SMS-002). Every field is text; the contract turns it into the request. */
export interface ConnectForm {
  provider: SmsProvider;
  fromNumber: string;
  accountSid: string;
  authToken: string;
  senderId: string;
  dltTemplateId: string;
  ratePerSegment: string;
  currency: string;
}

export const EMPTY_CONNECT: ConnectForm = {
  provider: 'twilio',
  fromNumber: '',
  accountSid: '',
  authToken: '',
  senderId: '',
  dltTemplateId: '',
  ratePerSegment: '',
  currency: 'USD',
};

/** Message keys under `sms.connect.errors`; the screen translates them, so no English lives in this file. */
export type ConnectErrorKey =
  | 'fromRequired'
  | 'fromTooLong'
  | 'sidTooLong'
  | 'sidShape'
  | 'tokenRequired'
  | 'tokenTooLong'
  | 'senderIdTooLong'
  | 'dltTemplateTooLong'
  | 'rateInvalid'
  | 'currencyTooLong';

export type ConnectErrors = Partial<Record<keyof ConnectForm, ConnectErrorKey>>;

/**
 * The checks the browser can make before the provider is asked (the server repeats them and verifies the credentials).
 * The Twilio keys may stay blank (the workspace's WhatsApp keys are reused), but a typed SID must look like one: an API key
 * starting "SK" is the usual mistake. MSG91 has only the key, held in the token field, and it is required.
 */
export function validateConnect(f: ConnectForm): ConnectErrors {
  const e: ConnectErrors = {};
  const from = f.fromNumber.trim();
  const sid = f.accountSid.trim();
  const token = f.authToken.trim();
  if (from === '') e.fromNumber = 'fromRequired';
  else if (from.length > 32) e.fromNumber = 'fromTooLong';
  if (f.provider === 'msg91') {
    if (token === '') e.authToken = 'tokenRequired';
  } else if (sid !== '') {
    if (sid.length > 64) e.accountSid = 'sidTooLong';
    else if (!sid.startsWith('AC')) e.accountSid = 'sidShape';
  }
  if (token.length > 255) e.authToken = 'tokenTooLong';
  if (f.senderId.trim().length > 16) e.senderId = 'senderIdTooLong';
  if (f.dltTemplateId.trim().length > 64) e.dltTemplateId = 'dltTemplateTooLong';
  const rate = f.ratePerSegment.trim();
  if (rate !== '' && !(Number.isFinite(Number(rate)) && Number(rate) >= 0))
    e.ratePerSegment = 'rateInvalid';
  if (f.currency.trim().length > 8) e.currency = 'currencyTooLong';
  return e;
}

/**
 * The request for a form that passed `validateConnect`. DLT fields belong to MSG91 only (a Twilio sender ignores them), so a
 * Twilio form never sends them; the Twilio SID belongs to Twilio only, so an MSG91 form never sends it (the key goes in the
 * token field, the one place the server reads it from).
 */
export function toConnectInput(f: ConnectForm): ConnectSmsSenderInput {
  const msg91 = f.provider === 'msg91';
  return connectSmsSenderSchema.parse({
    provider: f.provider,
    fromNumber: f.fromNumber,
    accountSid: msg91 ? '' : f.accountSid,
    authToken: f.authToken,
    senderId: msg91 ? f.senderId : '',
    dltTemplateId: msg91 ? f.dltTemplateId : '',
    ratePerSegment: f.ratePerSegment,
    currency: f.currency,
  });
}
