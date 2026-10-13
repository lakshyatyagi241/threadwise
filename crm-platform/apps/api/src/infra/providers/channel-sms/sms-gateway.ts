import { Inject, Injectable } from '@nestjs/common';
import { readChannelSmsEnv, type ChannelSmsEnv } from '../../../config/domains/channel-sms.env';
import { Msg91SmsClient } from './msg91-sms.client';
import { TwilioSmsClient } from './twilio-sms.client';
import type {
  SendOptions,
  SmsCredentials,
  SmsGateway,
  SmsLookupResult,
  SmsSendResult,
  SmsVerifyResult,
} from './sms.port';

export const SMS_ENV = Symbol('SMS_ENV');
export const smsEnvProvider = { provide: SMS_ENV, useFactory: () => readChannelSmsEnv() };

/** Routes a call to the provider the sender is on (TW-SMS-010 rule 1: `msg91` selects MSG91, anything else Twilio). */
@Injectable()
export class SmsProviderGateway implements SmsGateway {
  private readonly twilio: TwilioSmsClient;
  private readonly msg91: Msg91SmsClient;

  constructor(@Inject(SMS_ENV) env: ChannelSmsEnv) {
    this.twilio = new TwilioSmsClient(env);
    this.msg91 = new Msg91SmsClient(env);
  }

  verify(creds: SmsCredentials): Promise<SmsVerifyResult> {
    return creds.provider === 'msg91' ? this.msg91.verify(creds) : this.twilio.verify(creds);
  }

  send(
    creds: SmsCredentials,
    to: string,
    body: string,
    opts?: SendOptions,
  ): Promise<SmsSendResult> {
    return creds.provider === 'msg91'
      ? this.msg91.send(creds, to, body)
      : this.twilio.send(creds, to, body, opts);
  }

  lookup(creds: SmsCredentials, number: string): Promise<SmsLookupResult> {
    if (creds.provider === 'msg91') {
      return Promise.resolve({
        ok: false,
        digits: number.replace(/\D+/g, ''),
        kind: 'unknown',
        carrier: null,
        message: 'Number checking needs a Twilio account; this number is on msg91.',
      });
    }
    return this.twilio.lookup(creds, number);
  }
}
