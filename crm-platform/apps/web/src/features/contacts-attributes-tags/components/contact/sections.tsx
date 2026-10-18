'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ConsentCard } from '@/features/contact-consent';
import { LinkedAppointments } from '@/features/appointments';
import { LinkedInvoices } from '@/features/invoicing';
import { LinkedSalesDocs } from '@/features/sales-docs';
import { LinkedTasks } from '@/features/tasks';
import { displayName } from '../../lib/contact-model';
import type { AddTarget, FocusRequest, SectionId } from '../../lib/sections';
import { GroupChip } from '../chips';
import { ConversationsSection } from './conversations-section';
import { DealsSection } from './deals-section';
import { FieldHistoryPanel } from './field-history';
import { FilesSection } from './files-section';
import { CompanyCard } from './company-inline';
import { MeetingsPanel } from './meetings-section';
import { NotesSection } from './notes-section';
import { ContactOverview } from './overview';
import { LeadSourceRows, useCustomGroups, useInfoRows } from './info-tabs';
import { KeyValueList, Panel, useRefreshContact, type SectionProps } from './shared';
import { ActivityWorkspace } from './timeline/activity-workspace';
import { StatsSection } from './stats-section';

/** Contact details: every field of the contact in one list, its groups, and the workspace's custom property sections. */
function DetailsSection({ contact }: SectionProps) {
  const t = useTranslations('contacts-attributes-tags.contact.details');
  const td = useTranslations('contacts-attributes-tags.detail');
  const format = useFormatter();
  const rows = useInfoRows(contact, { full: true });
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const custom = useCustomGroups(contact);
  const groups = contact.groups ?? [];
  const all = [
    ...rows,
    {
      key: 'stage',
      label: t('stage'),
      value: contact.lifecycleStage ?? '',
    },
    // the stage history a migrated or edited contact carries: since when, and the stage before
    { key: 'stage-since', label: t('stageSince'), value: when(contact.lifecycleStageDate) },
    { key: 'stage-prev', label: t('previousStage'), value: contact.previousLifecycleStage ?? '' },
    {
      key: 'stage-prev-since',
      label: t('previousStageSince'),
      value: when(contact.previousLifecycleStageDate),
    },
    { key: 'lost-reason', label: t('lostReason'), value: contact.lostReason ?? '' },
    { key: 'updated', label: t('updatedAt'), value: when(contact.updatedAt) },
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
 * `onOpenSection` moves to another section in place (the Subscription card's link to Consent); `focus` asks the section's inline
 * composer to take the cursor (the "Note", "Task", "Meeting" and "Add company" buttons). Nothing here opens a dialog.
 */
export function ContactSection({
  section,
  contact,
  variant,
  onOpenSection,
  onAdd,
  focus,
}: SectionProps & {
  section: SectionId;
  /** Opens a compose tab of the Activity workspace (the tasks card's "+ Add"). */
  onAdd?: (target: AddTarget) => void;
  onOpenSection?: (section: SectionId) => void;
  /** Asks the section's inline composer (note, task, meeting, company) to take the cursor: the action bar's buttons and the list's quick add. */
  focus?: FocusRequest | null;
}) {
  const refresh = useRefreshContact(contact.id);
  const name = displayName(contact);
  const props = { contact, variant } satisfies SectionProps;
  const signal = (target: FocusRequest['target']) =>
    focus?.target === target ? focus.n : undefined;
  switch (section) {
    case 'overview':
      return (
        <ContactOverview
          {...props}
          focus={focus}
          onAdd={onAdd}
          onOpenSection={onOpenSection}
          companyFocusSignal={signal('company')}
          scoreFocusSignal={signal('score')}
        />
      );
    case 'activities':
      return <ActivityWorkspace contact={contact} focus={focus} />;
    case 'conversations':
      return <ConversationsSection {...props} />;
    case 'details':
      return <DetailsSection {...props} />;
    case 'stats':
      return <StatsSection {...props} />;
    case 'notes':
      return <NotesSection {...props} focusSignal={signal('note')} />;
    case 'meetings':
      return <MeetingsPanel contact={contact} focusSignal={signal('meeting')} />;
    case 'files':
      return <FilesSection {...props} />;
    case 'tasks':
      return (
        <LinkedTasks
          kind="contact"
          id={contact.id}
          label={name}
          onChanged={refresh}
          inline
          focusSignal={signal('task')}
        />
      );
    case 'deals':
      return <DealsSection {...props} />;
    case 'appointments':
      return <LinkedAppointments contactId={contact.id} />;
    case 'sales':
      return <SalesSection {...props} />;
    case 'lead-source':
      return <LeadSourcePanel {...props} />;
    case 'company':
      return <CompanyCard contact={contact} focusSignal={signal('company')} />;
    case 'consent':
      return <ConsentCard contactId={contact.id} onChanged={refresh} />;
    case 'history':
      return <FieldHistoryPanel contactId={contact.id} />;
  }
}
