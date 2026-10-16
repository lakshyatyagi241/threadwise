'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { contactActivityResponseSchema } from '@crm/contracts';
import { Button, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink, useCanPickCompany } from '@/features/companies';
import { ConsentCard } from '@/features/contact-consent';
import { LinkedAppointments } from '@/features/appointments';
import { LinkedInvoices } from '@/features/invoicing';
import { LinkedSalesDocs } from '@/features/sales-docs';
import { LinkedTasks } from '@/features/tasks';
import { AGENT_IGNORE } from '@/lib/agent-marks';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { displayName } from '../../lib/contact-model';
import type { SectionId } from '../../lib/sections';
import { ErrorLine } from '../error-line';
import { GroupChip } from '../chips';
import { ConversationsSection } from './conversations-section';
import { DealsSection } from './deals-section';
import { FieldHistoryPanel } from './field-history';
import { FilesSection } from './files-section';
import { CompanyDialog } from './company-dialog';
import { MeetingsPanel } from './meetings-section';
import { NotesSection } from './notes-section';
import { ContactOverview } from './overview';
import { LeadSourceRows, useCustomGroups, useInfoRows } from './info-tabs';
import { EmptyLine, KeyValueList, Panel, useRefreshContact, type SectionProps } from './shared';
import { StatsSection } from './stats-section';
import { TimezoneCard } from '../timezone-card';

/** The contact's activity timeline (what the old page called "Activity timeline"), newest first, with "Load more". */
export function TimelinePanel({ contactId }: { contactId: string }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const format = useFormatter();
  const list = useCursorList(
    ['cat', 'activities', contactId],
    `/contacts/${contactId}/activities`,
    contactActivityResponseSchema,
  );
  return (
    <Panel id={`tl-${contactId}`} title={t('timeline')}>
      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-6 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyLine>{t('noActivity')}</EmptyLine>
      ) : (
        <ol
          {...AGENT_IGNORE}
          className="relative space-y-5 ps-6 before:absolute before:inset-y-1 before:start-[9px] before:w-px before:bg-border"
        >
          {list.items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -start-6 top-1 size-[18px] rounded-full border border-border bg-background" />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold" dir="auto">
                  {a.title}
                </span>
                <time
                  dateTime={a.occurredAt}
                  className="shrink-0 font-mono text-[11px] text-muted-foreground"
                >
                  {format.dateTime(new Date(a.occurredAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
              </div>
              {a.body && (
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground" dir="auto">
                  {a.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {t('loadMore')}
        </Button>
      )}
    </Panel>
  );
}

/** Activities: the meetings logged with the contact, then the timeline of everything that happened. */
function ActivitiesSection({ contact }: SectionProps) {
  const canRead = useCan('record.contacts.read');
  return (
    <div className="space-y-4">
      {canRead && <MeetingsPanel contact={contact} />}
      {/* The clock marketing messages are read on and the next time one may go (BL-193), right above the history. */}
      {canRead && <TimezoneCard contactId={contact.id} rowVersion={contact.rowVersion} />}
      <TimelinePanel contactId={contact.id} />
    </div>
  );
}

/** Contact details: every field of the contact in one list, its groups, and the workspace's custom property sections. */
function DetailsSection({ contact }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.details');
  const td = useTranslations('contacts-attributes-tags.detail');
  const rows = useInfoRows(contact, { full: true });
  const custom = useCustomGroups(contact);
  const groups = contact.groups ?? [];
  const all = [
    ...rows,
    {
      key: 'stage',
      label: t('stage'),
      value: contact.lifecycleStage ?? '',
    },
    {
      key: 'groups',
      label: td('groups'),
      value:
        groups.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {groups.map((g) => (
              <GroupChip key={g.id} name={g.name} color={g.color} />
            ))}
          </span>
        ) : (
          ''
        ),
    },
    {
      key: 'consent',
      label: td('consent'),
      value: contact.isUnsubscribed ? td('optedOutFull') : td('optedIn'),
    },
  ];
  return (
    <div className="space-y-4">
      <Panel id={`det-${contact.id}`} title={t('title')}>
        <KeyValueList rows={all} />
      </Panel>
      {custom.map((g) => (
        <Panel key={g.title ?? 'other'} title={g.title ?? t('otherProperties')}>
          <KeyValueList
            rows={g.rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))}
          />
        </Panel>
      ))}
    </div>
  );
}

/** The company the contact belongs to: its name as a link, and the way to change it. */
function CompanySection({ contact }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.company');
  const canUpdate = useCan('record.contacts.update');
  const canPick = useCanPickCompany();
  const [open, setOpen] = useState(false);
  return (
    <Panel
      id={`co-${contact.id}`}
      title={t('title')}
      action={
        canUpdate && canPick ? (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {contact.companyId ? t('change') : t('add')}
          </Button>
        ) : undefined
      }
    >
      {contact.companyId ? (
        <p className="text-sm font-medium">
          <CompanyLink id={contact.companyId} />
        </p>
      ) : (
        <EmptyLine>{t('none')}</EmptyLine>
      )}
      <CompanyDialog open={open} contact={contact} onClose={() => setOpen(false)} />
    </Panel>
  );
}

/** Lead source: the contact's source and its first and latest lead touch, as rows. */
function LeadSourcePanel({ contact }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.sections');
  return (
    <Panel id={`ls-${contact.id}`} title={t('lead-source')}>
      <LeadSourceRows contact={contact} />
    </Panel>
  );
}

/** Invoices and sales documents of the contact (each panel gates itself and stays out of the way without access). */
function SalesSection({ contact }: SectionProps) {
  return (
    <div className="space-y-4">
      <LinkedInvoices kind="contact" id={contact.id} />
      <LinkedSalesDocs kind="contact" id={contact.id} />
    </div>
  );
}

/**
 * One section of a contact by its id: what the sub-nav of the details page and the icon rail of the quick view both draw.
 * `onOpenSection` moves to another section in place (the Subscription card's link to Consent); `composer` asks Notes to put the
 * cursor in its composer (the "Note" button).
 */
export function ContactSection({
  section,
  contact,
  variant,
  onOpenSection,
  composer,
}: SectionProps & {
  section: SectionId;
  onOpenSection?: (section: SectionId) => void;
  composer?: boolean;
}) {
  const refresh = useRefreshContact(contact.id);
  const name = displayName(contact);
  const props = { contact, variant } satisfies SectionProps;
  switch (section) {
    case 'overview':
      return <ContactOverview {...props} onOpenSection={onOpenSection} />;
    case 'activities':
      return <ActivitiesSection {...props} />;
    case 'conversations':
      return <ConversationsSection {...props} />;
    case 'details':
      return <DetailsSection {...props} />;
    case 'stats':
      return <StatsSection {...props} />;
    case 'notes':
      return <NotesSection {...props} autoFocusComposer={composer} />;
    case 'files':
      return <FilesSection {...props} />;
    case 'tasks':
      return <LinkedTasks kind="contact" id={contact.id} label={name} onChanged={refresh} />;
    case 'deals':
      return <DealsSection {...props} />;
    case 'appointments':
      return <LinkedAppointments contactId={contact.id} />;
    case 'sales':
      return <SalesSection {...props} />;
    case 'lead-source':
      return <LeadSourcePanel {...props} />;
    case 'company':
      return <CompanySection {...props} />;
    case 'consent':
      return <ConsentCard contactId={contact.id} onChanged={refresh} />;
    case 'history':
      return <FieldHistoryPanel contactId={contact.id} />;
  }
}
