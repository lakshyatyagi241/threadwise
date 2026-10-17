'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, EmptyState, Spinner, cn } from '@crm/ui';
import { CallingProvider, OnCallPanel } from '@/features/calling-voice';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { CompanyLink } from '@/features/companies';
import { ContactPrivacyBadges } from '@/features/contact-consent';
import { bandOf } from '@/features/lead-scoring';
import { ContactPrivacyMenu } from '@/features/privacy-requests';
import { useTasksList } from '@/features/tasks';
import { useContactFiles } from '../api/files';
import { useContactMeetings } from '../api/meetings';
import { useContactNotes } from '../api/notes';
import { useContact } from '../api/contacts';
import { useOwnerNames } from '../api/owners';
import type { ContactRow } from '../api/schemas';
import { displayName, formatPhone, isOptedOut } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import {
  ACTION_SECTION,
  navGroups,
  parseAddTarget,
  sectionAllowed,
  sectionHref,
  type AddTarget,
  type FocusRequest,
  type NavGroupId,
  type SectionId,
} from '../lib/sections';
import { ContactAvatar } from './chips';
import { ContactActionBar } from './contact/action-bar';
import { CallNudge } from './contact/call-nudge';
import { SocialIcons } from './contact/parts';
import { ContactSection } from './contact/sections';
import { StageStrip } from './contact/stage-strip';
import { useStageChange } from './contact/use-stage-change';
import { ContactQuickTags } from './contact-quick-tags';
import { ErrorLine } from './error-line';
import { ChevronLeftIcon, MailIcon, PhoneIcon, StarIcon, UserIcon } from './icons';
import { StageMenu } from './stage-menu';

/**
 * `/contacts/[id]` and `/contacts/[id]/[section]` (TW-CON-018): the contact's page. A sub-nav on the start side (Back to listing, then
 * the sections in three groups with counts; a strip of tabs on a phone), a compact header (avatar, name, stage, lead score, how to
 * reach them, owner, tags) with ONE row of actions, the thin stage line, and the section the URL names (the overview by default). The
 * same section components fill the quick view's drawer.
 */
export function ContactDetail({ id, section }: { id: string; section: SectionId }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const tn = useTranslations('contacts-attributes-tags.contact.nav');
  const contact = useContact(id);
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const groups = useMemo(
    () => navGroups((permission) => permission in session.permissions),
    [session.permissions],
  );

  /** A request to put the cursor in an inline composer of the section on screen (the action bar's buttons, `?add=` from a link). */
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  // `?add=task` (or note, meeting, call, company) opens that composer; the parameter is dropped so a reload does not repeat it.
  const addParam = parseAddTarget(search.get('add'));
  // A call asked for by the "How did the call go?" line carries the time of the click (`&at=`).
  const atParam = Number(search.get('at'));
  const [seenAdd, setSeenAdd] = useState<AddTarget | null>(null);
  if (addParam !== seenAdd) {
    setSeenAdd(addParam);
    if (addParam) {
      setFocus((f) => ({
        target: addParam,
        n: (f?.n ?? 0) + 1,
        ...(addParam === 'call' && atParam > 0 ? { clickedAt: atParam } : {}),
      }));
    }
  }
  useEffect(() => {
    if (addParam) window.history.replaceState(null, '', pathname);
  }, [addParam, pathname]);
  const counts = useNavCounts(id);

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
  const allowed = groups.flatMap((g) => g.sections);
  const current: SectionId = allowed.includes(section) ? section : 'overview';
  // Note, Task, Call, Meeting and Add company are shortcuts: the section that holds the composer opens with the cursor in it.
  const onAdd = (target: AddTarget, opts?: { clickedAt?: number }) => {
    const to = ACTION_SECTION[target];
    const request = (f: FocusRequest | null): FocusRequest => ({
      target,
      n: (f?.n ?? 0) + 1,
      ...(opts?.clickedAt ? { clickedAt: opts.clickedAt } : {}),
    });
    if (to === current) setFocus(request);
    else {
      const next = allowed.includes(to) ? to : 'overview';
      router.push(
        `${sectionHref(id, next)}?add=${target}${opts?.clickedAt ? `&at=${opts.clickedAt}` : ''}`,
      );
    }
  };

  return (
    <CallingProvider>
      <div className="grid gap-3 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-6">
        <aside aria-label={tn('label')} className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <div className="mb-2 lg:mb-3">{back}</div>
          <SectionNav contactId={id} current={current} groups={groups} counts={counts} />
        </aside>

        <div className="min-w-0 space-y-3">
          <DetailHeader
            contact={c}
            onOpenSection={(s) => router.push(sectionHref(id, s))}
            onAdd={onAdd}
            onDeleted={() => router.replace('/contacts')}
          />
          <StageStrip contact={c} />
          <CallNudge
            contactId={c.id}
            name={displayName(c)}
            onLog={(clickedAt) => onAdd('call', { clickedAt })}
          />
          <ContactSection
            section={current}
            contact={c}
            variant="page"
            focus={focus}
            onOpenSection={(s) => router.push(sectionHref(id, s))}
          />
        </div>
      </div>
      <OnCallPanel />
    </CallingProvider>
  );
}

/** How many things a section holds, for the small badge beside its name; only the sections that are cheap to count have one. */
export type NavCounts = Partial<Record<SectionId, { n: number; more: boolean }>>;

/**
 * The counts of the sub-nav: notes, open tasks, meetings and files. They are the lists those sections (and the timeline) read, so a
 * count costs no request the page would not make anyway; a section the person may not open is not asked for.
 */
export function useNavCounts(contactId: string): NavCounts {
  const { permissions } = useSession();
  const has = (p: string) => p in permissions;
  const notes = useContactNotes(contactId, sectionAllowed('notes', has));
  const meetings = useContactMeetings(contactId, sectionAllowed('meetings', has));
  const files = useContactFiles(contactId, sectionAllowed('files', has));
  const tasks = useTasksList(
    { kind: 'contact', id: contactId },
    { status: 'open' },
    { limit: 50, enabled: sectionAllowed('tasks', has) },
  );
  return {
    notes: { n: notes.items.length, more: notes.hasNextPage },
    meetings: { n: meetings.items.length, more: meetings.hasNextPage },
    files: { n: files.items.length, more: files.hasNextPage },
    tasks: { n: tasks.items.length, more: tasks.hasNextPage },
  };
}

/** The sub-nav: three small groups down the start side on a wide screen, one scrolling strip of tabs on a narrow one. */
export function SectionNav({
  contactId,
  current,
  groups,
  counts,
}: {
  contactId: string;
  current: SectionId;
  groups: ReadonlyArray<{ id: NavGroupId; sections: readonly SectionId[] }>;
  /** The badges (`useNavCounts`); none draws none. */
  counts?: NavCounts;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.nav');
  const item = (s: SectionId) => {
    const count = counts?.[s];
    return (
      <Link
        key={s}
        href={sectionHref(contactId, s)}
        aria-current={current === s ? 'page' : undefined}
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
          current === s
            ? 'bg-brand/10 font-semibold text-brand dark:text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {t(`section.${s}`)}
        {count && count.n > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">
            {count.n}
            {count.more ? '+' : ''}
          </span>
        )}
      </Link>
    );
  };
  return (
    <nav
      aria-label={t('label')}
      className="thin-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 max-lg:pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
    >
      {groups.map((g, i) => (
        <div
          key={g.id}
          className={cn(
            'flex gap-1 lg:flex-col',
            // On a phone the groups are told apart by a thin line, on a wide screen by a small heading.
            i > 0 && 'max-lg:ms-1 max-lg:border-s max-lg:border-border max-lg:ps-2 lg:mt-3',
          )}
        >
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground max-lg:hidden">
            {t(`group.${g.id}`)}
          </p>
          {g.sections.map(item)}
        </div>
      ))}
    </nav>
  );
}

/**
 * Avatar and name with the lifecycle stage and lead score beside it; phone, email, company and owner in one line; the privacy chips and
 * tags; and the ONE row of actions. Compact on purpose: the history and the work are below.
 */
function DetailHeader({
  contact,
  onOpenSection,
  onAdd,
  onDeleted,
}: {
  contact: ContactRow;
  onOpenSection: (section: SectionId) => void;
  onAdd: (target: AddTarget) => void;
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
    <header className="rounded-xl border border-border bg-background p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <ContactAvatar
          id={contact.id}
          name={name}
          size="lg"
          className="size-11 text-base sm:size-12 sm:text-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="min-w-0 truncate text-xl font-semibold leading-tight" dir="auto">
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
          <ul className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-0.5 text-sm text-muted-foreground">
            {phone && (
              <li className="inline-flex items-center gap-1.5" dir="ltr">
                <PhoneIcon className="size-3.5 shrink-0" />
                <span className="font-mono">{phone}</span>
              </li>
            )}
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
            {contact.companyId && (
              <li className="inline-flex items-center gap-1.5">
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
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ContactQuickTags contactId={contact.id} labelled />
          </div>
        </div>
        <div className="shrink-0">
          <ContactPrivacyMenu contactId={contact.id} />
        </div>
      </div>
      <ContactActionBar
        contact={contact}
        onAdd={onAdd}
        onDeleted={onDeleted}
        className="mt-3 border-t border-border pt-3"
      />
      {stage.dialog}
    </header>
  );
}
