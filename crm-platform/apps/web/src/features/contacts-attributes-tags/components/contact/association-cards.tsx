'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink, useCanPickCompany } from '@/features/companies';
import { ContactGrowthCard } from '@/features/growth';
import { ChatInsightCard, bandOf } from '@/features/lead-scoring';
import { TaskCompleteCheck, useTasksList } from '@/features/tasks';
import { useContactDeals } from '../../api/deals';
import { useContactFields } from '../../api/properties';
import type { ContactRow } from '../../api/schemas';
import { countryOfPhone, timeZoneOf } from '../../lib/contact-overview';
import { formatMoney, isNotAvailableToYou } from '../../lib/contact-data';
import { channelOptIn, type OptIn, type OptInChannel } from '../../lib/subscription';
import type { AddTarget, SectionId } from '../../lib/sections';
import { TimezoneCard } from '../timezone-card';
import { CheckIcon, MailIcon, SmsIcon, WhatsAppIcon, XIcon } from '../icons';
import {
  ComplianceBody,
  LeadScoreBody,
  LocationBody,
  SubscriptionBody,
  useComplianceVisible,
} from './cards';
import { CollapseCard } from './collapse-card';
import { CompanyInline } from './company-inline';
import { useRefreshContact } from './shared';

const CHANNELS: ReadonlyArray<{ channel: OptInChannel; Icon: typeof SmsIcon }> = [
  { channel: 'whatsapp', Icon: WhatsAppIcon },
  { channel: 'email', Icon: MailIcon },
  { channel: 'sms', Icon: SmsIcon },
];

/** WhatsApp, e-mail and SMS as three small icons, each with a tick (yes), a dot (nothing recorded) or a cross (opted out). */
export function ChannelTicks({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.subscription');
  const word: Record<OptIn, string> = { yes: t('yes'), no: t('no'), out: t('optedOut') };
  return (
    <span className="inline-flex items-center gap-2">
      {CHANNELS.map(({ channel, Icon }) => {
        const v = channelOptIn(contact, channel);
        const said = `${t(`channel.${channel}`)}: ${word[v]}`;
        return (
          <span key={channel} title={said} className="inline-flex items-center gap-0.5">
            <Icon className="size-3.5 text-muted-foreground" />
            {v === 'yes' ? (
              <CheckIcon className="size-3 text-success" />
            ) : v === 'out' ? (
              <XIcon className="size-3 text-danger" />
            ) : (
              <span aria-hidden="true" className="size-1 rounded-full bg-border" />
            )}
            <span className="sr-only">{said}</span>
          </span>
        );
      })}
    </span>
  );
}

function ViewAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
    >
      {label}
    </button>
  );
}

/** Deals linked to the contact (`GET /contacts/:id/deals`): nothing at all in a workspace or role without them. */
function DealsCard({
  contact,
  onOpenSection,
}: {
  contact: ContactRow;
  onOpenSection?: (s: SectionId) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.cards');
  const canRead = useCan('record.deals.read');
  const canCreate = useCan('record.deals.create');
  const locale = useLocale();
  const deals = useContactDeals(contact.id, canRead);
  if (!canRead || (deals.isError && isNotAvailableToYou(deals.error))) return null;
  const list = deals.data?.deals ?? [];
  return (
    <CollapseCard
      id="deals"
      title={t('deals')}
      count={deals.isSuccess ? list.length : null}
      summary={deals.isSuccess && list.length === 0 ? t('dealsNone') : undefined}
      action={canCreate ? { label: t('add'), href: '/deals' } : undefined}
    >
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t('dealsNone')}</p>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 4).map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <Link
                  href={`/deals/${d.id}`}
                  dir="auto"
                  className="block truncate font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {d.title}
                </Link>
                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                  {d.stage.name}
                </span>
              </span>
              <span dir="ltr" className="shrink-0 text-xs font-semibold tabular-nums">
                {formatMoney(d.value, d.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.length > 4 && onOpenSection && (
        <ViewAll label={t('viewAll')} onClick={() => onOpenSection('deals')} />
      )}
    </CollapseCard>
  );
}

/** The contact's open tasks, soonest first, tickable in place; "+ Add" opens the Task tab of the compose box. */
function TasksCard({
  contact,
  onAdd,
  onOpenSection,
}: {
  contact: ContactRow;
  onAdd?: (target: AddTarget) => void;
  onOpenSection?: (s: SectionId) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.cards');
  const format = useFormatter();
  const canRead = useCan('record.tasks.read');
  const canCreate = useCan('record.tasks.create');
  const refresh = useRefreshContact(contact.id);
  const open = useTasksList(
    { kind: 'contact', id: contact.id },
    { status: 'open' },
    { limit: 50, enabled: canRead },
  );
  if (!canRead || open.isError) return null;
  const list = open.items;
  return (
    <CollapseCard
      id="tasks"
      title={t('tasks')}
      count={open.isSuccess ? list.length : null}
      defaultOpen
      summary={open.isSuccess && list.length === 0 ? t('tasksNone') : undefined}
      action={canCreate && onAdd ? { label: t('add'), onClick: () => onAdd('task') } : undefined}
    >
      {list.length === 0 ? (
        <p className="text-muted-foreground">{t('tasksNone')}</p>
      ) : (
        <ul className="space-y-1.5">
          {list.slice(0, 5).map((task) => (
            <li key={task.id} className="flex items-start gap-2">
              <TaskCompleteCheck
                task={task}
                source={{ kind: 'contact', id: contact.id }}
                onChanged={() => void refresh()}
              />
              <span className="min-w-0 flex-1">
                <Link
                  href={`/tasks?tab=all&status=all&task=${task.id}`}
                  dir="auto"
                  className="block truncate outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {task.title}
                </Link>
                {task.dueAt && (
                  <span
                    className={cn(
                      'block text-xs',
                      task.overdue ? 'text-danger' : 'text-muted-foreground',
                    )}
                  >
                    {format.dateTime(new Date(task.dueAt), { dateStyle: 'medium' })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(list.length > 5 || open.hasNextPage) && onOpenSection && (
        <ViewAll label={t('viewAll')} onClick={() => onOpenSection('tasks')} />
      )}
    </CollapseCard>
  );
}

/**
 * The right-hand column of the contact page (and the quick view's Overview): small association cards, each ONE header row with a
 * count and "+ Add", folded unless it is Open tasks or Subscription. Open tasks, Deals, Company, Subscription (the three channel ticks
 * stay in the row), Lead score, Time zone and location, Privacy; then the chat-insight and growth cards in the workspaces that have
 * them. A card is left out for someone who may not see its data; no card is taller than about 200 px open.
 */
export function AssociationCards({
  contact,
  onOpenSection,
  onAdd,
  companyFocusSignal,
  className,
}: {
  contact: ContactRow;
  onOpenSection?: (section: SectionId) => void;
  /** Opens a compose box tab (the tasks card's "+ Add"). */
  onAdd?: (target: AddTarget) => void;
  /** Changes whenever something outside (the action menu's "Add company") wants the company card open with the cursor in it. */
  companyFocusSignal?: number;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.cards');
  const ts = useTranslations('contacts-attributes-tags.contact.subscription');
  const tb = useTranslations('lead-scoring.card.band');
  const tp = useTranslations('contacts-attributes-tags.contact.compliance');
  const locale = useLocale();
  const canRead = useCan('record.contacts.read');
  const canPickCompany = useCanPickCompany();
  const canUpdate = useCan('record.contacts.update');
  const canConsent = useCan('contacts.consent.read');
  const complianceVisible = useComplianceVisible(contact);
  const fields = useContactFields();
  const refresh = useRefreshContact(contact.id);
  // The company's "+ Add" and the action menu's "Add company" both open the card and put the cursor in its search.
  const [nudge, setNudge] = useState(0);
  const companySignal = (companyFocusSignal ?? 0) + nudge || undefined;
  const zone = timeZoneOf(contact, fields.data);
  const place = [zone, countryOfPhone(contact.phone, locale)].filter(Boolean).join(' · ');
  const score = contact.leadScore;

  return (
    <div className={cn('space-y-2', className)}>
      <TasksCard contact={contact} onAdd={onAdd} onOpenSection={onOpenSection} />
      <DealsCard contact={contact} onOpenSection={onOpenSection} />
      {canPickCompany && (
        <CollapseCard
          id="company"
          title={t('company')}
          openSignal={companySignal}
          summary={contact.companyId ? <CompanyLink id={contact.companyId} /> : t('companyNone')}
          action={
            !contact.companyId && canUpdate
              ? { label: t('add'), onClick: () => setNudge((n) => n + 1) }
              : undefined
          }
        >
          <CompanyInline contact={contact} focusSignal={companySignal} />
        </CollapseCard>
      )}
      <CollapseCard
        id="subscription"
        title={ts('title')}
        defaultOpen
        inline={<ChannelTicks contact={contact} />}
      >
        <SubscriptionBody
          contact={contact}
          onOpenConsent={onOpenSection && canConsent ? () => onOpenSection('consent') : undefined}
        />
      </CollapseCard>
      <CollapseCard
        id="score"
        title={t('score')}
        summary={score === null ? t('scoreNone') : `${score} · ${tb(bandOf(score))}`}
      >
        <LeadScoreBody contact={contact} />
      </CollapseCard>
      {canRead && (
        <CollapseCard id="timezone" title={t('timezone')} summary={place || t('timezoneNone')}>
          <div className="space-y-3">
            <LocationBody contact={contact} narrow />
            <TimezoneCard
              bare
              contactId={contact.id}
              rowVersion={contact.rowVersion}
              className="border-t border-border pt-2"
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
      {/* Only present in a workspace that has the chat reading on; every other workspace sees nothing here. */}
      <ChatInsightCard contactId={contact.id} onChanged={refresh} />
      {/* Only present in a workspace that is in the growth pilot with the conversion model or enrichment on. */}
      <ContactGrowthCard contactId={contact.id} />
    </div>
  );
}
