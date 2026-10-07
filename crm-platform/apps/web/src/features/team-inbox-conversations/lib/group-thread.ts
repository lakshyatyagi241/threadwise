/**
 * A WhatsApp group thread is keyed `g:<group id>` (the inbound ingest). Sending to a group is not built yet (phase 3 of
 * docs/specs/waba-groups-management.md): the API refuses with `WABA_GROUP_SEND_UNAVAILABLE`, and the composer is switched off here
 * so nobody types a reply that cannot go. Reading, notes and everything else on the thread work as before.
 */
export const isGroupThread = (peerKey: string | null | undefined): boolean =>
  (peerKey ?? '').trimStart().startsWith('g:');
