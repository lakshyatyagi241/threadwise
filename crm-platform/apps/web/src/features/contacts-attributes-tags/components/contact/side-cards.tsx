'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CompanyLink, useCanPickCompany } from '@/features/companies';
import { ContactGrowthCard } from '@/features/growth';
import { ChatInsightCard, bandOf } from '@/features/lead-scoring';
import { useContactFields } from '../../api/properties';
import { useContactTags } from '../../api/tags';
import type { ContactRow } from '../../api/schemas';
import { countryOfPhone, timeZoneOf } from '../../lib/contact-overview';
import { subscriptionRows } from '../../lib/subscription';
import type { SectionId } from '../../lib/sections';
import { TimezoneCard } from '../timezone-card';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  ComplianceBody,
  LeadScoreBody,
  LocationBody,
  SubscriptionBody,
  TagsGroupsBody,
  useComplianceVisible,
} from './cards';
import { CollapseCard } from './collapse-card';
import { CompanyInline } from './company-inline';
import { KeyDetails } from './key-details';
import { useRefreshContact } from './shared';

/**
 * The side column of the overview, the same in the quick view and on the details page: Key details and the subscription status open,
 * everything else folded into one line each (tags and groups, company, time zone and location, privacy flags, lead score), with the
 * chat-insight and growth cards in the workspaces that have them. A folded card says what is inside; nothing in it is drawn until it is
 * opened.
 */
export function ContactSideCards({
  contact,
  onOpenSection,
  companyFocusSignal,
}: {
  contact: ContactRow;
  onOpenSection?: (section: SectionId) => void;
  /** Changes whenever something outside (the action bar's "Add company") wants the company card open with the cursor in it. */
  companyFocusSignal?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.cards');
  const ts = useTranslations('contacts-attributes-tags.contact.subscription');
  const tb = useTranslations('lead-scoring.card.band');
  const tp = useTranslations('contacts-attributes-tags.contact.compliance');
  const locale = useLocale();
  const canRead = useCan('record.contacts.read');
  const canPickCompany = useCanPickCompany();
  const canConsent = useCan('contacts.consent.read');
  const complianceVisible = useComplianceVisible(contact);
  const fields = useContactFields();
  const tags = useContactTags(contact.id);
  const refresh = useRefreshContact(contact.id);
  // The company row's pencil and the action bar's "Add company" both open the Company card and put the cursor in its search.
  const [nudge, setNudge] = useState(0);
  const companySignal = (companyFocusSignal ?? 0) + nudge || undefined;

  const subs = subscriptionRows(contact)
    .map((r) => `${ts(`channel.${r.channel}`)} ${r.optIn === 'yes' ? ts('yes') : ts('no')}`)
    .join(' · ');
  const zone = timeZoneOf(contact, fields.data);
  const country = countryOfPhone(contact.phone, locale);
  const place = [zone, country].filter(Boolean).join(' · ');
  const score = contact.leadScore;
  const tagCount = tags.data?.length ?? 0;
  const groupCount = contact.groups?.length ?? 0;

  return (
    <div className="space-y-3">
      <KeyDetails
        contact={contact}
        onEditCompany={canPickCompany ? () => setNudge((n) => n + 1) : undefined}
        onOpenSection={onOpenSection}
      />
      <CollapseCard id="subscription" title={ts('title')} summary={subs} defaultOpen>
        <SubscriptionBody
          contact={contact}
          onOpenConsent={onOpenSection && canConsent ? () => onOpenSection('consent') : undefined}
        />
      </CollapseCard>
      <CollapseCard
        id="tags"
        title={t('tags')}
        summary={t('tagsSummary', { tags: tagCount, groups: groupCount })}
      >
        <TagsGroupsBody contact={contact} />
      </CollapseCard>
      {canPickCompany && (
        <CollapseCard
          id="company"
          title={t('company')}
          openSignal={companySignal}
          summary={contact.companyId ? <CompanyLink id={contact.companyId} /> : t('companyNone')}
        >
          <CompanyInline contact={contact} focusSignal={companySignal} />
        </CollapseCard>
      )}
      {canRead && (
        <CollapseCard id="timezone" title={t('timezone')} summary={place || t('timezoneNone')}>
          <div className="space-y-4">
            <LocationBody contact={contact} narrow />
            <TimezoneCard
              bare
              contactId={contact.id}
              rowVersion={contact.rowVersion}
              className="border-t border-border pt-3"
            />
          </div>
        </CollapseCard>
      )}
      {complianceVisible && (
        <CollapseCard
          id="privacy"
          title={t('privacy')}
          summary={
            contact.isUnsubscribed
              ? tp('optedOut')
              : contact.isMinor
                ? t('privacyMinor')
                : tp('allowed')
          }
        >
          <ComplianceBody contact={contact} />
        </CollapseCard>
      )}
      <CollapseCard
        id="score"
        title={t('score')}
        summary={score === null ? t('scoreNone') : `${score} · ${tb(bandOf(score))}`}
      >
        <LeadScoreBody contact={contact} />
      </CollapseCard>
      {/* Only present in a workspace that has the chat reading on; every other workspace sees nothing here. */}
      <ChatInsightCard contactId={contact.id} onChanged={refresh} />
      {/* Only present in a workspace that is in the growth pilot with the conversion model or enrichment on. */}
      <ContactGrowthCard contactId={contact.id} />
    </div>
  );
}
