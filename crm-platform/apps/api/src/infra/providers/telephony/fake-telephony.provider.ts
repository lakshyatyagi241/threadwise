import { Injectable } from '@nestjs/common';
import { GenericTelephonyProvider } from './generic-telephony.provider';
import type { ClickToCallRequest, ClickToCallResult } from './telephony.port';

/**
 * The fake provider (key `fake`): the generic callback contract plus a click-to-call that rings nobody. It is what development and the
 * tests use to exercise the whole path (place, callback, log) without a vendor account, and the shape a real adapter's `clickToCall`
 * must answer. It is only offered outside production (see `TelephonyRegistry`), because a "call" that rings nobody must never be a
 * choice a real workspace can make.
 *
 * `placed` keeps what was asked, for a test to read; `refuse` makes the next placements fail the way a vendor refusal does.
 */
@Injectable()
export class FakeTelephonyProvider extends GenericTelephonyProvider {
  override readonly key = 'fake';
  override readonly label = 'Fake provider (development and tests)';
  override readonly supportsClickToCall = true;

  readonly placed: ClickToCallRequest[] = [];
  refuse: string | null = null;
  private seq = 0;

  override clickToCall(req: ClickToCallRequest): Promise<ClickToCallResult> {
    if (this.refuse) return Promise.resolve({ ok: false, error: this.refuse, code: 'refused' });
    this.placed.push(req);
    this.seq += 1;
    return Promise.resolve({ ok: true, callId: `fake-call-${Date.now()}-${this.seq}` });
  }
}
