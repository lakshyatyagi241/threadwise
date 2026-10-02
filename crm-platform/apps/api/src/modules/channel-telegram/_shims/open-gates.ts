import { Injectable } from '@nestjs/common';
import type { TelegramPlanGate } from './tokens';

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
