import { Injectable } from '@nestjs/common';
import type { InstagramPlanGate } from './tokens';

/** `access_instagram` is not in the plan catalogue yet, so every check passes. */
@Injectable()
export class OpenInstagramPlanGate implements InstagramPlanGate {
  assertChannel(): Promise<void> {
    return Promise.resolve();
  }
}
