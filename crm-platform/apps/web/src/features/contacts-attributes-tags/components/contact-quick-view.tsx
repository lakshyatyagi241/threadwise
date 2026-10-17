'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Menu, MenuItem, Spinner, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { fetchContact, KEYS, useContact } from '../api/contacts';
import type { ContactRow } from '../api/schemas';
import { displayName } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import { neighbourKey } from '../lib/quick-view';
import {
  ACTION_SECTION,
  quickTabs,
  sectionHref,
  type AddTarget,
  type FocusRequest,
  type QuickSection,
  type SectionId,
} from '../lib/sections';
import { ContactAvatar } from './chips';
import { ContactActionBar } from './contact/action-bar';
import { CallNudge } from './contact/call-nudge';
import { JobTitle, SocialIcons } from './contact/parts';
import { ContactSection } from './contact/sections';
import { useStageChange } from './contact/use-stage-change';
import { ErrorLine } from './error-line';
import { useContactNotes } from '../api/notes';
import { useContactMeetings } from '../api/meetings';
import { useTasksList } from '@/features/tasks/api/hooks';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from './icons';
import { StagePicker } from './stage-picker';

const iconBtn =
  'inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

export interface QuickViewProps {
  /** The contact to show; empty keeps the drawer shut. */
  contactId: string;
  panel: SectionId;
  /** Puts the cursor in an inline composer of the section that is open (the row's quick add, the action bar's Note, Task, Meeting, Add company). */
  focus: FocusRequest | null;
  previousId: string | null;
  nextId: string | null;
  /** "3 of 50": where the contact stands among the loaded rows, when it is among them. */
  position: { index: number; total: number } | null;
  onNavigate: (id: string) => void;
  onPanel: (section: SectionId, opts?: { focus?: AddTarget; clickedAt?: number }) => void;
  onClose: () => void;
}

/**
 * The quick view: a right-hand drawer (about 60% of the window) over the contacts list, which stays visible and dimmed behind it.
 * Header (avatar, name, social links, job title, lifecycle stage, previous and next contact, "See all details", close), the action
 * bar (Note, Task, Meeting and Add company are shortcuts to the inline composers, never dialogs), a tab strip (Overview, Activity,
 * Notes, Tasks, Meetings, Files and a "+N more" menu with the rest, counts as small badges) and the section itself. It is controlled by the URL (`?contact=` and `&panel=`): the
 * page owns that, this component only asks for changes. Escape or a click on the dimmed list closes it; the arrow keys (or the two
 * arrow buttons) walk the contacts of the loaded page.
 */
export function ContactQuickView(p: QuickViewProps) {
  const t = useTranslations('contacts-attributes-tags.contact.quick');
  const locale = useLocale();
  const qc = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const open = p.contactId !== '';
  const contact = useContact(p.contactId, open);
  const rtl = ['ar', 'he', 'ur', 'fa'].includes(locale.split('-')[0]!);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // The arrow keys walk the contacts of the loaded page. The listener is on the document, not on the drawer: when the focused control
  // is replaced (the loading header gives way to the contact) the browser leaves the focus on <body>, where the drawer sees no key.
  const { previousId, nextId, onNavigate } = p;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // A dialog opened from the drawer (edit, task, meeting, send) keeps its own keys.
      const owner = target?.closest?.('dialog');
      if (owner && owner !== ref.current) return;
      const move = neighbourKey(e, target, rtl);
      const to = move === 'previous' ? previousId : move === 'next' ? nextId : null;
      if (to) {
        e.preventDefault();
        onNavigate(to);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, previousId, nextId, onNavigate, rtl]);

  // Once the contact is on screen the focus goes into the drawer (the control that had it may be gone).
  const loaded = contact.isSuccess ? contact.data.id : '';
  useEffect(() => {
    const el = ref.current;
    if (open && loaded && el && !el.contains(document.activeElement)) el.focus();
  }, [open, loaded]);

  // The neighbours are fetched ahead, so the arrow keys land on a contact that is already there.
  useEffect(() => {
    if (!open) return;
    for (const id of [previousId, nextId]) {
      if (id)
        void qc.prefetchQuery({
          queryKey: KEYS.contact(id),
          queryFn: ({ signal }) => fetchContact(id, signal),
          staleTime: 30_000,
        });
    }
  }, [open, previousId, nextId, qc]);

  return (
    <dialog
      ref={ref}
      aria-label={t('title')}
      // React lets a nested dialog's `close` event reach this handler too (the meeting, task or edit dialog opened from the action bar):
      // only the drawer's own close closes the drawer.
      onClose={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) p.onClose();
      }}
      tabIndex={-1}
      className="crm-drawer fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-none w-[min(72rem,100vw)] max-w-none overflow-hidden outline-none border-s border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40 lg:w-[60vw]"
    >
      {open &&
        (contact.isSuccess ? (
          <QuickViewBody key={contact.data.id} contact={contact.data} {...p} />
        ) : (
          <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <p className="text-sm text-muted-foreground" role="status">
                {contact.isError ? t('notFoundTitle') : t('loading')}
              </p>
              <button type="button" className={iconBtn} onClick={p.onClose} aria-label={t('close')}>
                <XIcon />
              </button>
            </header>
            <div className="flex-1 p-5">
              {contact.isPending ? (
                <div role="status" className="flex items-center gap-2 text-muted-foreground">
                  <Spinner /> {t('loading')}
                </div>
              ) : contact.isError && errorKind(contact.error) === 'unavailable' ? (
                <p className="text-sm text-muted-foreground">{t('notFound')}</p>
              ) : contact.isError ? (
                <ErrorLine error={contact.error} onRetry={() => void contact.refetch()} />
              ) : null}
            </div>
          </div>
        ))}
    </dialog>
  );
}

function QuickViewBody({
  contact,
  panel,
  focus,
  previousId,
  nextId,
  position,
  onNavigate,
  onPanel,
  onClose,
}: QuickViewProps & { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.quick');
  const tl = useTranslations('contacts-attributes-tags.list');
  const router = useRouter();
  const session = useSession();
  const canUpdate = useCan('record.contacts.update');
  const stage = useStageChange(contact);
  const body = useRef<HTMLDivElement>(null);

  const tabs = useMemo(
    () => quickTabs((permission) => permission in session.permissions),
    [session.permissions],
  );
  const shown: QuickSection[] = [...tabs.primary, ...tabs.more];
  const current: SectionId = (shown as SectionId[]).includes(panel) ? panel : 'overview';
  const name = displayName(contact) || tl('unnamed');

  // A new section starts at the top of the scrolling body.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [current]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-start gap-3 sm:gap-4">
          <ContactAvatar id={contact.id} name={name} size="lg" className="sm:size-16 sm:text-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="min-w-0 truncate text-xl font-semibold leading-tight" dir="auto">
                {name}
              </h2>
              <SocialIcons contact={contact} />
            </div>
            <div className="mt-0.5 min-w-0">
              <JobTitle contact={contact} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {contact.lifecycleStage && (
                <StagePicker
                  value={contact.lifecycleStage}
                  status={contact.status}
                  stages={stage.stages}
                  statusesOf={stage.statusesOf}
                  defaultStatusOf={stage.defaultStatusOf}
                  hint={stage.hint}
                  name={name}
                  busy={stage.busy}
                  readOnly={!canUpdate}
                  onPick={(s, status) => stage.changeStage(s, status)}
                />
              )}
              {contact.status && (
                <span className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  {stage.statusLabel(contact.status)}
                </span>
              )}
              {position && (
                <span className="ms-auto text-xs text-muted-foreground tabular-nums">
                  {t('position', { index: position.index + 1, total: position.total })}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href={`/contacts/${contact.id}`}
              className="hidden h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex"
            >
              <ExternalLinkIcon className="size-4" />
              {t('seeAll')}
            </Link>
            <button
              type="button"
              className={iconBtn}
              disabled={!previousId}
              onClick={() => previousId && onNavigate(previousId)}
              aria-label={t('previous')}
              title={t('previous')}
            >
              <ChevronLeftIcon className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              className={iconBtn}
              disabled={!nextId}
              onClick={() => nextId && onNavigate(nextId)}
              aria-label={t('next')}
              title={t('next')}
            >
              <ChevronRightIcon className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              className={iconBtn}
              onClick={onClose}
              aria-label={t('close')}
              title={t('close')}
            >
              <XIcon />
            </button>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-border px-4 py-2.5 sm:px-5">
        <ContactActionBar
          contact={contact}
          // Note, Task, Call, Meeting and Add company stay in the drawer: the tab that holds the composer opens with the cursor in it.
          onAdd={(target) => onPanel(ACTION_SECTION[target], { focus: target })}
          onDeleted={onClose}
        />
      </div>
      <CallNudge
        className="mx-3 mt-2 sm:mx-5"
        contactId={contact.id}
        name={name}
        onLog={(clickedAt) => onPanel('activities', { focus: 'call', clickedAt })}
      />

      <QuickTabs
        contactId={contact.id}
        tabs={tabs}
        current={current}
        onSelect={(section) => onPanel(section)}
      />
      <div
        ref={body}
        role="tabpanel"
        id={`qv-panel-${contact.id}`}
        aria-labelledby={`qv-tab-${current}`}
        tabIndex={-1}
        className="thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/30 p-3 outline-none sm:p-4"
      >
        {current !== 'overview' && (
          <div className="mb-3 flex items-center justify-end gap-2">
            <Link
              href={sectionHref(contact.id, current)}
              className="text-xs font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('openFull')}
            </Link>
          </div>
        )}
        <ContactSection
          section={current}
          contact={contact}
          variant="drawer"
          focus={focus}
          onAdd={(target) => onPanel(ACTION_SECTION[target], { focus: target })}
          onOpenSection={(s) => {
            if ((shown as SectionId[]).includes(s)) onPanel(s);
            else router.push(sectionHref(contact.id, s));
          }}
        />
      </div>
      {stage.dialog}
    </div>
  );
}

/** A small count beside a tab's name; nothing while it is loading or zero. */
function Count({ n, more }: { n: number; more?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className="ms-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground">
      {n}
      {more ? '+' : ''}
    </span>
  );
}

function NotesCount({ contactId }: { contactId: string }) {
  const list = useContactNotes(contactId);
  return <Count n={list.isSuccess ? list.items.length : 0} more={list.hasNextPage} />;
}

function MeetingsCount({ contactId }: { contactId: string }) {
  const list = useContactMeetings(contactId);
  return <Count n={list.isSuccess ? list.items.length : 0} more={list.hasNextPage} />;
}

/** Open tasks of the contact: the same query the Tasks tab lists, so the badge costs no extra request once it is open. */
function TasksCount({ contactId }: { contactId: string }) {
  const open = useTasksList({ kind: 'contact', id: contactId }, { status: 'open' }, { limit: 50 });
  return <Count n={open.isSuccess ? open.items.length : 0} more={open.hasNextPage} />;
}

/**
 * The drawer's tab strip: the sections people work in as tabs (arrow keys, Home and End move between them), then a menu for the
 * rest. On a narrow screen the strip scrolls sideways instead of wrapping.
 */
export function QuickTabs({
  contactId,
  tabs,
  current,
  onSelect,
}: {
  contactId: string;
  tabs: { primary: QuickSection[]; more: QuickSection[] };
  current: SectionId;
  onSelect: (section: QuickSection) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.quick');
  const list = useRef<HTMLDivElement>(null);
  const inMore = (tabs.more as SectionId[]).includes(current);

  // On a narrow screen the strip scrolls: keep the open tab in view.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const rtl = getComputedStyle(list.current!).direction === 'rtl';
    const step =
      e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (at + step + buttons.length) % buttons.length;
    e.preventDefault();
    e.stopPropagation();
    buttons[to]?.focus();
    buttons[to]?.click();
  };

  const tab = (s: QuickSection) => {
    const active = current === s;
    return (
      <button
        key={s}
        type="button"
        role="tab"
        id={`qv-tab-${s}`}
        aria-selected={active}
        aria-controls={`qv-panel-${contactId}`}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(s)}
        className={cn(
          'relative inline-flex h-10 shrink-0 items-center whitespace-nowrap px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
          active
            ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {t(`tab_${s}`)}
        {s === 'notes' && <NotesCount contactId={contactId} />}
        {s === 'tasks' && <TasksCount contactId={contactId} />}
        {s === 'meetings' && <MeetingsCount contactId={contactId} />}
      </button>
    );
  };

  return (
    <div className="flex shrink-0 items-center border-b border-border px-1 sm:px-2">
      <div
        ref={list}
        role="tablist"
        aria-label={t('rail')}
        onKeyDown={onKey}
        className="thin-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto"
      >
        {tabs.primary.map(tab)}
      </div>
      {tabs.more.length > 0 && (
        <div className="shrink-0">
          <Menu
            label={t('moreTabs')}
            align="end"
            placement="fixed"
            triggerClassName={cn(
              'h-10 shrink-0 gap-1 rounded-none border-0 bg-transparent px-3 text-sm font-medium shadow-none hover:bg-transparent',
              inMore ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            triggerProps={{ 'aria-label': t('moreTabs') }}
            trigger={
              <>
                {inMore
                  ? t(`tab_${current as QuickSection}`)
                  : t('more', { count: tabs.more.length })}
                <ChevronDownIcon className="size-3.5" />
              </>
            }
          >
            {tabs.more.map((s) => (
              <MenuItem key={s} onSelect={() => onSelect(s)}>
                {t(`tab_${s}`)}
              </MenuItem>
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}
