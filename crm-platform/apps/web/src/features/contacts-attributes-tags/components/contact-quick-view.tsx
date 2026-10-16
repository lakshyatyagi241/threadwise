'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { fetchContact, KEYS, useContact } from '../api/contacts';
import type { ContactRow } from '../api/schemas';
import { displayName } from '../lib/contact-model';
import { errorKind } from '../lib/errors';
import { neighbourKey } from '../lib/quick-view';
import { railSections, sectionHref, type RailSection, type SectionId } from '../lib/sections';
import { ContactAvatar } from './chips';
import { ContactActionBar } from './contact/action-bar';
import { JobTitle, SocialIcons } from './contact/parts';
import { ContactSection } from './contact/sections';
import { useStageChange } from './contact/use-stage-change';
import { ErrorLine } from './error-line';
import {
  ChatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  FileIcon,
  HistoryIcon,
  NoteIcon,
  SettingsIcon,
  UserIcon,
  XIcon,
} from './icons';
import { StageMenu } from './stage-menu';

const RAIL_ICON: Record<RailSection, typeof NoteIcon> = {
  overview: UserIcon,
  activities: HistoryIcon,
  conversations: ChatIcon,
  notes: NoteIcon,
  stats: ClockIcon,
  files: FileIcon,
  details: SettingsIcon,
};

const iconBtn =
  'inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';

export interface QuickViewProps {
  /** The contact to show; empty keeps the drawer shut. */
  contactId: string;
  panel: SectionId;
  /** Open Notes with the cursor in the composer (the row's note icon, the "Note" button). */
  composer: boolean;
  previousId: string | null;
  nextId: string | null;
  /** "3 of 50": where the contact stands among the loaded rows, when it is among them. */
  position: { index: number; total: number } | null;
  onNavigate: (id: string) => void;
  onPanel: (section: SectionId, opts?: { composer?: boolean }) => void;
  onClose: () => void;
}

/**
 * The quick view: a right-hand drawer (about 60% of the window) over the contacts list, which stays visible and dimmed behind it.
 * Header (avatar, name, social links, job title, lifecycle stage, previous and next contact, "See all details", close), the action
 * bar, an icon rail of the contact's sections and the section itself. It is controlled by the URL (`?contact=` and `&panel=`): the
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

  // The neighbours are fetched ahead, so the arrow keys land on a contact that is already there.
  const { previousId, nextId } = p;
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
      onClose={p.onClose}
      onClick={(e) => {
        if (e.target === ref.current) p.onClose();
      }}
      onKeyDown={(e) => {
        // Only keys pressed in the drawer itself: a dialog opened from it (edit, task, meeting) keeps its own keys.
        if ((e.target as HTMLElement).closest('dialog') !== ref.current) return;
        const move = neighbourKey(e, e.target as HTMLElement, rtl);
        const to = move === 'previous' ? previousId : move === 'next' ? nextId : null;
        if (to) {
          e.preventDefault();
          p.onNavigate(to);
        }
      }}
      className="crm-drawer fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-none w-[min(72rem,100vw)] max-w-none overflow-hidden border-s border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40 lg:w-[60vw]"
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
  composer,
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

  const rail = useMemo(
    () => railSections((permission) => permission in session.permissions),
    [session.permissions],
  );
  const current: SectionId = (rail as SectionId[]).includes(panel) ? panel : 'overview';
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
                <StageMenu
                  value={contact.lifecycleStage}
                  choices={stage.stages}
                  name={name}
                  busy={stage.busy}
                  statusHint={stage.hint}
                  onChange={canUpdate ? stage.changeStage : undefined}
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
          onOpenSection={(s, opts) => {
            // Note, Task and Meeting stay in the drawer; a section the rail has not got lives on the details page.
            if ((rail as SectionId[]).includes(s)) onPanel(s, opts);
            else router.push(sectionHref(contact.id, s));
          }}
          onDeleted={onClose}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('rail')}
          className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-e border-border py-3"
        >
          {rail.map((s) => {
            const Icon = RAIL_ICON[s];
            const active = current === s;
            return (
              <button
                key={s}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={t(`rail_${s}`)}
                title={t(`rail_${s}`)}
                onClick={() => onPanel(s)}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                  active
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-[18px]" />
              </button>
            );
          })}
        </nav>
        <div
          ref={body}
          className="thin-scrollbar min-w-0 flex-1 overflow-y-auto bg-muted/30 p-3 sm:p-4"
        >
          {current !== 'overview' && (
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(`rail_${current as RailSection}`)}</h3>
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
            composer={composer}
            onOpenSection={(s) => {
              if ((rail as SectionId[]).includes(s)) onPanel(s);
              else router.push(sectionHref(contact.id, s));
            }}
          />
        </div>
      </div>
      {stage.dialog}
    </div>
  );
}
