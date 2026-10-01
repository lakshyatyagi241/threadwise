import {
  OtpSendError,
  type BridgeOtpConfig,
  type OtpSendInput,
  type OtpSenderPort,
} from './otp-sender.port';
import { buildBridgeBody, digitsOf, renderOtpText } from './otp-payloads';
import { bridgeErrorText, callProvider, httpFailure, joinUrl, type CallOptions } from './otp-http';

type Transport = Pick<CallOptions, 'timeoutMs' | 'fetchImpl'>;

/**
 * The Node bridge that holds an unofficial (QR-paired) WhatsApp session:
 * `POST {bridge}/api/send-message/{senderNumber}` with `X-Node-Token`.
 */
export class BridgeOtpSender implements OtpSenderPort {
  constructor(
    private readonly sender: BridgeOtpConfig,
    private readonly message: { templateBody: string | null; appName: string },
    private readonly transport: Transport = {},
  ) {}

  async send(input: OtpSendInput): Promise<void> {
    if (digitsOf(input.to).length < 7)
      throw new OtpSendError('invalid_number', 'Invalid phone number.');
    const opts = {
      provider: 'The WhatsApp bridge',
      secrets: [this.sender.token, input.code],
      ...this.transport,
    };
    const res = await callProvider(
      joinUrl(this.sender.bridgeUrl, 'api', 'send-message', this.sender.senderNumber),
      {
        method: 'POST',
        headers: { 'X-Node-Token': this.sender.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildBridgeBody({
            to: input.to,
            message: renderOtpText({
              templateBody: this.message.templateBody,
              code: input.code,
              ttlMinutes: input.ttlMinutes,
              appName: this.message.appName,
            }),
          }),
        ),
      },
      opts,
    );
    if (!res.ok) throw httpFailure(res, bridgeErrorText(res.json), opts);
    if ((res.json as { success?: unknown } | undefined)?.success === false) {
      throw new OtpSendError(
        'rejected',
        `The WhatsApp bridge could not send. ${bridgeErrorText(res.json) ?? ''}`.trim(),
      );
    }
  }
}
