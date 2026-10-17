'use client';

import { useTranslations } from 'next-intl';
import { useCanPickCompany } from '@/features/companies';
import { ContactGrowthCard } from '@/features/growth';
import { ChatInsightCard } from '@/features/lead-scoring';
import type { SectionId } from '../../lib/sections';
import { CompanyCard } from './company-inline';
import { ComplianceCard, LeadScoreCard, LocationCard, OwnerCard, SubscriptionCard } from './cards';
import { FieldHistoryButton } from './field-history';
import { ContactInfoTabs } from './info-tabs';
import { Panel, useRefreshContact, type SectionProps } from './shared';

/**
 * The overview of a contact, the same in the quick view and on the details page: the company (searched and set in place) and the
 * information tabs on the left (with the Field History button above them) and the cards on the right: lead score, subscription status, owner and assignment, location,
 * compliance, and the chat-insight and growth cards in the workspaces that have them. The two columns appear once the container is
 * wide enough, so the narrow drawer and a phone get one column in the same order.
 */
export function ContactOverview({
  contact,
  variant,
  onOpenSection,
  companyFocusSignal,
}: SectionProps & {
  /** Changes whenever something outside (the action bar's "Add company") wants the cursor in the company search. */
  companyFocusSignal?: number;
  /** Moves to a section in place (the details page); the quick view sends the person to the details page instead. */
  onOpenSection?: (section: SectionId) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.overview');
  const refresh = useRefreshContact(contact.id);
  const canPickCompany = useCanPickCompany();
  return (
    <div className="@container">
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          {/* The details page has the button in its header; the drawer has no header room for it. */}
          {variant === 'drawer' && (
            <div className="flex justify-end">
              <FieldHistoryButton contactId={contact.id} />
            </div>
          )}
          {canPickCompany && <CompanyCard contact={contact} focusSignal={companyFocusSignal} />}
          <Panel id={`info-${contact.id}`} title={t('information')} bodyClassName="pt-1">
            <ContactInfoTabs contact={contact} />
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <LeadScoreCard contact={contact} />
          <SubscriptionCard
            contact={contact}
            onOpenConsent={onOpenSection ? () => onOpenSection('consent') : undefined}
          />
          <OwnerCard contact={contact} />
          <LocationCard contact={contact} />
          <ComplianceCard contact={contact} />
          {/* Only present in a workspace that has the chat reading on; every other workspace sees nothing here. */}
          <ChatInsightCard contactId={contact.id} onChanged={refresh} />
          {/* Only present in a workspace that is in the growth pilot with the conversion model or enrichment on. */}
          <ContactGrowthCard contactId={contact.id} />
        </div>
      </div>
    </div>
  );
}
