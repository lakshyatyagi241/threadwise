import type { WspHandoverInput, WspHandoverPreview } from '@crm/contracts';

export type HandoverChoice = 'person' | 'team_lead' | 'leave';

/** What the person holds in all: nothing to ask when it is zero. */
export const heldTotal = (p: Pick<WspHandoverPreview, 'contacts' | 'openDeals' | 'openConversations'>) =>
  p.contacts + p.openDeals + p.openConversations;

/**
 * The call the dialog makes for the chosen option, or null when there is nothing to send (leave them, or nothing is held, or the
 * person to take over was not picked yet).
 */
export function handoverInput(
  choice: HandoverChoice,
  userId: string,
  preview: WspHandoverPreview | undefined,
): WspHandoverInput | null {
  if (!preview || heldTotal(preview) === 0 || choice === 'leave') return null;
  if (choice === 'team_lead') return preview.teamLeads.length > 0 ? { mode: 'team_lead' } : null;
  return userId ? { mode: 'person', userId } : null;
}

/** Whether the Deactivate button may be pressed: choosing "a person" needs a person; "their team manager" needs one to exist. */
export function canConfirm(
  choice: HandoverChoice,
  userId: string,
  preview: WspHandoverPreview | undefined,
): boolean {
  if (!preview || heldTotal(preview) === 0 || choice === 'leave') return true;
  if (choice === 'team_lead') return preview.teamLeads.length > 0;
  return userId !== '';
}
