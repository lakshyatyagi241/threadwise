'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Tabs, type TabItem } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink } from '@/features/companies';
import { attributionView, useContactAttribution, type TouchView } from '@/features/lead-sources';
import { useContactFields, useFieldSections } from '../../api/properties';
import type { ContactRow } from '../../api/schemas';
import {
  EXTRA_KEYS,
  formatPhone,
  RESERVED_CUSTOM_KEYS,
  titleCaseKey,
} from '../../lib/contact-model';
import { jobTitleField, jobTitleOf, socialLinks } from '../../lib/contact-overview';
import { detailGroups } from '../../lib/property-model';
import { EmptyLine, KeyValueList, type KeyValueRow } from './shared';

const text = (c: Pick<ContactRow, 'customFields'>, key: string): string =>
  typeof c.customFields[key] === 'string' ? (c.customFields[key] as string) : '';

/** A when-column: the date, and how long ago in words. */
function useWhen() {
  const format = useFormatter();
  return (iso: string | null) =>
    iso
      ? `${format.dateTime(new Date(iso), { dateStyle: 'medium' })} (${format.relativeTime(new Date(iso))})`
      : '';
}

/** The rows of "Contact information": identity, how to reach the contact, where they work, and when they were last seen. */
export function useInfoRows(contact: ContactRow, opts: { full?: boolean } = {}): KeyValueRow[] {
  const t = useTranslations('contacts-attributes-tags.contact.info');
  const fields = useContactFields();
  const when = useWhen();
  const job = jobTitleField(fields.data);
  const rows: KeyValueRow[] = [
    { key: 'first', label: t('firstName'), value: contact.firstName ?? '' },
    { key: 'last', label: t('lastName'), value: contact.lastName ?? '' },
    {
      key: 'email',
      label: t('email'),
      ltr: true,
      value: contact.email ? (
        <a
          href={`mailto:${contact.email}`}
          className="break-all text-primary underline-offset-2 hover:underline"
        >
          {contact.email}
        </a>
      ) : (
        ''
      ),
    },
    { key: 'phone', label: t('phone'), ltr: true, value: formatPhone(contact.phone) },
    ...(opts.full
      ? [{ key: 'fax', label: t('fax'), ltr: true, value: contact.faxNumber ?? '' }]
      : []),
    {
      key: 'company',
      label: t('company'),
      value: contact.companyId ? <CompanyLink id={contact.companyId} /> : '',
    },
    ...(job ? [{ key: 'job', label: t('jobTitle'), value: jobTitleOf(contact, job) }] : []),
    { key: 'language', label: t('language'), value: text(contact, EXTRA_KEYS.language) },
    ...(opts.full
      ? [
          { key: 'address', label: t('address'), value: text(contact, EXTRA_KEYS.address) },
          { key: 'memo', label: t('memo'), value: text(contact, EXTRA_KEYS.memo) },
          { key: 'id', label: t('contactId'), ltr: true, value: contact.displayId ?? '' },
        ]
      : []),
    { key: 'created', label: t('createdAt'), value: when(contact.createdAt) },
    { key: 'activity', label: t('lastActivity'), value: when(contact.lastActivityAt) },
  ];
  return rows;
}

/** The custom property groups of a contact (the workspace's own sections), as rows ready to draw. */
export function useCustomGroups(contact: ContactRow) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const registry = useContactFields();
  const sections = useFieldSections();
  return detailGroups(
    registry.data ?? [],
    sections.data ?? [],
    contact.customFields,
    RESERVED_CUSTOM_KEYS,
    { yes: t('yes'), no: t('no') },
    titleCaseKey,
  );
}

function CustomFields({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.info');
  const groups = useCustomGroups(contact);
  if (groups.length === 0) return <EmptyLine>{t('noCustomFields')}</EmptyLine>;
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.title ?? 'other'} className="space-y-2">
          {g.title && (
            <h3
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              dir="auto"
            >
              {g.title}
            </h3>
          )}
          <KeyValueList
            rows={g.rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))}
          />
        </div>
      ))}
    </div>
  );
}

function TouchRows({ touch, label }: { touch: TouchView; label: string }) {
  const t = useTranslations('lead-sources.attribution');
  const format = useFormatter();
  const rows: KeyValueRow[] = [
    { key: 'platform', label: t('platform'), value: touch.platform ?? touch.sourceLabel },
    ...(touch.platform && touch.sourceLabel !== touch.platform
      ? [{ key: 'source', label: t('source'), value: touch.sourceLabel }]
      : []),
    ...touch.details.map((d) => ({ key: d.field, label: t(`fields.${d.field}`), value: d.value })),
    {
      key: 'at',
      label: t('capturedAt'),
      value: format.dateTime(new Date(touch.capturedAt), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <KeyValueList rows={rows} />
    </div>
  );
}

/**
 * Where the contact came from: the contact's own `source`, and the first and latest touch of the lead pipeline (platform,
 * campaign, ad set, ad, form) from the same data as the "Lead attribution" card. It stands where a product with one lead
 * channel shows its form fields.
 */
export function LeadSourceRows({ contact }: { contact: ContactRow }) {
  const t = useTranslations('lead-sources.attribution');
  const ti = useTranslations('contacts-attributes-tags.contact.info');
  const canRead = useCan('record.contacts.read');
  const q = useContactAttribution(contact.id, canRead);
  const view = q.isSuccess ? attributionView(q.data) : null;
  const source = contact.source ?? text(contact, EXTRA_KEYS.source);
  if (!view && !source) return <EmptyLine>{ti('noLeadSource')}</EmptyLine>;
  return (
    <div className="space-y-5">
      {source && <KeyValueList rows={[{ key: 'src', label: ti('source'), value: source }]} />}
      {view &&
        (view.single ? (
          <TouchRows touch={view.first} label={t('firstAndLatest')} />
        ) : (
          <>
            <TouchRows touch={view.first} label={t('first')} />
            <TouchRows touch={view.latest} label={t('latest')} />
          </>
        ))}
      {view && view.total > 1 && (
        <p className="text-xs text-muted-foreground">{t('total', { count: view.total })}</p>
      )}
    </div>
  );
}

function SocialRows({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.social');
  const links = socialLinks(contact.customFields);
  return (
    <KeyValueList
      rows={links.map((l) => ({
        key: l.network,
        label: t(l.network),
        ltr: true,
        value: (
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline-offset-2 hover:underline"
          >
            {l.url}
          </a>
        ),
      }))}
    />
  );
}

/**
 * The tabs of the overview: Contact information, Social media (only when the contact has a profile link), Lead source and
 * Custom fields. Web analytics is not here on purpose: no visit or page-view data exists for a contact.
 */
export function ContactInfoTabs({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.tabs');
  const info = useInfoRows(contact);
  const hasSocial = socialLinks(contact.customFields).length > 0;
  const items: TabItem[] = [
    { id: 'info', label: t('info'), content: <KeyValueList rows={info} /> },
    ...(hasSocial
      ? [{ id: 'social', label: t('social'), content: <SocialRows contact={contact} /> }]
      : []),
    { id: 'source', label: t('source'), content: <LeadSourceRows contact={contact} /> },
    { id: 'custom', label: t('custom'), content: <CustomFields contact={contact} /> },
  ];
  return <Tabs items={items} />;
}
