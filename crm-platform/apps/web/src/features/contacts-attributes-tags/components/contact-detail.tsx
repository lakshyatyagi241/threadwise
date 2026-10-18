'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useNow, useTranslations } from 'next-intl';
import { EmptyState, Menu, MenuItem, Spinner, cn } from '@crm/ui';
import { CallingProvider, OnCallPanel } from '@/features/calling-voice';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { usePersonaVisibility } from '@/features/persona';
import { useTasksList } from '@/features/tasks';
import { useContactDeals } from '../api/deals';
import { useContactFiles } from '../api/files';
import { useContactMeetings } from '../api/meetings';
import { useContact } from '../api/contacts';
import { displayName } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import {
  ACTION_SECTION,
  pageTabs,
  parseAddTarget,
  sectionAllowed,
  sectionHref,
  type AddTarget,
  type FocusRequest,
  type SectionId,
} from '../lib/sections';
import { AssociationCards } from './contact/association-cards';
import { CallNudge } from './contact/call-nudge';
import { ProfileColumn } from './contact/profile-card';
import { ContactSection } from './contact/sections';
import { ErrorLine } from './error-line';
import { ChevronDownIcon, ChevronLeftIcon } from './icons';

/** The tabs that hold the compose box: an action of the profile card stays on them instead of moving. */
const COMPOSE_TABS: readonly SectionId[] = ['overview', 'activities'];

/**
 * `/contacts/[id]` and `/contacts/[id]/[section]` (TW-CON-018): the contact's page, HubSpot's three columns. On the start side the
 * profile card (name, stage, one row of round actions) and "About this contact"; in the middle a tab bar (Overview, Activity,
 * Conversations, Deals, Files, More) and the tab the URL names, the timeline being the main thing on Overview and Activity; on the
 * end side small association cards. From 1280 px the three columns fill the window and scroll on their own, so no band of the page is
 * ever empty; below that the cards move under the middle column, and below 768 px everything is one column. The same section
 * components fill the quick view's drawer.
 */
export function ContactDetail({ id, section }: { id: string; section: SectionId }) {
  const t = useTranslations('contacts-attributes-tags.detail');
  const tn = useTranslations('contacts-attributes-tags.contact.nav');
  const tr = useTranslations('contacts-attributes-tags.contact.record');
  const contact = useContact(id);
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const persona = usePersonaVisibility();
  // What the person's permissions allow: it decides which section opens, so a link to a section the persona hides still works.
  const permitted = useMemo(
    () => pageTabs((permission) => permission in session.permissions),
    [session.permissions],
  );

  /** A request to put the cursor in an inline composer of the section on screen (the profile card's actions, `?add=` from a link). */
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
  const counts = useTabCounts(id);

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
  const allowed = [...permitted.primary, ...permitted.more];
  const current: SectionId = allowed.includes(section) ? section : 'overview';
  // The strip leaves out what the workspace's persona hides (spared while it is the section on screen); nothing is closed.
  const tabs = pageTabs(
    (permission) => permission in session.permissions,
    (s) => s !== current && persona.isSectionHidden(s),
  );
  const open = (s: SectionId) => router.push(sectionHref(id, s));
  // Note, Task, Call and Meeting open the compose box where it is (Overview, Activity), else on the Activity tab; the company opens its card.
  const onAdd = (target: AddTarget, opts?: { clickedAt?: number }) => {
    const request = (f: FocusRequest | null): FocusRequest => ({
      target,
      n: (f?.n ?? 0) + 1,
      ...(opts?.clickedAt ? { clickedAt: opts.clickedAt } : {}),
    });
    if (target === 'company' || target === 'score' || COMPOSE_TABS.includes(current))
      setFocus(request);
    else {
      router.push(
        `${sectionHref(id, ACTION_SECTION[target])}?add=${target}${opts?.clickedAt ? `&at=${opts.clickedAt}` : ''}`,
      );
    }
  };

  return (
    <CallingProvider>
      <div
        className={cn(
          'grid gap-4 md:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_18rem]',
          // From 1280 px the columns fill the window height and scroll on their own.
          'xl:h-[calc(100dvh-7rem)] xl:min-h-[34rem] xl:overflow-hidden',
        )}
      >
        <aside
          aria-label={tr('profile.label')}
          data-testid="contact-left"
          className="thin-scrollbar min-w-0 md:col-start-1 md:row-span-2 md:row-start-1 xl:row-span-1 xl:min-h-0 xl:overflow-y-auto"
        >
          <ProfileColumn
            contact={c}
            onAdd={onAdd}
            onDeleted={() => router.replace('/contacts')}
            onOpenSection={open}
          />
        </aside>

        <div
          data-testid="contact-center"
          className="thin-scrollbar flex min-w-0 flex-col md:col-start-2 md:row-start-1 xl:min-h-0 xl:overflow-y-auto"
        >
          <ContactTabs contactId={id} current={current} tabs={tabs} counts={counts} />
          <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
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
              onAdd={onAdd}
              onOpenSection={open}
            />
          </div>
        </div>

        <aside
          aria-label={tr('cards.label')}
          data-testid="contact-right"
          className="thin-scrollbar min-w-0 md:col-start-2 md:row-start-2 xl:col-start-3 xl:row-span-1 xl:row-start-1 xl:min-h-0 xl:overflow-y-auto"
        >
          <AssociationCards
            contact={c}
            onOpenSection={open}
            onAdd={onAdd}
            companyFocusSignal={focus?.target === 'company' ? focus.n : undefined}
            scoreFocusSignal={focus?.target === 'score' ? focus.n : undefined}
          />
        </aside>
      </div>
      <OnCallPanel />
    </CallingProvider>
  );
}

/** How many things a tab holds, for the small badge beside its name; only Activity, Deals and Files have one. */
export type TabCounts = Partial<Record<SectionId, number>>;

/**
 * The counts of the tab bar. Activity counts what is waiting (open tasks and meetings still to come), Deals the contact's deals and
 * Files the files on record. They are the lists the sections read, so a count costs no request the page would not make anyway; what
 * a person may not open is not asked for.
 */
export function useTabCounts(contactId: string): TabCounts {
  const { permissions } = useSession();
  const has = (p: string) => p in permissions;
  const meetings = useContactMeetings(contactId, sectionAllowed('meetings', has));
  const files = useContactFiles(contactId, sectionAllowed('files', has));
  const deals = useContactDeals(contactId, sectionAllowed('deals', has));
  const tasks = useTasksList(
    { kind: 'contact', id: contactId },
    { status: 'open' },
    { limit: 50, enabled: sectionAllowed('tasks', has) },
  );
  const now = useNow().getTime();
  const waiting =
    tasks.items.length +
    meetings.items.filter((m) => m.startsAt && Date.parse(m.startsAt) > now).length;
  return {
    activities: waiting,
    files: files.items.length,
    ...(deals.isSuccess ? { deals: deals.data.deals.length } : {}),
  };
}

const tabClass = (on: boolean) =>
  cn(
    'relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
    on
      ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand'
      : 'text-muted-foreground hover:text-foreground',
  );

/**
 * The page's tab bar: Overview, Activity, Conversations, Deals, Files and a "More" menu with the rest; every section keeps its own
 * URL. It scrolls sideways (without a scroll bar) on a phone and stays at the top of the middle column.
 */
export function ContactTabs({
  contactId,
  current,
  tabs,
  counts,
}: {
  contactId: string;
  current: SectionId;
  tabs: { primary: readonly SectionId[]; more: readonly SectionId[] };
  counts?: TabCounts;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.nav');
  const router = useRouter();
  const inMore = tabs.more.includes(current);
  return (
    <div className="sticky top-0 z-10 flex shrink-0 items-center border-b border-border bg-background">
      <nav
        aria-label={t('label')}
        className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.primary.map((s) => {
          const n = counts?.[s];
          return (
            <Link
              key={s}
              href={sectionHref(contactId, s)}
              aria-current={current === s ? 'page' : undefined}
              className={tabClass(current === s)}
            >
              {t(`section.${s}`)}
              {n !== undefined && n > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {tabs.more.length > 0 && (
        <div className="shrink-0">
          <Menu
            label={t('moreLabel')}
            align="end"
            placement="fixed"
            triggerClassName={cn(
              'h-11 gap-1 rounded-none border-0 bg-transparent px-3 text-sm font-medium shadow-none hover:bg-transparent',
              inMore ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            triggerProps={{ 'aria-label': t('moreLabel') }}
            trigger={
              <>
                {inMore ? t(`section.${current}`) : t('more')}
                <ChevronDownIcon className="size-3.5" />
              </>
            }
          >
            {tabs.more.map((s) => (
              <MenuItem key={s} onSelect={() => router.push(sectionHref(contactId, s))}>
                <span aria-current={current === s ? 'page' : undefined}>{t(`section.${s}`)}</span>
              </MenuItem>
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}
