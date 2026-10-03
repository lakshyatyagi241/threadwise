import { Injectable } from '@nestjs/common';
import type { InboundHooks, TelegramPlanGate } from './tokens';

/**
 * The Telegram flags are not in the plan catalogue yet (only the numeric caps are), so every check passes.
 * This matches Reference for the bot cap, which it never enforced.
 */
@Injectable()
export class OpenTelegramPlanGate implements TelegramPlanGate {
  assertChannel(): Promise<void> {
    return Promise.resolve();
  }

  assertBroadcasts(): Promise<void> {
    return Promise.resolve();
  }

  assertBotCap(): Promise<void> {
    return Promise.resolve();
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

  resumePaid(): Promise<void> {
    return Promise.resolve();
  }
}
