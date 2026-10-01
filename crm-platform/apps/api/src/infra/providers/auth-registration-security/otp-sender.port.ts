/**
 * Delivers the sign-up one-time code over WhatsApp (WD-AUTH-006).
 *
 * `OTP_SENDER_PORT` is bound to ConfiguredOtpSender, which reads the platform's
 * registration settings at send time and hands the code to the adapter for the
 * chosen sender kind: Meta's WhatsApp Cloud API (waba), the Twilio Messages API
 * (twilio), the Node bridge for an unofficial session (device) or the API log
 * (dev, never in production). The channel domains (WABA / WADEV) can replace the
 * registry behind it later; callers only know this port.
 */
export interface OtpSendInput {
  /** E.164 destination. */
  to: string;
  code: string;
  ttlMinutes: number;
}

export interface OtpSenderPort {
  /** Throws OtpSendError on failure; the caller maps it to AUTH_OTP_SEND_FAILED. */
  send(input: OtpSendInput): Promise<void>;
}

export const OTP_SENDER_PORT = Symbol('OTP_SENDER_PORT');

/** Why a send failed, in terms an operator can act on. Never includes secrets. */
export type OtpFailureReason =
  | 'not_configured'
  | 'template_not_approved'
  | 'invalid_number'
  | 'auth_failed'
  | 'rejected'
  | 'provider_error'
  | 'connection_refused'
  | 'timeout'
  | 'transport_error';

/**
 * Typed failure of an OTP delivery or a Meta template call. `message` is safe
 * to show an operator: provider text is truncated and the stored secret is
 * scrubbed from it before it gets here.
 */
export class OtpSendError extends Error {
  constructor(
    readonly reason: OtpFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'OtpSendError';
  }
}

/** A sender with everything needed to deliver, secrets decrypted. Server-side only. */
export type ResolvedOtpSender =
  | {
      kind: 'waba';
      id: string;
      phoneNumberId: string;
      wabaId: string;
      graphBaseUrl: string;
      accessToken: string;
    }
  | {
      kind: 'twilio';
      id: string;
      accountSid: string;
      fromNumber: string;
      apiBaseUrl: string;
      authToken: string;
    }
  | {
      kind: 'device';
      id: string;
      bridgeUrl: string;
      senderNumber: string;
      token: string;
    }
  | { kind: 'dev'; id: string };

export type WabaOtpConfig = Extract<ResolvedOtpSender, { kind: 'waba' }>;
export type TwilioOtpConfig = Extract<ResolvedOtpSender, { kind: 'twilio' }>;
export type BridgeOtpConfig = Extract<ResolvedOtpSender, { kind: 'device' }>;
