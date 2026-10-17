'use client';

import type { SectionId } from '../../lib/sections';
import { ContactSideCards } from './side-cards';
import { type SectionProps } from './shared';
import { ActivityFeed } from './timeline/activity-feed';

/**
 * The overview of a contact, the same in the quick view and on the details page: the side column (Key details, the subscription
 * status, and the folded cards: tags and groups, company, time zone and location, privacy, lead score) and "Recent activity", the
 * latest few entries of the timeline with a link to all of it. The two columns appear once the container is wide enough, so the
 * narrow drawer and a phone get one column in the same order: who they are first, then what happened.
 */
export function ContactOverview({
  contact,
  onOpenSection,
  companyFocusSignal,
}: SectionProps & {
  /** Changes whenever something outside (the action bar's "Add company") wants the cursor in the company search. */
  companyFocusSignal?: number;
  /** Moves to a section in place (the details page and the drawer's tabs). */
  onOpenSection?: (section: SectionId) => void;
}) {
  return (
    <div className="@container">
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] @3xl:items-start">
        <ContactSideCards
          contact={contact}
          onOpenSection={onOpenSection}
          companyFocusSignal={companyFocusSignal}
        />
        <ActivityFeed
          contact={contact}
          preview
          onViewAll={onOpenSection ? () => onOpenSection('activities') : undefined}
        />
      </div>
    </div>
  );
}
