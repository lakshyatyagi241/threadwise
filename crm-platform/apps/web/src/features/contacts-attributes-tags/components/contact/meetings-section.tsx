'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import type { ContactMeetingResponse } from '@crm/contracts';
import { Button, ConfirmDialog, Input, Select, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  MEETING_KEYS,
  addPendingMeeting,
  useContactMeetings,
  useMeetingMutations,
} from '../../api/meetings';
import { errorKind } from '../../lib/errors';
import {
  DURATIONS,
  asLink,
  draftOf,
  emptyInlineMeeting,
  groupMeetings,
  valuesOf,
  type DurationChoice,
  type InlineMeetingDraft,
  type MeetingGroup,
} from '../../lib/meeting-inline';
import {
  MEETING_LOCATION_MAX,
  MEETING_TITLE_MAX,
  toCreateMeeting,
  toUpdateMeeting,
  validateMeeting,
  type MeetingProblem,
  type MeetingProblems,
} from '../../lib/meeting-time';
import { CalendarIcon, PlusIcon } from '../icons';
import { ErrorLine } from '../error-line';
import type { ContactRow } from '../../api/schemas';
import { EmptyLine, Panel, useRefreshContact } from './shared';

const WHEN = { dateStyle: 'medium', timeStyle: 'short' } as const;

/**
 * The inline meeting row, to schedule a meeting (no `meeting`) or edit one, in the list itself: a title, a start, a duration, and a
 * link or place if there is one. Enter saves, Escape closes the row. It reports back what the person typed (as the request body
 * builders read it), and keeps the row open with the reason when the server refuses, so nothing typed is lost.
 */
export function MeetingRow({
  meeting,
  focusSignal,
  pending,
  failure,
  onSubmit,
  onCancel,
}: {
  meeting?: ContactMeetingResponse;
  focusSignal?: number;
  pending: boolean;
  /** Why the last save failed (shown under the row; the typed values stay). */
  failure: string | null;
  onSubmit: (draft: InlineMeetingDraft) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.meetings');
  const td = useTranslations('contacts-attributes-tags.contact.meetings.dialog');
  const timeZone = useTimeZone();
  const id = useId();
  const title = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<InlineMeetingDraft>(() =>
    meeting ? draftOf(meeting, timeZone) : emptyInlineMeeting(new Date(), timeZone),
  );
  const [tried, setTried] = useState(false);

  useEffect(() => {
    title.current?.focus();
    root.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSignal]);

  const problems = validateMeeting(valuesOf(draft), timeZone);
  // The end-before-start problem shows as soon as it exists; the rest after the first try to save.
  const shown: MeetingProblems = tried
    ? problems
    : problems.endsAt === 'endBeforeStart'
      ? { endsAt: problems.endsAt }
      : {};
  const text = (p: MeetingProblem | undefined) => (p ? td(`problem.${p}`) : undefined);
  const set = (patch: Partial<InlineMeetingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setTried(true);
    if (Object.keys(problems).length > 0) {
      if (problems.title) title.current?.focus();
      return;
    }
    onSubmit(draft);
  };

  return (
    <form
      ref={root}
      aria-label={meeting ? t('editRowLabel') : t('rowLabel')}
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => {
        // Escape closes the row only; it must not also close the drawer around it.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="space-y-2 rounded-md border border-primary/40 bg-background p-3 ring-1 ring-primary/20"
    >
      <div>
        <label htmlFor={`${id}-title`} className="sr-only">
          {td('title')}
        </label>
        <Input
          ref={title}
          id={`${id}-title`}
          autoFocus
          value={draft.title}
          maxLength={MEETING_TITLE_MAX}
          dir="auto"
          placeholder={td('titlePlaceholder')}
          invalid={!!shown.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        {shown.title && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {text(shown.title)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="datetime-local"
          aria-label={td('startsAt')}
          value={draft.startsAt}
          invalid={!!shown.startsAt}
          onChange={(e) => set({ startsAt: e.target.value })}
          className="w-auto min-w-44 flex-1"
        />
        <Select
          aria-label={t('duration')}
          value={draft.duration}
          onChange={(e) => set({ duration: e.target.value as DurationChoice })}
          className="w-auto min-w-32 flex-1"
        >
          {DURATIONS.map((m) => (
            <option key={m} value={String(m)}>
              {t('minutes', { minutes: m })}
            </option>
          ))}
          <option value="none">{t('noEnd')}</option>
          <option value="custom">{t('customEnd')}</option>
        </Select>
      </div>
      {draft.duration === 'custom' && (
        <Input
          type="datetime-local"
          aria-label={td('endsAt')}
          value={draft.endsAt}
          invalid={!!shown.endsAt}
          onChange={(e) => set({ endsAt: e.target.value })}
        />
      )}
      {(shown.startsAt || shown.endsAt) && (
        <p role="alert" className="text-xs text-danger">
          {text(shown.startsAt ?? shown.endsAt)}
        </p>
      )}
      <div>
        <label htmlFor={`${id}-location`} className="sr-only">
          {td('location')}
        </label>
        <Input
          id={`${id}-location`}
          value={draft.location}
          maxLength={MEETING_LOCATION_MAX}
          dir="auto"
          placeholder={td('locationPlaceholder')}
          invalid={!!shown.location}
          onChange={(e) => set({ location: e.target.value })}
        />
        {shown.location && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {text(shown.location)}
          </p>
        )}
      </div>
      {timeZone && (
        <p className="text-xs text-muted-foreground">{td('zoneHint', { zone: timeZone })}</p>
      )}
      {failure && (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
            {td('cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={pending || draft.title.trim() === ''}>
            {pending && <Spinner />}
            {meeting ? td('saveEdit') : td('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * The contact's meetings: a "Schedule meeting" row that opens into the meeting row in place, then the upcoming ones (soonest first),
 * the past ones and any logged without a time, each with edit and delete for people who may update the contact. A new meeting shows
 * in the list the moment it is saved; if the server refuses it leaves again and the row keeps what was typed. No dialog; only the
 * delete asks to be confirmed.
 */
export function MeetingsPanel({
  contact,
  focusSignal,
}: {
  contact: ContactRow;
  /** Changes whenever something outside (the "Meeting" button, the row's quick add) wants the row open and focused. */
  focusSignal?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.meetings');
  const td = useTranslations('contacts-attributes-tags.contact.meetings.dialog');
  const format = useFormatter();
  const timeZone = useTimeZone();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canUpdate = useCan('record.contacts.update');
  const list = useContactMeetings(contact.id);
  const { create, update, remove } = useMeetingMutations(contact.id);
  const refreshContact = useRefreshContact(contact.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ContactMeetingResponse | null>(null);
  const titleId = useId();

  // Something outside asked for the row (the action bar's "Meeting"): open it.
  const [lastSignal, setLastSignal] = useState<number | undefined>(undefined);
  if (focusSignal !== lastSignal) {
    setLastSignal(focusSignal);
    if (focusSignal && canUpdate) {
      setAdding(true);
      setEditing(null);
    }
  }

  const whenOf = (m: ContactMeetingResponse): string => {
    if (m.startsAt && m.endsAt) {
      return format.dateTimeRange(new Date(m.startsAt), new Date(m.endsAt), WHEN);
    }
    if (m.startsAt) return format.dateTime(new Date(m.startsAt), WHEN);
    if (m.endsAt) return t('endsOnly', { when: format.dateTime(new Date(m.endsAt), WHEN) });
    return t('noTime');
  };

  const failureText = (e: unknown) =>
    errorKind(e) === 'forbidden' ? t('forbidden') : t('failedKept');

  const createFrom = (draft: InlineMeetingDraft) => {
    setFailure(null);
    const input = toCreateMeeting(valuesOf(draft), timeZone);
    const { rollback } = addPendingMeeting(qc, contact.id, input);
    setAdding(false);
    create.mutate(input, {
      onSuccess: () => {
        toast(td('created'));
        void refreshContact();
      },
      onError: (e) => {
        // The meeting leaves the list again and the row comes back with what was typed.
        rollback();
        void qc.invalidateQueries({ queryKey: MEETING_KEYS.list(contact.id) });
        setAdding(true);
        setFailure(failureText(e));
      },
    });
  };

  const updateFrom = (m: ContactMeetingResponse, draft: InlineMeetingDraft) => {
    setFailure(null);
    update.mutate(
      { id: m.id, ...toUpdateMeeting(valuesOf(draft), m.rowVersion, timeZone) },
      {
        onSuccess: () => {
          setEditing(null);
          toast(td('updated'));
          void refreshContact();
        },
        onError: (e) => {
          if (errorKind(e) === 'conflict') {
            // The meetings were reloaded; leave edit mode so the person sees what is there now.
            setEditing(null);
            toast(t('conflict'), 'danger');
          } else setFailure(failureText(e));
        },
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null);
        toast(t('deleted'));
        void refreshContact();
      },
      onError: (e) => {
        setDeleting(null);
        toast(errorKind(e) === 'forbidden' ? t('forbidden') : t('deleteFailed'), 'danger');
      },
    });
  };

  const groups = groupMeetings(list.items, new Date());
  const order: MeetingGroup[] = ['upcoming', 'past', 'undated'];

  const item = (m: ContactMeetingResponse) => {
    if (editing === m.id) {
      return (
        <li key={m.id}>
          <MeetingRow
            meeting={m}
            pending={update.isPending}
            failure={failure}
            onSubmit={(d) => updateFrom(m, d)}
            onCancel={() => {
              setEditing(null);
              setFailure(null);
            }}
          />
        </li>
      );
    }
    const link = asLink(m.location);
    const waiting = m.id.startsWith('pending-');
    return (
      <li
        key={m.id}
        className={`rounded-md border border-border p-3 ${waiting ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p dir="auto" className="break-words text-sm font-medium">
              {m.title}
            </p>
            <p className="text-xs text-muted-foreground">{whenOf(m)}</p>
            {m.location &&
              (link ? (
                <p className="break-all text-xs" dir="ltr">
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('join')}: {m.location}
                  </a>
                </p>
              ) : (
                <p dir="auto" className="break-words text-xs text-muted-foreground">
                  {t('atLocation', { location: m.location })}
                </p>
              ))}
          </div>
          {canUpdate && !waiting && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('editAria', { title: m.title })}
                onClick={() => {
                  setEditing(m.id);
                  setAdding(false);
                  setFailure(null);
                }}
              >
                {t('edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('deleteAria', { title: m.title })}
                onClick={() => setDeleting(m)}
              >
                {t('delete')}
              </Button>
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <Panel
      id={titleId}
      title={
        <>
          {t('title')}
          {list.isSuccess && (
            <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {list.items.length}
              {list.hasNextPage ? '+' : ''}
            </span>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {canUpdate &&
          (adding ? (
            <MeetingRow
              focusSignal={focusSignal}
              pending={create.isPending}
              failure={failure}
              onSubmit={createFrom}
              onCancel={() => {
                setAdding(false);
                setFailure(null);
              }}
            />
          ) : (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => {
                setAdding(true);
                setEditing(null);
                setFailure(null);
              }}
              className="flex h-10 w-full items-center gap-2 rounded-md border border-dashed border-border px-3 text-start text-sm text-muted-foreground outline-none transition hover:border-primary/50 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <PlusIcon className="size-4" />
              <CalendarIcon className="size-4" />
              {t('schedule')}
            </button>
          ))}
        {list.isPending && (
          <div className="flex justify-center py-6">
            <Spinner label={t('loading')} />
          </div>
        )}
        {list.isError && <ErrorLine error={list.error} onRetry={() => void list.refetch()} />}
        {list.isSuccess && list.items.length === 0 && (
          <EmptyLine>{canUpdate ? t('emptyCanAdd') : t('empty')}</EmptyLine>
        )}
        {list.items.length > 0 && (
          <div aria-label={t('listLabel')} role="group" className="space-y-4">
            {order.map((g) =>
              groups[g].length === 0 ? null : (
                <section key={g} className="space-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(g)} · {groups[g].length}
                  </h3>
                  <ul className="space-y-3">{groups[g].map(item)}</ul>
                </section>
              ),
            )}
          </div>
        )}
        {list.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage && <Spinner label={t('loadingMore')} />}
              {t('loadMore')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: deleting?.title ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </Panel>
  );
}
