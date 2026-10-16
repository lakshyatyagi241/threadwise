'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactConsent } from '@/features/contact-consent';
import { bandOf, ScoreCard } from '@/features/lead-scoring';
import { useContactFields } from '../../api/properties';
import type { ContactRow } from '../../api/schemas';
import { countryOfPhone, timeZoneOf } from '../../lib/contact-overview';
import { EXTRA_KEYS } from '../../lib/contact-model';
import { sectionHref } from '../../lib/sections';
import { subscriptionRows, type OptInChannel } from '../../lib/subscription';
import { ContactQuickTags } from '../contact-quick-tags';
import { GroupChip } from '../chips';
import { MailIcon, SmsIcon, WhatsAppIcon } from '../icons';
import { OwnerControl } from '../owner-control';
import { OptInPill, ScoreRing } from './parts';
import { KeyValueList, Panel, useRefreshContact, type KeyValueRow } from './shared';

const CHANNEL_ICON: Record<OptInChannel, typeof SmsIcon> = {
  whatsapp: WhatsAppIcon,
  email: MailIcon,
  sms: SmsIcon,
};
const CHANNEL_TINT: Record<OptInChannel, string> = {
  whatsapp: 'text-success',
  email: 'text-primary',
  sms: 'text-brand',
};

/** The lead score as a ring with its band, and the scoring card (AI score, reasons, history) behind "Score details". */
export function LeadScoreCard({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.score');
  const tb = useTranslations('lead-scoring.card.band');
  const refresh = useRefreshContact(contact.id);
  // A contact with no score yet opens the details at once: that is where "Score with AI" lives.
  const [open, setOpen] = useState(contact.leadScore === null);
  const band = contact.leadScore === null ? null : bandOf(contact.leadScore);
  return (
    <Panel
      id={`score-${contact.id}`}
      title={t('title')}
      action={
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="rounded px-1 text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {open ? t('hideDetails') : t('details')}
        </button>
      }
    >
      <div className="flex flex-col items-center gap-2 py-2">
        <ScoreRing
          score={contact.leadScore}
          label={
            contact.leadScore === null
              ? t('none')
              : t('aria', { score: contact.leadScore, band: tb(band!) })
          }
        />
        <p className="text-sm text-muted-foreground">{band ? tb(band) : t('none')}</p>
      </div>
      {open && (
        <ScoreCard
          contactId={contact.id}
          contact={contact}
          className="mt-3 border-0 p-0"
          onScored={refresh}
        />
      )}
    </Panel>
  );
}

/** WhatsApp, email and SMS opt-in as Yes / No (from the contact's subscription labels and opt-out), with the way to the Consent card. */
export function SubscriptionCard({
  contact,
  onOpenConsent,
}: {
  contact: ContactRow;
  /** Present when the screen shows the Consent section in place (the quick view moves to the details page). */
  onOpenConsent?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.subscription');
  const canConsent = useCan('contacts.consent.read');
  const rows = subscriptionRows(contact);
  return (
    <Panel id={`subs-${contact.id}`} title={t('title')}>
      <ul className="divide-y divide-border">
        {rows.map(({ channel, optIn }) => {
          const Icon = CHANNEL_ICON[channel];
          return (
            <li key={channel} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Icon className={`size-4 ${CHANNEL_TINT[channel]}`} />
              <span className="flex-1 text-sm">{t(`channel.${channel}`)}</span>
              <OptInPill value={optIn} />
            </li>
          );
        })}
      </ul>
      {contact.isUnsubscribed && (
        <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          {t('optedOutNote')}
        </p>
      )}
      {canConsent && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('proof')}{' '}
          {onOpenConsent ? (
            <button
              type="button"
              onClick={onOpenConsent}
              className="font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('openConsent')}
            </button>
          ) : (
            <Link
              href={sectionHref(contact.id, 'consent')}
              className="font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('openConsent')}
            </Link>
          )}
        </p>
      )}
    </Panel>
  );
}

/** Owner (changeable by those who may), the contact's tags with "Add tag", and its groups. */
export function OwnerCard({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.owner');
  const canUpdate = useCan('record.contacts.update');
  const groups = contact.groups ?? [];
  return (
    <Panel id={`owner-${contact.id}`} title={t('title')}>
      <dl className="divide-y divide-border text-sm">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 pb-3">
          <dt className="text-muted-foreground">{t('owner')}</dt>
          <dd className="min-w-0">
            <OwnerControl
              contactId={contact.id}
              ownerId={contact.ownerId}
              rowVersion={contact.rowVersion}
              canEdit={canUpdate}
            />
          </dd>
        </div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 py-3">
          <dt className="pt-1 text-muted-foreground">{t('tags')}</dt>
          <dd className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <ContactQuickTags contactId={contact.id} labelled />
            </div>
          </dd>
        </div>
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 pt-3">
          <dt className="text-muted-foreground">{t('groups')}</dt>
          <dd className="min-w-0">
            {groups.length === 0 ? (
              <span className="text-muted-foreground">&mdash;</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {groups.map((g) => (
                  <GroupChip key={g.id} name={g.name} color={g.color} />
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Where the contact is: the address they gave, the country their number belongs to, their time zone and language. */
export function LocationCard({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.location');
  const locale = useLocale();
  const fields = useContactFields();
  const text = (key: string) =>
    typeof contact.customFields[key] === 'string' ? (contact.customFields[key] as string) : '';
  const rows: KeyValueRow[] = [
    { key: 'address', label: t('address'), value: text(EXTRA_KEYS.address) },
    { key: 'country', label: t('country'), value: countryOfPhone(contact.phone, locale) },
    { key: 'timeZone', label: t('timeZone'), value: timeZoneOf(contact, fields.data), ltr: true },
    { key: 'language', label: t('language'), value: text(EXTRA_KEYS.language) },
  ];
  return (
    <Panel id={`loc-${contact.id}`} title={t('title')}>
      <KeyValueList rows={rows} />
    </Panel>
  );
}

/** The privacy side of the contact: marketing opt-out, minor, guardian consent and do-not-sell-or-share, from the consent record. */
export function ComplianceCard({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.compliance');
  const tp = useTranslations('contact-consent.card.privacy');
  const canRead = useCan('contacts.consent.read');
  const q = useContactConsent(contact.id, canRead);
  const p = q.data?.privacy;
  if (!canRead && !contact.isUnsubscribed) return null;
  return (
    <Panel id={`comp-${contact.id}`} title={t('title')}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Badge tone={contact.isUnsubscribed ? 'danger' : 'success'}>
          {contact.isUnsubscribed ? t('optedOut') : t('allowed')}
        </Badge>
        {p?.isMinor && <Badge tone="warning">{tp('minorLabel')}</Badge>}
        {p?.isMinor && p.guardianConsent && <Badge tone="neutral">{tp('guardianBadge')}</Badge>}
        {p?.doNotSellShare && <Badge tone="danger">{tp('dnsLabel')}</Badge>}
        {canRead && p && !p.isMinor && !p.doNotSellShare && (
          <span className="text-xs text-muted-foreground">{t('noFlags')}</span>
        )}
      </div>
    </Panel>
  );
}
