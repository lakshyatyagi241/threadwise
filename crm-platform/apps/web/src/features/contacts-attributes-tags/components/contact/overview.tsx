'use client';

import type { AddTarget, FocusRequest, SectionId } from '../../lib/sections';
import { AssociationCards } from './association-cards';
import { KeyDetails } from './key-details';
import { type SectionProps } from './shared';
import { SummaryStrip } from './summary-strip';
import { ActivityWorkspace } from './timeline/activity-workspace';

/**
 * The overview of a contact. On the page it is the middle column's first tab: a short summary strip (open tasks, next meeting, last
 * activity, deals), the compose box and the timeline right under it, which stretches to the bottom so the page is never half empty;
 * the profile card and the association cards are the page's side columns. In the quick view's drawer, which has no side columns, it is
 * the summary, "About this contact" and the association cards in one column.
 */
export function ContactOverview({
  contact,
  variant,
  focus,
  onAdd,
  onOpenSection,
  companyFocusSignal,
  scoreFocusSignal,
}: SectionProps & {
  focus?: FocusRequest | null;
  onAdd?: (target: AddTarget) => void;
  /** Changes whenever something outside (the action menu's "Add company") wants the cursor in the company search. */
  companyFocusSignal?: number;
  /** Changes whenever something outside (the lead score chip in the header) wants the Lead score card open and in view. */
  scoreFocusSignal?: number;
  /** Moves to a section in place (the details page and the drawer's tabs). */
  onOpenSection?: (section: SectionId) => void;
}) {
  if (variant === 'drawer') {
    return (
      <div className="space-y-3">
        <SummaryStrip contact={contact} onOpenSection={onOpenSection} />
        <KeyDetails
          contact={contact}
          onEditCompany={onAdd ? () => onAdd('company') : undefined}
          onOpenSection={onOpenSection}
        />
        <AssociationCards
          contact={contact}
          onOpenSection={onOpenSection}
          onAdd={onAdd}
          companyFocusSignal={companyFocusSignal}
          scoreFocusSignal={scoreFocusSignal}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SummaryStrip contact={contact} onOpenSection={onOpenSection} />
      <ActivityWorkspace contact={contact} focus={focus} bare />
    </div>
  );
}
