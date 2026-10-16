'use client';

import { useId, useState, type FormEvent } from 'react';
import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import type { ContactMeetingResponse } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Field, Input, Modal, Spinner, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useContactMeetings, useMeetingMutations } from '../../api/meetings';
import { errorKind } from '../../lib/errors';
import {
  EMPTY_MEETING,
  MEETING_LOCATION_MAX,
  MEETING_TITLE_MAX,
  isoToZonedLocal,
  toCreateMeeting,
  toUpdateMeeting,
  validateMeeting,
  type MeetingFormValues,
  type MeetingProblem,
  type MeetingProblems,
} from '../../lib/meeting-time';
import { ErrorLine } from '../error-line';
import type { ContactRow } from '../../api/schemas';
import { EmptyLine, Panel, useRefreshContact } from './shared';

const WHEN = { dateStyle: 'medium', timeStyle: 'short' } as const;

const toForm = (m: ContactMeetingResponse | undefined, timeZone?: string): MeetingFormValues =>
  m
    ? {
        title: m.title,
        startsAt: isoToZonedLocal(m.startsAt, timeZone),
        endsAt: isoToZonedLocal(m.endsAt, timeZone),
        location: m.location ?? '',
      }
    : EMPTY_MEETING;

/**
 * Log a meeting (no `meeting`) or edit one, in a dialog. The quick view's "Meeting" action opens it directly to create;
 * `MeetingsPanel` opens it for both. The form starts from the meeting's saved state every time the dialog opens.
 */
export function MeetingDialog({
  open,
  contactId,
  meeting,
  onClose,
}: {
  open: boolean;
  contactId: string;
  meeting?: ContactMeetingResponse;
  onClose: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.meetings.dialog');
  const tm = useTranslations('contacts-attributes-tags.contact.meetings');
  const timeZone = useTimeZone();
  const { toast } = useToast();
  const { create, update } = useMeetingMutations(contactId);
  const refreshContact = useRefreshContact(contactId);
  const formId = useId();
  const [values, setValues] = useState<MeetingFormValues>(() => toForm(meeting, timeZone));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Each time the dialog opens it starts again from the saved meeting (or empty), not from what was typed before.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValues(toForm(meeting, timeZone));
      setTried(false);
      setError(null);
    }
  }

  const pending = create.isPending || update.isPending;
  const problems = validateMeeting(values, timeZone);
  // The end-before-start problem shows as soon as it exists; the rest after the first try to save.
  const shown: MeetingProblems = tried
    ? problems
    : problems.endsAt === 'endBeforeStart'
      ? { endsAt: problems.endsAt }
      : {};

  const text = (p: MeetingProblem | undefined) => {
    switch (p) {
      case 'titleRequired':
        return t('problem.titleRequired');
      case 'titleTooLong':
        return t('problem.titleTooLong');
      case 'locationTooLong':
        return t('problem.locationTooLong');
      case 'startInvalid':
        return t('problem.startInvalid');
      case 'endInvalid':
        return t('problem.endInvalid');
      case 'endBeforeStart':
        return t('problem.endBeforeStart');
      default:
        return undefined;
    }
  };

  const set = (patch: Partial<MeetingFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setTried(true);
    if (Object.keys(problems).length > 0) return;
    setError(null);
    const done = (message: string) => {
      toast(message);
      void refreshContact();
      onClose();
    };
    const fail = (err: unknown) => {
      const kind = errorKind(err);
      if (kind === 'conflict') {
        // The meetings were reloaded; close so the person sees what is there now, then edits again if they still want to.
        toast(tm('conflict'), 'danger');
        onClose();
      } else {
        setError(kind === 'forbidden' ? tm('forbidden') : tm('failed'));
      }
    };
    if (meeting) {
      update.mutate(
        { id: meeting.id, ...toUpdateMeeting(values, meeting.rowVersion, timeZone) },
        { onSuccess: () => done(t('updated')), onError: fail },
      );
    } else {
      create.mutate(toCreateMeeting(values, timeZone), {
        onSuccess: () => done(t('created')),
        onError: fail,
      });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={meeting ? t('editTitle') : t('logTitle')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending && <Spinner />}
            {meeting ? t('saveEdit') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('title')} htmlFor={`${formId}-title`} error={text(shown.title)}>
          <Input
            id={`${formId}-title`}
            value={values.title}
            maxLength={MEETING_TITLE_MAX}
            dir="auto"
            placeholder={t('titlePlaceholder')}
            invalid={!!shown.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('startsAt')} htmlFor={`${formId}-starts`} error={text(shown.startsAt)}>
            <Input
              id={`${formId}-starts`}
              type="datetime-local"
              value={values.startsAt}
              invalid={!!shown.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
            />
          </Field>
          <Field label={t('endsAt')} htmlFor={`${formId}-ends`} error={text(shown.endsAt)}>
            <Input
              id={`${formId}-ends`}
              type="datetime-local"
              value={values.endsAt}
              invalid={!!shown.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </Field>
        </div>
        {timeZone && (
          <p className="-mt-2 text-xs text-muted-foreground">{t('zoneHint', { zone: timeZone })}</p>
        )}
        <Field label={t('location')} htmlFor={`${formId}-location`} error={text(shown.location)}>
          <Input
            id={`${formId}-location`}
            value={values.location}
            maxLength={MEETING_LOCATION_MAX}
            dir="auto"
            placeholder={t('locationPlaceholder')}
            invalid={!!shown.location}
            onChange={(e) => set({ location: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}

/** The contact's meetings, with "Log meeting" and edit / delete for people who may update the contact. */
export function MeetingsPanel({ contact }: { contact: ContactRow }) {
  const t = useTranslations('contacts-attributes-tags.contact.meetings');
  const format = useFormatter();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const list = useContactMeetings(contact.id);
  const { remove } = useMeetingMutations(contact.id);
  const refreshContact = useRefreshContact(contact.id);
  const [dialog, setDialog] = useState<{ open: boolean; meeting?: ContactMeetingResponse }>({
    open: false,
  });
  const [deleting, setDeleting] = useState<ContactMeetingResponse | null>(null);
  const titleId = useId();

  const whenOf = (m: ContactMeetingResponse): string => {
    if (m.startsAt && m.endsAt) {
      return format.dateTimeRange(new Date(m.startsAt), new Date(m.endsAt), WHEN);
    }
    if (m.startsAt) return format.dateTime(new Date(m.startsAt), WHEN);
    if (m.endsAt) return t('endsOnly', { when: format.dateTime(new Date(m.endsAt), WHEN) });
    return t('noTime');
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

  return (
    <Panel
      id={titleId}
      title={t('title')}
      action={
        canUpdate ? (
          <Button size="sm" onClick={() => setDialog({ open: true })}>
            {t('log')}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
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
          <ul aria-label={t('listLabel')} className="space-y-3">
            {list.items.map((m) => (
              <li key={m.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p dir="auto" className="break-words text-sm font-medium">
                      {m.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{whenOf(m)}</p>
                    {m.location && (
                      <p dir="auto" className="break-words text-xs text-muted-foreground">
                        {t('atLocation', { location: m.location })}
                      </p>
                    )}
                  </div>
                  {canUpdate && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('editAria', { title: m.title })}
                        onClick={() => setDialog({ open: true, meeting: m })}
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
            ))}
          </ul>
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

      {canUpdate && (
        <MeetingDialog
          open={dialog.open}
          contactId={contact.id}
          meeting={dialog.meeting}
          onClose={() => setDialog((d) => ({ ...d, open: false }))}
        />
      )}
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
