import { CONVERSATION_EVENT_TYPES, type ConversationEvent } from '@crm/contracts';

/**
 * The timeline line of an event. A type this build does not know (routing, SLA and automation write their own, and the API can
 * grow one before the web does) is still shown, with its underscores turned into spaces (as Reference does).
 */
const KNOWN: ReadonlySet<string> = new Set(CONVERSATION_EVENT_TYPES);

export type EventLabel = { known: true; key: string } | { known: false; text: string };

export function eventLabel(event: Pick<ConversationEvent, 'type'>): EventLabel {
  return KNOWN.has(event.type)
    ? { known: true, key: event.type }
    : { known: false, text: event.type.replaceAll('_', ' ') };
}
