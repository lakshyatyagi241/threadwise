import { Injectable } from '@nestjs/common';
import type { BroadcastPlanGate, WalletGate, WarmerGate } from './tokens';

/** No wallet precheck until the wallet domain exposes one: every send is allowed (WaDesk: a no-op for plan-quota orgs). */
@Injectable()
export class OpenWalletGate implements WalletGate {
  precheck(): Promise<void> {
    return Promise.resolve();
  }
}

/** No warmer until the scheduled-queue-warmer domain exposes one: nothing is ever held. */
@Injectable()
export class OpenWarmerGate implements WarmerGate {
  hold(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/** The `broadcast` plan flag is not in the plan catalogue yet, so the flag check passes; the numeric cap is enforced. */
@Injectable()
export class OpenBroadcastPlanGate implements BroadcastPlanGate {
  assertEnabled(): Promise<void> {
    return Promise.resolve();
  }
}
