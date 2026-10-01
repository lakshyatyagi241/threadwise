import {
  OtpSendError,
  type OtpSendInput,
  type OtpSenderPort,
  type TwilioOtpConfig,
} from './otp-sender.port';
import { buildTwilioForm, digitsOf, renderOtpText } from './otp-payloads';
import { callProvider, httpFailure, joinUrl, twilioErrorText, type CallOptions } from './otp-http';

type Transport = Pick<CallOptions, 'timeoutMs' | 'fetchImpl'>;

/** Twilio's Messages API over WhatsApp: From `whatsapp:+<from>`, To `whatsapp:+<digits>`, Basic auth. */
export class TwilioOtpSender implements OtpSenderPort {
  constructor(
    private readonly sender: TwilioOtpConfig,
    private readonly message: { templateBody: string | null; appName: string },
    private readonly transport: Transport = {},
  ) {}

  async send(input: OtpSendInput): Promise<void> {
    if (digitsOf(input.to).length < 7)
      throw new OtpSendError('invalid_number', 'Invalid phone number.');
    const { accountSid, authToken } = this.sender;
    const opts = { provider: 'Twilio', secrets: [authToken, input.code], ...this.transport };
    const res = await callProvider(
      joinUrl(this.sender.apiBaseUrl, '2010-04-01', 'Accounts', accountSid, 'Messages.json'),
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: buildTwilioForm({
          from: this.sender.fromNumber,
          to: input.to,
          body: renderOtpText({
            templateBody: this.message.templateBody,
            code: input.code,
            ttlMinutes: input.ttlMinutes,
            appName: this.message.appName,
          }),
        }).toString(),
      },
      opts,
    );
    if (!res.ok) throw httpFailure(res, twilioErrorText(res.json), opts);
  }
}
