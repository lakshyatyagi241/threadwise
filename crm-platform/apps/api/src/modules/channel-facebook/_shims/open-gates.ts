import { Injectable } from '@nestjs/common';
import type { FacebookPlanGate, InboundHooks } from './tokens';

/**
 * The Facebook flags are not in the plan catalogue yet, so every check passes and the AI agent is allowed. This matches WaDesk for
 * the Page cap, which it never enforced.
 */
@Injectable()
export class OpenFacebookPlanGate implements FacebookPlanGate {
  assertChannel(): Promise<void> {
    return Promise.resolve();
  }

  assertPosts(): Promise<void> {
    return Promise.resolve();
  }

  assertPageCap(): Promise<void> {
    return Promise.resolve();
  }

  aiAgentAllowed(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** No flow runtime, routing or auto-reply yet: nothing consumes a message and nothing replies. */
@Injectable()
export class NoInboundHooks implements InboundHooks {
  handoffToFlow(): Promise<boolean> {
    return Promise.resolve(false);
  }

  automate(): Promise<void> {
    return Promise.resolve();
  }
}
