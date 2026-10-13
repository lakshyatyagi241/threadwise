/**
 * The SMS providers as this app needs them (TW-SMS-010). Twilio and MSG91 sit behind one gateway so everything above is written
 * against it and tests use a fake. Every call returns a plain result and never throws: a provider being down is an expected
 * outcome of a send (one recipient fails), not an exception that kills a run.
 */

export type SmsProviderKind = 'twilio' | 'msg91';

/** What a send needs of a sender, already decrypted. MSG91 keeps its auth key in `authToken` (never in `accountSid`). */
export interface SmsCredentials {
  provider: SmsProviderKind;
  /** The From number or alphanumeric id as stored. MSG91 does not send with it, but a sendable sender has one. */
  from: string;
  accountSid: string;
  authToken: string;
  /** MSG91 only: the DLT-registered sender (the header). */
  senderId: string;
  /** MSG91 only: the approved DLT template id. Present selects the flow route, blank the plain route. */
  dltTemplateId: string;
}

export type SmsVerifyResult = { ok: true } | { ok: false; error: string };

export type SmsSendResult =
  | { ok: true; messageId: string; segments: number }
  | {
      ok: false;
      /** An operator sentence (TW-SMS-013). Never contains a key. */
      error: string;
      /** The provider's own code (Twilio's numeric code as text, MSG91's code or the HTTP status). */
      code?: string;
      /** The provider refused the key itself, so every later send will fail too. */
      badCredentials?: boolean;
    };

export interface SendOptions {
  /** Twilio only: where it reports delivery. Without one Twilio never says delivered or failed. */
  statusCallbackUrl?: string;
}

export type SmsLineKind = 'mobile' | 'landline' | 'voip' | 'invalid' | 'unknown';

export interface SmsLookupResult {
  /** False when the provider could not answer (not a verdict on the number). */
  ok: boolean;
  digits: string;
  kind: SmsLineKind;
  carrier: string | null;
  /** A plain sentence for the operator (TW-SMS-008 rule 10). */
  message: string;
}

export interface SmsGateway {
  /** Proves the keys before anything is stored (TW-SMS-003, 004). */
  verify(creds: SmsCredentials): Promise<SmsVerifyResult>;
  /** One message to one number. `body` is the final text; it is trimmed here. */
  send(creds: SmsCredentials, to: string, body: string, opts?: SendOptions): Promise<SmsSendResult>;
  /** Twilio Lookup: mobile, landline or invalid. Twilio senders only. */
  lookup(creds: SmsCredentials, number: string): Promise<SmsLookupResult>;
}
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');
