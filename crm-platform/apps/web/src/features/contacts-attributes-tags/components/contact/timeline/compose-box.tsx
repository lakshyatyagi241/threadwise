'use client';

import { useRef, useState } from 'react';
import { useTimeZone, useTranslations } from 'next-intl';
import { useToast, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { usePersonaVisibility } from '@/features/persona';
import { InlineTaskAdd } from '@/features/tasks';
import { useCanLogCall } from '../../../api/call-log';
import { useMeetingMutations } from '../../../api/meetings';
import { useNoteMutations } from '../../../api/notes';
import type { ContactRow } from '../../../api/schemas';
import { displayName } from '../../../lib/contact-model';
import { errorKind } from '../../../lib/errors';
import { valuesOf, type InlineMeetingDraft } from '../../../lib/meeting-inline';
import { toCreateMeeting } from '../../../lib/meeting-time';
import { sectionAllowed, SECTION_OF_TARGET, type FocusRequest } from '../../../lib/sections';
import { CalendarIcon, CheckIcon, NoteIcon, PhoneIcon } from '../../icons';
import { MeetingRow } from '../meetings-section';
import { NoteComposer } from '../notes-section';
import { useRefreshContact } from '../shared';
import { LogCallForm } from './log-call-form';

export type ComposeTab = 'note' | 'task' | 'call' | 'meeting';

const ICON: Record<ComposeTab, typeof NoteIcon> = {
  note: NoteIcon,
  task: CheckIcon,
  call: PhoneIcon,
  meeting: CalendarIcon,
};

/** A note, saved in place (the Notes section's composer, the same endpoint). */
function NoteTab({ contact, focusSignal }: { contact: ContactRow; focusSignal?: number }) {
  const t = useTranslations('contacts-attributes-tags.contact.notes');
  const { toast } = useToast();
  const { create } = useNoteMutations(contact.id);
  const refresh = useRefreshContact(contact.id);
  return (
    <NoteComposer
      focusSignal={focusSignal}
      pending={create.isPending}
      onSave={(body, done) =>
        create.mutate(
          { body },
          {
            onSuccess: () => {
              done();
              toast(t('saved'));
              void refresh();
            },
            onError: (e) =>
              toast(
                errorKind(e) === 'forbidden'
                  ? t('forbidden')
                  : errorKind(e) === 'conflict'
                    ? t('conflict')
                    : t('failed'),
                'danger',
              ),
          },
        )
      }
    />
  );
}

/** A meeting, scheduled in place (the Meetings section's row, the same endpoint). */
function MeetingTab({ contact, focusSignal }: { contact: ContactRow; focusSignal?: number }) {
  const t = useTranslations('contacts-attributes-tags.contact.meetings');
  const td = useTranslations('contacts-attributes-tags.contact.meetings.dialog');
  const { toast } = useToast();
  const timeZone = useTimeZone();
  const { create } = useMeetingMutations(contact.id);
  const refresh = useRefreshContact(contact.id);
  const [fresh, setFresh] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (draft: InlineMeetingDraft) => {
    setFailure(null);
    create.mutate(toCreateMeeting(valuesOf(draft), timeZone), {
      onSuccess: () => {
        toast(td('created'));
        void refresh();
        // A new, empty row for the next one.
        setFresh((n) => n + 1);
      },
      onError: (e) => setFailure(errorKind(e) === 'forbidden' ? t('forbidden') : t('failedKept')),
    });
  };
  return (
    <MeetingRow
      key={fresh}
      focusSignal={focusSignal}
      pending={create.isPending}
      failure={failure}
      onSubmit={submit}
      onCancel={() => setFresh((n) => n + 1)}
    />
  );
}

/** The tabs of the compose box this person may use, in the order they are drawn. */
export function useComposeTabs(): ComposeTab[] {
  const canUpdate = useCan('record.contacts.update');
  const canTask = useCan('record.tasks.create');
  const canLogCall = useCanLogCall();
  const { permissions } = useSession();
  const tasksOpen = sectionAllowed(SECTION_OF_TARGET.task, (p) => p in permissions);
  // A button the workspace's persona hides (`action:contact.<id>`) is not offered here either; the endpoints stay open.
  const { isActionHidden } = usePersonaVisibility();
  return [
    ...(canUpdate && !isActionHidden('note') ? (['note'] as const) : []),
    ...(canTask && tasksOpen && !isActionHidden('task') ? (['task'] as const) : []),
    ...(canLogCall && !isActionHidden('call') ? (['call'] as const) : []),
    ...(canUpdate && !isActionHidden('meeting') ? (['meeting'] as const) : []),
  ];
}

/**
 * The compose box at the top of the Activity tab: Note, Task, Call and Meeting as tabs, each a small inline form (no dialog) that uses
 * the same endpoints as the Notes, Tasks and Meetings sections, so what is added here shows in those lists and on the timeline under
 * the box. A tab is drawn only where the person may do it; with none the box is left out. `focus` is a request from outside (the
 * action bar's Note, Task, Call, Meeting buttons) to open that tab with the cursor in it.
 */
export function ComposeBox({
  contact,
  focus,
}: {
  contact: ContactRow;
  focus?: FocusRequest | null;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.compose');
  const name = displayName(contact);
  const tabs = useComposeTabs();
  const [active, setActive] = useState<ComposeTab | null>(null);
  // Each time a tab is chosen, or asked for from outside, its form gets a new signal to take the cursor.
  const [signals, setSignals] = useState<Record<ComposeTab, number>>({
    note: 0,
    task: 0,
    call: 0,
    meeting: 0,
  });
  const [clickedAt, setClickedAt] = useState<number | undefined>(undefined);
  const bump = (tab: ComposeTab) => setSignals((s) => ({ ...s, [tab]: s[tab] + 1 }));
  const list = useRef<HTMLDivElement>(null);

  // A request is a new object each time (the same tab asked for twice still takes the cursor).
  const [seen, setSeen] = useState<FocusRequest | null>(null);
  if (focus && focus !== seen) {
    setSeen(focus);
    const wanted = focus.target;
    if (wanted !== 'company' && (tabs as string[]).includes(wanted)) {
      setActive(wanted as ComposeTab);
      bump(wanted as ComposeTab);
      setClickedAt(wanted === 'call' ? focus.clickedAt : undefined);
    }
  }

  const current: ComposeTab | null = active && tabs.includes(active) ? active : (tabs[0] ?? null);
  if (!current) return null;

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowLeft'
          ? -1
          : e.key === 'Home' || e.key === 'End'
            ? 0
            : null;
    if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const at = tabs.indexOf(current);
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (at + (rtl ? -step : step) + tabs.length) % tabs.length;
    e.preventDefault();
    const next = tabs[to]!;
    setActive(next);
    // Arrow keys walk the tabs: the person stays on the tab strip (a form opened by the choice would take the cursor, so the
    // focus is given back to the tab once the form has been drawn). Clicking a tab is what puts the cursor in its form.
    const back = () => list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
    window.requestAnimationFrame(() => window.requestAnimationFrame(back));
  };

  return (
    <section
      aria-label={t('label')}
      className="rounded-xl border border-border bg-background"
      data-testid="compose-box"
    >
      <div
        ref={list}
        role="tablist"
        aria-label={t('tabs')}
        onKeyDown={onKey}
        className="flex items-center gap-1 border-b border-border px-2"
      >
        {tabs.map((tab) => {
          const Icon = ICON[tab];
          const on = tab === current;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`compose-tab-${tab}`}
              aria-selected={on}
              aria-controls="compose-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => {
                setActive(tab);
                bump(tab);
              }}
              className={cn(
                'relative inline-flex h-10 items-center gap-1.5 px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                on
                  ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {t(`tab.${tab}`)}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="compose-panel"
        aria-labelledby={`compose-tab-${current}`}
        className="p-3"
      >
        {current === 'note' && <NoteTab contact={contact} focusSignal={signals.note} />}
        {current === 'task' && (
          <InlineTaskAdd
            source={{ kind: 'contact', id: contact.id }}
            label={name}
            focusSignal={signals.task || undefined}
          />
        )}
        {current === 'call' && (
          <LogCallForm contact={contact} focusSignal={signals.call} clickedAt={clickedAt} />
        )}
        {current === 'meeting' && <MeetingTab contact={contact} focusSignal={signals.meeting} />}
      </div>
    </section>
  );
}
