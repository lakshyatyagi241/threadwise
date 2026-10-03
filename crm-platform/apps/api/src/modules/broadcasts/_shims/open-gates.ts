import { Injectable } from '@nestjs/common';
import type { BroadcastPlanGate, WarmerGate } from './tokens';

/** No warmer until the scheduled-queue-warmer domain exposes one: nothing is ever held. */
@Injectable()
export class OpenWarmerGate implements WarmerGate {
  hold(): Promise<string[]> {
    return Promise.resolve([]);
  }

  gap(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** The `broadcast` plan flag is not in the plan catalogue yet, so the flag check passes; the numeric cap is enforced. */
@Injectable()
export class OpenBroadcastPlanGate implements BroadcastPlanGate {
  assertEnabled(): Promise<void> {
    return Promise.resolve();
  }
}
