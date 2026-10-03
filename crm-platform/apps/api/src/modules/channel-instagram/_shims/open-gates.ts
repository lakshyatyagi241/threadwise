import { Injectable } from '@nestjs/common';
import type { InstagramAutomation, InstagramPlanGate } from './tokens';

/** `access_instagram` is not in the plan catalogue yet, so every check passes. */
@Injectable()
export class OpenInstagramPlanGate implements InstagramPlanGate {
  assertChannel(): Promise<void> {
    return Promise.resolve();
  }

  assertBroadcast(): Promise<void> {
    return Promise.resolve();
  }
}

/** No auto-reply domain yet: nothing replies to an Instagram message. */
@Injectable()
export class NoInstagramAutomation implements InstagramAutomation {
  automate(): Promise<void> {
    return Promise.resolve();
  }
}
