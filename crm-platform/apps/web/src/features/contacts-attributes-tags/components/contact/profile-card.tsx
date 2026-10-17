'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, cn } from '@crm/ui';
import { ContactPrivacyBadges } from '@/features/contact-consent';
import type { ContactRow } from '../../api/schemas';
import { displayName, isOptedOut } from '../../lib/contact-model';
import type { AddTarget, SectionId } from '../../lib/sections';
import { ContactAvatar } from '../chips';
import { ChevronLeftIcon } from '../icons';
import { ContactActionBar } from './action-bar';
import { KeyDetails } from './key-details';
import { LeadScoreChip } from './lead-score-chip';
import { JobTitle, SocialIcons } from './parts';
import { StageControl } from './stage-control';

/**
 * The left column of the contact page (HubSpot's profile card): the way back, avatar and name with the lead score, the job title, the
 * stage as ONE control with the status beside it, and ONE centered row of round actions; under it "About this contact" (eight rows,
 * edit in place, tags). Nothing else is in the header: the owner is a row of the About list, the privacy actions are in "...".
 */
export function ProfileColumn({
  contact,
  onAdd,
  onDeleted,
  onOpenSection,
  className,
}: {
  contact: ContactRow;
  onAdd: (target: AddTarget) => void;
  onDeleted: () => void;
  onOpenSection: (section: SectionId) => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const tn = useTranslations('contacts-attributes-tags.contact.nav');
  const name = displayName(contact) || t('unnamed');

  return (
    <div className={cn('space-y-3', className)}>
      <section className="rounded-xl border border-border bg-background p-4">
        <Link
          href="/contacts"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-3.5 rtl:rotate-180" /> {tn('back')}
        </Link>
        <div className="flex items-start gap-3">
          <ContactAvatar id={contact.id} name={name} size="lg" className="size-12 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="min-w-0 break-words text-lg font-semibold leading-tight" dir="auto">
                {name}
              </h1>
              <LeadScoreChip contact={contact} onOpen={() => onAdd('score')} />
            </div>
            <JobTitle contact={contact} />
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {isOptedOut(contact) && <Badge tone="warning">{t('optedOut')}</Badge>}
              <ContactPrivacyBadges contactId={contact.id} />
              <SocialIcons contact={contact} />
            </div>
          </div>
        </div>
        <StageControl contact={contact} className="mt-3" />
        <ContactActionBar
          variant="round"
          contact={contact}
          onAdd={onAdd}
          onDeleted={onDeleted}
          className="mt-4 border-t border-border pt-4"
        />
      </section>
      <KeyDetails
        contact={contact}
        onEditCompany={() => onAdd('company')}
        onOpenSection={onOpenSection}
      />
    </div>
  );
}
