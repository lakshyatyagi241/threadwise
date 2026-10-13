/**
 * Public surface of the calling-voice domain (CALL). The team inbox mounts these; nothing else reaches into the folders below.
 *
 * Mount `CallingProvider` once, above the conversation header and the rest of the inbox, inside a `ToastProvider`, then
 * `IncomingCallToast` and `OnCallPanel` anywhere below it, and `CallButton` in the conversation header:
 *
 *   <CallingProvider>
 *     <IncomingCallToast />
 *     <OnCallPanel />
 *     ... <CallButton conversationId={c.id} displayName={c.title} contactId={c.contactId} />
 *   </CallingProvider>
 *
 * The WhatsApp health page draws `CallingToggleCard` for its number (`numberId` is the number's uuid), inside a `ToastProvider`.
 */
export { CallingProvider, useCalling } from './components/calling-provider';
export type { ActiveCall, CallingApi, OutboundCallInput } from './components/calling-provider';
export { CallButton, type CallButtonProps } from './components/call-button';
export { CallingToggleCard } from './components/calling-settings-screen';
export { IncomingCallToast } from './components/incoming-call-toast';
export { OnCallPanel } from './components/on-call-panel';
export { useCallEligibility } from './api/calling';
