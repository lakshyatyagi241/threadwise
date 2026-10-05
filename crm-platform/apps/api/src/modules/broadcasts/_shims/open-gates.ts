import { Injectable } from '@nestjs/common';
import type { BroadcastPlanGate, WarmerGate } from './tokens';

/**
 * The warmer gate every bulk sender asks. It passes everything until the scheduled-queue-warmer domain registers the real warmer
 * (`use`, at its module's start): that domain depends on this one for the senders and pacing, so this one cannot depend on it.
 */
@Injectable()
export class OpenWarmerGate implements WarmerGate {
  private delegate: WarmerGate | null = null;

  /** Called once by the warmer domain; from then on every call is the warmer's. */
  use(gate: WarmerGate): void {
    this.delegate = gate;
  }

  hold(...args: Parameters<WarmerGate['hold']>): Promise<string[]> {
    return this.delegate ? this.delegate.hold(...args) : Promise.resolve([]);
  }

  gap(...args: Parameters<WarmerGate['gap']>): Promise<{ min: number; max: number } | null> {
    return this.delegate ? this.delegate.gap(...args) : Promise.resolve(null);
  }
}

/** The `broadcast` plan flag is not in the plan catalogue yet, so the flag check passes; the numeric cap is enforced. */
@Injectable()
export class OpenBroadcastPlanGate implements BroadcastPlanGate {
  assertEnabled(): Promise<void> {
    return Promise.resolve();
  }
}
