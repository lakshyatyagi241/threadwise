import { measureSms } from '@crm/contracts';
import type { ChannelSmsEnv } from '../../../config/domains/channel-sms.env';
import {
  BAD_RECIPIENT,
  EMPTY_BODY,
  credentialsProblem,
  errorText,
  explainMsg91,
  msg91Recipient,
  scrub,
} from './sms-rules';
import type { SmsCredentials, SmsSendResult, SmsVerifyResult } from './sms.port';

type FetchFn = typeof fetch;

/**
 * MSG91, the domestic Indian route (TW-SMS-004, 005, 012). With a DLT template id on the sender the message goes through the
 * template ("flow") API with the whole text as its variable; without one through the free-text API. Reference never verified this
 * against a live account: the response shapes are from MSG91's published docs, and the raw answer of a refusal is kept in the
 * error only after it is scrubbed of the key.
 */
export class Msg91SmsClient {
  constructor(
    private readonly env: ChannelSmsEnv,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async verify(c: SmsCredentials): Promise<SmsVerifyResult> {
    const key = c.authToken.trim();
    if (!key) return { ok: false, error: 'An MSG91 auth key is required.' };
    try {
      // The balance is the cheapest authenticated read MSG91 has.
      const res = await this.fetchFn(`${this.env.SMS_MSG91_API_BASE}/api/balance.php?type=4`, {
        headers: { authkey: key, accept: 'application/json' },
        signal: AbortSignal.timeout(this.env.SMS_VERIFY_TIMEOUT_MS),
      });
      if (!res.ok)
        return { ok: false, error: `MSG91 rejected that auth key (HTTP ${res.status}).` };
      // A wrong key comes back as HTTP 200 with an error body, so the body is read too. Brittle, and kept on purpose:
      // tighten it here once a live account shows the real shape.
      const text = (await res.text().catch(() => '')).trim().toLowerCase();
      if (text.includes('error') || text.includes('invalid'))
        return { ok: false, error: 'MSG91 rejected that auth key.' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Could not reach MSG91: ${scrub(errorText(err), [key])}` };
    }
  }

  async send(c: SmsCredentials, to: string, body: string): Promise<SmsSendResult> {
    const problem = credentialsProblem(c);
    if (problem) return { ok: false, error: problem };
    const mobile = msg91Recipient(to);
    if (!mobile) return { ok: false, error: BAD_RECIPIENT };
    const text = body.trim();
    if (!text) return { ok: false, error: EMPTY_BODY };

    const key = c.authToken.trim();
    const template = c.dltTemplateId.trim();
    const senderId = c.senderId.trim();
    if (template) {
      return this.post('/api/v5/flow/', key, text, {
        template_id: template,
        short_url: '0',
        // MSG91 fills a template variable by the name it was registered with and ignores keys it does not declare, so the whole
        // text goes under both common names; the registered template is a single variable carrying the message.
        recipients: [{ mobiles: mobile, VAR1: text, body: text }],
        ...(senderId ? { sender: senderId } : {}),
      });
    }
    return this.post('/api/v2/sendsms', key, text, {
      sender: senderId || 'MSGIND',
      // Route 4 is transactional; promotional route 1 is refused for Indian numbers without DLT.
      route: '4',
      country: '0',
      sms: [{ message: text, to: [mobile] }],
    });
  }

  /** MSG91 answers HTTP 200 with `{"type":"error"}` for a real refusal, so the status alone is not the outcome. */
  private async post(
    path: string,
    key: string,
    text: string,
    payload: unknown,
  ): Promise<SmsSendResult> {
    try {
      const res = await this.fetchFn(`${this.env.SMS_MSG91_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          authkey: key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.env.SMS_SEND_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const type = String(json.type ?? '').toLowerCase();
      if (res.ok && type !== 'error') {
        return {
          ok: true,
          messageId: String(json.request_id ?? json.message ?? ''),
          // MSG91 does not report a count.
          segments: measureSms(text).segments,
        };
      }
      const message = scrub(String(json.message ?? json.msg ?? `HTTP ${res.status}`), [key]);
      const lower = message.toLowerCase();
      return {
        ok: false,
        code: String(json.code ?? res.status),
        badCredentials:
          res.status === 401 || lower.includes('authkey') || lower.includes('authentication'),
        error: explainMsg91(message),
      };
    } catch (err) {
      return { ok: false, error: `Could not reach MSG91: ${scrub(errorText(err), [key])}` };
    }
  }
}
