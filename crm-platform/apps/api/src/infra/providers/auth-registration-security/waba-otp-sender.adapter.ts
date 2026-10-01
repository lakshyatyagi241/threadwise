import {
  OtpSendError,
  type OtpSendInput,
  type OtpSenderPort,
  type WabaOtpConfig,
} from './otp-sender.port';
import { buildWabaSendBody, digitsOf } from './otp-payloads';
import { callProvider, httpFailure, joinUrl, metaErrorText, type CallOptions } from './otp-http';

type Transport = Pick<CallOptions, 'timeoutMs' | 'fetchImpl'>;

/**
 * WhatsApp Cloud API (Meta). Sends the APPROVED authentication template with
 * the code as its variable; free text would be refused outside a 24-hour
 * conversation window, which a brand-new sign-up never has.
 */
export class WabaOtpSender implements OtpSenderPort {
  constructor(
    private readonly sender: WabaOtpConfig,
    private readonly template: { name: string; language: string },
    private readonly transport: Transport = {},
  ) {}

  async send(input: OtpSendInput): Promise<void> {
    if (digitsOf(input.to).length < 7)
      throw new OtpSendError('invalid_number', 'Invalid phone number.');
    const opts = {
      provider: 'Meta',
      secrets: [this.sender.accessToken, input.code],
      ...this.transport,
    };
    const res = await callProvider(
      joinUrl(this.sender.graphBaseUrl, this.sender.phoneNumberId, 'messages'),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.sender.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          buildWabaSendBody({
            to: input.to,
            templateName: this.template.name,
            language: this.template.language,
            code: input.code,
          }),
        ),
      },
      opts,
    );
    if (!res.ok) throw httpFailure(res, metaErrorText(res.json), opts);
  }
}
