import type { MessageSystemEvent, ReturnToBotResponse } from '@crm/contracts';

/** The "Bot is back" system line the server writes into the thread when a person gives the conversation back to the bot. */
export type BotReturnedEvent = Extract<MessageSystemEvent, { event: 'bot_returned' }>;

/**
 * Which sentence says what Return to bot did (the same rule as the web inbox): the bot already had the chat, the flow that handed it
 * over continues now, or nothing is sent now and the bot answers the customer's next message (a flow already waiting, or the workspace's
 * default flow, which answers only if one is set).
 */
export type GiveBackKey = 'already' | 'doneFlow' | 'doneNextLive' | 'doneNextDefault';

export function giveBackKey(
  r: Pick<ReturnToBotResponse, 'resumed' | 'nextMessageBy' | 'alreadyWithBot'>,
): GiveBackKey {
  if (r.alreadyWithBot) return 'already';
  if (r.resumed === 'flow') return 'doneFlow';
  return r.nextMessageBy === 'live_flow' ? 'doneNextLive' : 'doneNextDefault';
}

/** Spelled out (not built from the event) so each sentence is visibly used and a renamed outcome fails the type check. */
const RESULT_KEY: Record<NonNullable<BotReturnedEvent['result']>, string> = {
  continued: 'result.continued',
  claimed_again: 'result.claimed_again',
  flow_not_live: 'result.flow_not_live',
  start_failed: 'result.start_failed',
};
const CUSTOMER_KEY: Record<NonNullable<NonNullable<BotReturnedEvent['customer']>>, string> = {
  sent: 'customer.sent',
  window_closed: 'customer.window_closed',
  no_consent: 'customer.no_consent',
  failed: 'customer.failed',
  channel_unavailable: 'customer.channel_unavailable',
};

/**
 * The sentences of a "Bot is back" line, as keys under `inbox.handoff.botLine`. The first stage (written the moment the button is
 * pressed) says who gave it back and whether the flow continues or the bot waits for the next message; the second, a moment later, says
 * what happened to the flow and to the optional message to the customer.
 */
export function botLineKeys(e: BotReturnedEvent): string[] {
  if (e.stage === 'pressed') {
    return [
      e.resumed === 'flow'
        ? 'pressed.flow'
        : e.nextMessageBy === 'live_flow'
          ? 'pressed.nextLive'
          : 'pressed.nextDefault',
    ];
  }
  const keys: string[] = [];
  if (e.result) keys.push(RESULT_KEY[e.result]);
  if (e.customer) keys.push(CUSTOMER_KEY[e.customer]);
  return keys;
}
