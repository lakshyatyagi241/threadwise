import type { HandoffReason, RequestHandoffInput } from '@crm/contracts';

/** How long a conversation has waited in the queue, as the one unit the badge shows: minutes, then hours, then days. */
export function waitAge(sinceIso: string, nowMs: number): { count: number; unit: 'm' | 'h' | 'd' } {
  const since = Date.parse(sinceIso);
  const minutes = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 60_000)) : 0;
  if (minutes < 60) return { count: minutes, unit: 'm' };
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? { count: hours, unit: 'h' } : { count: Math.floor(hours / 24), unit: 'd' };
}

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
