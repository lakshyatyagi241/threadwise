import { measureSms } from '@crm/contracts';
import type { ChannelSmsEnv } from '../../../config/domains/channel-sms.env';
import {
  BAD_RECIPIENT,
  EMPTY_BODY,
  credentialsProblem,
  describeLine,
  digitsOf,
  errorText,
  explainTwilio,
  scrub,
  twilioFrom,
  twilioRecipient,
} from './sms-rules';
import type {
  SendOptions,
  SmsCredentials,
  SmsLineKind,
  SmsLookupResult,
  SmsSendResult,
  SmsVerifyResult,
} from './sms.port';

type FetchFn = typeof fetch;

const basic = (sid: string, token: string) =>
  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

interface TwilioError {
  code?: number;
  message?: string;
}

/**
 * Twilio Programmable SMS and Lookup over plain HTTPS (TW-SMS-003, 008, 011). Plain fetch with a timeout on every call; nothing
 * here throws. Only `From` is supported (no Messaging Service), as in Reference.
 */
export class TwilioSmsClient {
  constructor(
    private readonly env: ChannelSmsEnv,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async verify(c: SmsCredentials): Promise<SmsVerifyResult> {
    const sid = c.accountSid.trim();
    const token = c.authToken.trim();
    if (!sid || !token)
      return { ok: false, error: 'Account SID and Auth Token are both required.' };
    if (!sid.startsWith('AC')) {
      return {
        ok: false,
        error:
          'That is not an Account SID. It must start with "AC" — an API Key starting "SK" will not work here. Copy the Account SID from the Twilio console home page.',
      };
    }
    try {
      const res = await this.fetchFn(
        `${this.env.SMS_TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
        {
          headers: { authorization: basic(sid, token) },
          signal: AbortSignal.timeout(this.env.SMS_VERIFY_TIMEOUT_MS),
        },
      );
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as TwilioError;
      const why = scrub(body.message?.trim() || `HTTP ${res.status}`, [sid, token]);
      return { ok: false, error: `Twilio rejected those credentials: ${why}` };
    } catch (err) {
      return { ok: false, error: `Could not reach Twilio: ${scrub(errorText(err), [sid, token])}` };
    }
  }

  async send(
    c: SmsCredentials,
    to: string,
    body: string,
    opts: SendOptions = {},
  ): Promise<SmsSendResult> {
    const problem = credentialsProblem(c);
    if (problem) return { ok: false, error: problem };
    const text = body.trim();
    if (!text) return { ok: false, error: EMPTY_BODY };
    const recipient = twilioRecipient(to);
    if (!recipient) return { ok: false, error: BAD_RECIPIENT };

    const sid = c.accountSid.trim();
    const token = c.authToken.trim();
    const form = new URLSearchParams({ From: twilioFrom(c.from), To: recipient, Body: text });
    if (opts.statusCallbackUrl) form.set('StatusCallback', opts.statusCallbackUrl);
    try {
      const res = await this.fetchFn(
        `${this.env.SMS_TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: basic(sid, token),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: form,
          signal: AbortSignal.timeout(this.env.SMS_SEND_TIMEOUT_MS),
        },
      );
      const json = (await res.json().catch(() => ({}))) as TwilioError & {
        sid?: string;
        num_segments?: string | number;
      };
      if (res.ok) {
        const reported = Number.parseInt(String(json.num_segments ?? ''), 10);
        return {
          ok: true,
          messageId: String(json.sid ?? ''),
          // Twilio's own count when it gives one; a 0 or a missing field falls back to ours.
          segments: reported > 0 ? reported : measureSms(text).segments,
        };
      }
      const code = Number(json.code ?? 0) || 0;
      return {
        ok: false,
        code: String(code),
        badCredentials: res.status === 401 || res.status === 403,
        error: scrub(explainTwilio(code, json.message, res.status), [sid, token]),
      };
    } catch (err) {
      return {
        ok: false,
        error: `Could not reach the SMS provider: ${scrub(errorText(err), [sid, token])}`,
      };
    }
  }

  /** Twilio Lookup v2 with line type intelligence (TW-SMS-008). Billed per call by Twilio. */
  async lookup(c: SmsCredentials, number: string): Promise<SmsLookupResult> {
    const digits = digitsOf(number);
    const unknown = (message: string, ok = false): SmsLookupResult => ({
      ok,
      digits,
      kind: 'unknown',
      carrier: null,
      message,
    });
    if (!digits) return unknown('That is not a phone number.');
    const sid = c.accountSid.trim();
    const token = c.authToken.trim();
    if (!sid || !token) return unknown('Connect a Twilio SMS number first.');
    try {
      const res = await this.fetchFn(
        `${this.env.SMS_TWILIO_LOOKUP_BASE}/v2/PhoneNumbers/+${digits}?Fields=line_type_intelligence`,
        {
          headers: { authorization: basic(sid, token) },
          signal: AbortSignal.timeout(this.env.SMS_VERIFY_TIMEOUT_MS),
        },
      );
      // 404: Twilio does not know the number. A verdict, not a failure of the lookup.
      if (res.status === 404) {
        return {
          ok: true,
          digits,
          kind: 'invalid',
          carrier: null,
          message: describeLine('invalid', null, null),
        };
      }
      const json = (await res.json().catch(() => ({}))) as TwilioError & {
        valid?: boolean;
        line_type_intelligence?: { type?: string | null; carrier_name?: string | null } | null;
      };
      if (!res.ok) {
        return unknown(scrub(json.message?.trim() || `HTTP ${res.status}`, [sid, token]));
      }
      if (json.valid === false) {
        return {
          ok: true,
          digits,
          kind: 'invalid',
          carrier: null,
          message: describeLine('invalid', null, null),
        };
      }
      const rawType = json.line_type_intelligence?.type?.trim() || null;
      const carrier = json.line_type_intelligence?.carrier_name?.trim() || null;
      const kind = lineKind(rawType);
      return { ok: true, digits, kind, carrier, message: describeLine(kind, rawType, carrier) };
    } catch {
      return unknown('Could not reach the lookup service.');
    }
  }
}

/** Twilio v2 names its VoIP types `fixedVoip` and `nonFixedVoip`; Reference matched only `voip`. Both are VoIP here. */
function lineKind(type: string | null): SmsLineKind {
  const t = (type ?? '').toLowerCase();
  if (t === 'mobile') return 'mobile';
  if (t === 'landline') return 'landline';
  if (t === 'voip' || t === 'fixedvoip' || t === 'nonfixedvoip') return 'voip';
  return 'unknown';
}
