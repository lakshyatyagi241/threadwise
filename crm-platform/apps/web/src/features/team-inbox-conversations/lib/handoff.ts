import type {
  HandoffReason,
  MessageSystemEvent,
  RequestHandoffInput,
  ReturnToBotResponse,
} from '@crm/contracts';

/** How long a conversation has waited in the queue, as the one unit the badge shows: minutes, then hours, then days. */
export function waitAge(sinceIso: string, nowMs: number): { count: number; unit: 'm' | 'h' | 'd' } {
  const since = Date.parse(sinceIso);
  const minutes = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 60_000)) : 0;
  if (minutes < 60) return { count: minutes, unit: 'm' };
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? { count: hours, unit: 'h' } : { count: Math.floor(hours / 24), unit: 'd' };
}

/** The message of the handoff namespace that writes each unit of a wait ("12m"), so a language can use its own short form. */
export const AGE_KEY = { m: 'ageMinutes', h: 'ageHours', d: 'ageDays' } as const;

export type QueueDestinationKind = 'rules' | 'team' | 'person';

export interface SendDraft {
  kind: QueueDestinationKind;
  teamId: string;
  userId: string;
  reason: HandoffReason;
  note: string;
}

export const EMPTY_SEND: SendDraft = {
  kind: 'rules',
  teamId: '',
  userId: '',
  reason: 'other',
  note: '',
};

/** Whether the draft names what its destination needs (a team for "a team", a person for "a person"). */
export function sendReady(d: SendDraft): boolean {
  return d.kind === 'rules' || (d.kind === 'team' ? d.teamId !== '' : d.userId !== '');
}

/** The request the draft stands for; the free text is trimmed and left out when empty. */
export function toSendInput(d: SendDraft): RequestHandoffInput {
  const note = d.note.trim();
  return {
    reason: d.reason,
    ...(note ? { reasonText: note } : {}),
    destination:
      d.kind === 'team'
        ? { kind: 'team', teamId: d.teamId }
        : d.kind === 'person'
          ? { kind: 'person', userId: d.userId }
          : { kind: 'rules' },
  };
}

// --- Return to bot -----------------------------------------------------------------------------------------------------------

/** The toast after Return to bot: it always says what the bot will do, never a bare "done". */
export function giveBackToastKey(
  r: Pick<ReturnToBotResponse, 'resumed' | 'nextMessageBy' | 'alreadyWithBot'>,
): 'already' | 'doneFlow' | 'doneNextLive' | 'doneNextDefault' {
  if (r.alreadyWithBot) return 'already';
  if (r.resumed === 'flow') return 'doneFlow';
  return r.nextMessageBy === 'live_flow' ? 'doneNextLive' : 'doneNextDefault';
}

/** Spelled out (not built from the event) so each message is visibly used and a renamed outcome fails the type check. */
const RESULT_KEY: Record<NonNullable<BotReturnedEvent['result']>, string> = {
  continued: 'result.continued',
  claimed_again: 'result.claimed_again',
  flow_not_live: 'result.flow_not_live',
  start_failed: 'result.start_failed',
};
const CUSTOMER_KEY: Record<NonNullable<BotReturnedEvent['customer']>, string> = {
  sent: 'customer.sent',
  window_closed: 'customer.window_closed',
  no_consent: 'customer.no_consent',
  failed: 'customer.failed',
  channel_unavailable: 'customer.channel_unavailable',
};

export type BotReturnedEvent = Extract<MessageSystemEvent, { event: 'bot_returned' }>;

/**
 * The messages (keys under `handoff.botLine`) that make up one "bot is back" line of the thread, in reading order. The first line a
 * person sees right after pressing Return to bot is `pressed`; the worker adds a `result` line once the flow was (or was not) continued,
 * and what became of the optional message to the customer.
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
