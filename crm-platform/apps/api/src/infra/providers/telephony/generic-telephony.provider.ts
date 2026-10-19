import { Injectable } from '@nestjs/common';
import {
  TELEPHONY_SIGNATURE_HEADER,
  TELEPHONY_TIMESTAMP_HEADER,
  telephonyCallEventSchema,
} from '@crm/contracts';
import type {
  ClickToCallRequest,
  ClickToCallResult,
  NormalisedCallEvent,
  TelephonyProvider,
} from './telephony.port';
import { verifyTelephonyCallback } from './telephony-signature';

/**
 * The generic signed callback (provider key `generic`): any system that can POST JSON and compute an HMAC - a vendor's webhook behind a
 * small relay, an automation tool, an in-house IVR - reports finished calls in the contract of `telephonyCallEventSchema`. It is also the
 * reference every vendor adapter is written against: a vendor adapter differs only in how it verifies and parses ITS callback.
 *
 * It cannot bridge a call (there is no vendor to ask), so `clickToCall` refuses.
 */
@Injectable()
export class GenericTelephonyProvider implements TelephonyProvider {
  readonly key: string = 'generic';
  readonly label: string = 'Signed webhook (generic)';
  readonly supportsClickToCall: boolean = false;

  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
    now?: Date,
  ): boolean {
    return verifyTelephonyCallback(
      secret,
      headers[TELEPHONY_TIMESTAMP_HEADER],
      headers[TELEPHONY_SIGNATURE_HEADER],
      rawBody,
      now,
    );
  }

  parseWebhook(rawBody: Buffer): NormalisedCallEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return [];
    }
    const parsed = telephonyCallEventSchema.safeParse(json);
    if (!parsed.success) return [];
    const { id, call } = parsed.data;
    return [
      {
        eventId: id,
        callId: call.id,
        direction: call.direction,
        status: call.status,
        customerNumber: (call.direction === 'inbound' ? call.from : call.to) ?? null,
        ourNumber: (call.direction === 'inbound' ? call.to : call.from) ?? null,
        startedAt: new Date(call.startedAt),
        durationSec: call.durationSec,
        recordingRef: call.recordingRef ?? null,
      },
    ];
  }

  clickToCall(_req: ClickToCallRequest): Promise<ClickToCallResult> {
    return Promise.resolve({
      ok: false,
      error: 'This connection only reports calls; it cannot place one.',
      code: 'unsupported',
    });
  }
}
