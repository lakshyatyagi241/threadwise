/**
 * Stand-ins for what other domains own. Each is an interface here and a default in `open-gates.ts`; when the owner exports the
 * real service, bind it to the same token in `channel-telegram.module.ts` and delete the default.
 */

/** The plan flags `access_telegram`, `telegram_broadcasts` and the `telegram_bots` cap (plans-subscriptions-trials). */
export interface TelegramPlanGate {
  /** Throws a PLAN_FEATURE_LOCKED problem when the plan does not include the Telegram channel. */
  assertChannel(orgId: number): Promise<void>;
  /** Throws when the plan does not include Telegram broadcasts. */
  assertBroadcasts(orgId: number): Promise<void>;
  /** Throws when the plan's bot cap is reached (Reference stores `telegram_bots_limit` and never enforces it). */
  assertBotCap(orgId: number, connected: number): Promise<void>;
}
export const TELEGRAM_PLAN_GATE = Symbol('TELEGRAM_PLAN_GATE');
