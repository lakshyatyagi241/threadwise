'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, EmptyState, Spinner, cn } from '@crm/ui';
import { CallingProvider, OnCallPanel } from '@/features/calling-voice';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink } from '@/features/companies';
import { ContactPrivacyBadges } from '@/features/contact-consent';
import { bandOf } from '@/features/lead-scoring';
import { ContactPrivacyMenu } from '@/features/privacy-requests';
import { useContact } from '../api/contacts';
import { useOwnerNames } from '../api/owners';
import type { ContactRow } from '../api/schemas';
import { displayName, formatPhone, isOptedOut } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import {
  sectionHref,
  visibleSections,
  type CoreSection,
  type RelatedSection,
  type SectionId,
} from '../lib/sections';
import { ContactAvatar } from './chips';
import { ContactActionBar } from './contact/action-bar';
import { FieldHistoryButton } from './contact/field-history';
import { SocialIcons } from './contact/parts';
import { ContactSection } from './contact/sections';
import { useStageChange, type StageChange } from './contact/use-stage-change';
import { ContactQuickTags } from './contact-quick-tags';
import { ErrorLine } from './error-line';
import { BuildingIcon, ChevronLeftIcon, MailIcon, PhoneIcon, StarIcon, UserIcon } from './icons';
import { StageMenu } from './stage-menu';
import { optionColor } from '../lib/stage-model';

/**
 * `/contacts/[id]` and `/contacts/[id]/[section]` (TW-CON-018): the contact's page. A sub-nav on the start side (Back to listing,
 * the contact's sections, then the related ones), the header (avatar, name, lifecycle stage, lead-score star, how to reach them,
 * owner, social links, tags, the action bar), the lifecycle stage stepper with the status bar of that stage, and the section the URL
 * names (the overview by default). The same section components fill the quick view's drawer.
 */
export function ContactDetail({ id, section }: { id: string; section: SectionId }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const tn = useTranslations('contacts-attributes-tags.contact.nav');
  const contact = useContact(id);
  const session = useSession();
  const router = useRouter();
  const nav = useMemo(
    () => visibleSections((permission) => permission in session.permissions),
    [session.permissions],
  );

  const back = (
    <Link
      href="/contacts"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ChevronLeftIcon className="size-3.5 rtl:rotate-180" /> {tn('back')}
    </Link>
  );

  if (contact.isPending) {
    return (
      <section>
        <div className="mb-4">{back}</div>
        <div role="status" className="flex items-center gap-2 py-10 text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      </section>
    );
  }
  if (contact.isError) {
    return (
      <section>
        <div className="mb-4">{back}</div>
        {errorKind(contact.error) === 'unavailable' ? (
          <EmptyState title={t('notFoundTitle')} message={t('notFound')} />
        ) : (
          <ErrorLine error={contact.error} onRetry={() => void contact.refetch()} />
        )}
      </section>
    );
  }

  const c = contact.data;
  // A section this person cannot open (no permission) falls back to the overview.
  const allowed = [...nav.core, ...nav.related] as SectionId[];
  const current: SectionId = allowed.includes(section) ? section : 'overview';

  return (
    <CallingProvider>
      <div className="grid gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-6">
        <aside aria-label={tn('label')} className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3">{back}</div>
          <SectionNav contactId={id} current={current} core={nav.core} related={nav.related} />
        </aside>

        <div className="min-w-0 space-y-4">
          <DetailHeader
            contact={c}
            onOpenSection={(s) => router.push(sectionHref(id, s))}
            onDeleted={() => router.replace('/contacts')}
          />
          <StageStepper contact={c} />
          <ContactSection
            section={current}
            contact={c}
            variant="page"
            composer={false}
            onOpenSection={(s) => router.push(sectionHref(id, s))}
          />
        </div>
      </div>
      <OnCallPanel />
    </CallingProvider>
  );
}

/** The sub-nav: a vertical list on a wide screen, a scrolling strip of tabs on a narrow one. */
function SectionNav({
  contactId,
  current,
  core,
  related,
}: {
  contactId: string;
  current: SectionId;
  core: readonly CoreSection[];
  related: readonly RelatedSection[];
}) {
  const t = useTranslations('contacts-attributes-tags.contact.nav');
  const item = (s: SectionId) => (
    <Link
      key={s}
      href={sectionHref(contactId, s)}
      aria-current={current === s ? 'page' : undefined}
      className={cn(
        'block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
        current === s
          ? 'bg-brand/10 font-semibold text-brand'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {t(`section.${s}`)}
    </Link>
  );
  const heading = (text: string) => (
    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-lg:hidden">
      {text}
    </p>
  );
  return (
    <nav
      aria-label={t('label')}
      className="thin-scrollbar flex gap-1 overflow-x-auto max-lg:pb-1 lg:flex-col lg:overflow-visible"
    >
      {heading(t('contactDetails'))}
      {core.map(item)}
      {related.length > 0 && heading(t('related'))}
      {related.map(item)}
    </nav>
  );
}

/** Avatar, name and lifecycle stage; email, phone, company and owner in one line; social links, privacy chips and tags; the action bar. */
function DetailHeader({
  contact,
  onOpenSection,
  onDeleted,
}: {
  contact: ContactRow;
  onOpenSection: (section: SectionId) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const th = useTranslations('contacts-attributes-tags.contact.header');
  const canUpdate = useCan('record.contacts.update');
  const stage = useStageChange(contact);
  const { nameOf } = useOwnerNames();
  const name = displayName(contact) || t('unnamed');
  const phone = formatPhone(contact.phone);
  const owner = contact.ownerId ? nameOf(contact.ownerId) : undefined;
  const band = contact.leadScore === null ? null : bandOf(contact.leadScore);

  return (
    <header className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <ContactAvatar
            id={contact.id}
            name={name}
            size="lg"
            className="size-14 text-lg sm:size-16 sm:text-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 truncate text-2xl font-semibold leading-tight" dir="auto">
                {name}
              </h1>
              {contact.lifecycleStage && (
                <StageMenu
                  value={contact.lifecycleStage}
                  choices={stage.stages}
                  name={name}
                  busy={stage.busy}
                  statusHint={stage.hint}
                  onChange={canUpdate ? stage.changeStage : undefined}
                />
              )}
              {band && (
                <button
                  type="button"
                  onClick={() => onOpenSection('overview')}
                  title={th('leadScore')}
                  aria-label={th('leadScoreAria', { score: contact.leadScore ?? 0 })}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    band === 'hot' && 'border-success/30 bg-success/10 text-success',
                    band === 'warm' && 'border-warning/30 bg-warning/10 text-warning',
                    band === 'cold' && 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  <StarIcon className="size-3.5" />
                  {contact.leadScore}
                </button>
              )}
              {isOptedOut(contact) && <Badge tone="warning">{t('optedOut')}</Badge>}
              <ContactPrivacyBadges contactId={contact.id} />
            </div>
            <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {contact.email && (
                <li className="inline-flex min-w-0 items-center gap-1.5" dir="ltr">
                  <MailIcon className="size-3.5 shrink-0" />
                  <a
                    href={`mailto:${contact.email}`}
                    className="truncate hover:text-foreground hover:underline"
                  >
                    {contact.email}
                  </a>
                </li>
              )}
              {phone && (
                <li className="inline-flex items-center gap-1.5" dir="ltr">
                  <PhoneIcon className="size-3.5 shrink-0" />
                  <span className="font-mono">{phone}</span>
                </li>
              )}
              {contact.companyId && (
                <li className="inline-flex items-center gap-1.5">
                  <BuildingIcon className="size-3.5 shrink-0" />
                  <CompanyLink id={contact.companyId} />
                </li>
              )}
              <li className="inline-flex items-center gap-1.5">
                <UserIcon className="size-3.5 shrink-0" />
                <span>
                  {th('owner')}: {contact.ownerId ? (owner ?? '') : t('ownerNone')}
                </span>
              </li>
              <li>
                <SocialIcons contact={contact} />
              </li>
            </ul>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <ContactQuickTags contactId={contact.id} labelled />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FieldHistoryButton contactId={contact.id} />
          <ContactPrivacyMenu contactId={contact.id} />
        </div>
      </div>
      <ContactActionBar
        contact={contact}
        onOpenSection={(s) => onOpenSection(s)}
        onDeleted={onDeleted}
        className="mt-4 border-t border-border pt-3"
      />
      {stage.dialog}
    </header>
  );
}

/**
 * The lifecycle stages as a stepper (the contact's stage highlighted, the ones before it tinted) with the status bar of that stage
 * under it. Clicking a stage is the stage menu's change (a lost stage asks why first and the toast says what happened to the status);
 * clicking a status sets it, among the statuses valid in the stage, which is the linking rule the API enforces.
 */
function StageStepper({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.stages');
  const canUpdate = useCan('record.contacts.update');
  const stage = useStageChange(contact);
  const current = contact.lifecycleStage;
  const at = stage.stages.findIndex((s) => s.value === current);
  if (stage.stages.length === 0) return null;
  return (
    <section
      aria-label={t('title')}
      className="space-y-3 rounded-xl border border-border bg-background p-4 sm:p-5"
    >
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('stages')}
        </h2>
        <ol className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {stage.stages.map((s, i) => {
            const active = s.value === current;
            const done = at >= 0 && i < at;
            const hint = canUpdate && !active ? stage.hint(s.value) : null;
            return (
              <li key={s.value} className="min-w-[7.5rem] flex-1">
                <button
                  type="button"
                  disabled={!canUpdate || stage.busy}
                  aria-current={active ? 'step' : undefined}
                  title={hint ?? undefined}
                  onClick={() => stage.changeStage(s.value)}
                  className={cn(
                    'relative flex h-10 w-full items-center justify-center gap-2 rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
                    active
                      ? 'border-brand bg-brand font-semibold text-brand-foreground'
                      : done
                        ? 'border-brand/30 bg-brand/10 text-brand hover:bg-brand/15'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background: active
                        ? 'currentColor'
                        : optionColor({ value: s.value, color: s.color }),
                    }}
                  />
                  <span className="truncate">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <StatusBar stage={stage} current={contact.status} canUpdate={canUpdate} />
      {stage.dialog}
    </section>
  );
}

function StatusBar({
  stage,
  current,
  canUpdate,
}: {
  stage: StageChange;
  current: string | null;
  canUpdate: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.stages');
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('status')}
      </h2>
      {stage.statuses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noStatuses')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('status')}>
          {stage.statuses.map((s) => {
            const on = s.value === current;
            return (
              <li key={s.value}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canUpdate || stage.busy}
                  onClick={() => stage.changeStatus(s.value)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default',
                    on
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
