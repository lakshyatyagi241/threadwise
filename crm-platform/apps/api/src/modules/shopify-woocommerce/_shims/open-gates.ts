import { Injectable } from '@nestjs/common';
import type { EcomPlanGate } from './tokens';

/** The integration flags are not in the plan catalogue yet, so every check passes. */
@Injectable()
export class OpenEcomPlanGate implements EcomPlanGate {
  assertIntegration(): Promise<void> {
    return Promise.resolve();
  }
}
