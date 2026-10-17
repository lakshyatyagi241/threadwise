'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ContactNoteResponse } from '@crm/contracts';
import { Button, ConfirmDialog, Spinner, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { NOTE_BODY_MAX, useContactNotes, useNoteMutations } from '../../api/notes';
import { errorKind } from '../../lib/errors';
import { ErrorLine } from '../error-line';
import { EmptyLine, Panel, useRefreshContact, type SectionProps } from './shared';

/** The counter shows once the note is within this many characters of the limit. */
const COUNTER_FROM = 500;

const isSaveKey = (e: KeyboardEvent<HTMLTextAreaElement>) =>
  e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing;

/**
 * The contact's notes: a composer on top for people who may update the contact, then the notes newest first, each with
 * edit and delete for the same people. Used by the quick view's Notes panel and the details page's Notes section.
 */
export function NotesSection({
  contact,
  variant,
  focusSignal,
}: SectionProps & {
  /** Changes whenever something outside (the "Note" button, the row's quick add) wants the cursor in the composer. */
  focusSignal?: number;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.notes');
  const format = useFormatter();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const list = useContactNotes(contact.id);
  const { create, update, remove } = useNoteMutations(contact.id);
  const refreshContact = useRefreshContact(contact.id);
  const [deleting, setDeleting] = useState<ContactNoteResponse | null>(null);
  const titleId = useId();

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const failure = (e: unknown) => {
    const kind = errorKind(e);
    return kind === 'conflict' ? t('conflict') : kind === 'forbidden' ? t('forbidden') : null;
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
        toast(failure(e) ?? t('deleteFailed'), 'danger');
      },
    });
  };

  return (
    <Panel
      id={titleId}
      title={t('title')}
      bodyClassName={variant === 'drawer' ? 'px-3' : undefined}
    >
      <div className="space-y-4">
        {canUpdate && (
          <Composer
            focusSignal={focusSignal}
            pending={create.isPending}
            onSave={(body, done) =>
              create.mutate(
                { body },
                {
                  onSuccess: () => {
                    done();
                    toast(t('saved'));
                    void refreshContact();
                  },
                  onError: (e) => toast(failure(e) ?? t('failed'), 'danger'),
                },
              )
            }
          />
        )}

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
            {list.items.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                canUpdate={canUpdate}
                when={when}
                saving={update.isPending}
                onDelete={() => setDeleting(note)}
                onSave={(body, done) =>
                  update.mutate(
                    { id: note.id, body, rowVersion: note.rowVersion },
                    {
                      onSuccess: () => {
                        done();
                        toast(t('updated'));
                        void refreshContact();
                      },
                      onError: (e) => {
                        // The notes were reloaded; leave edit mode so the person sees what is there now.
                        if (errorKind(e) === 'conflict') done();
                        toast(failure(e) ?? t('failed'), 'danger');
                      },
                    },
                  )
                }
              />
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

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteTitle')}
        message={t('deleteMessage')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </Panel>
  );
}

function Composer({
  focusSignal,
  pending,
  onSave,
}: {
  focusSignal?: number;
  pending: boolean;
  onSave: (body: string, done: () => void) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.notes');
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;

  // Asked for from outside: the cursor goes in and the composer is brought into view.
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    const el = ref.current;
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusSignal]);

  const empty = draft.trim() === '';
  const left = NOTE_BODY_MAX - draft.length;
  const save = () => {
    if (empty || pending) return;
    onSave(draft.trim(), () => setDraft(''));
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        {t('composerLabel')}
      </label>
      <Textarea
        ref={ref}
        id={id}
        rows={3}
        value={draft}
        maxLength={NOTE_BODY_MAX}
        dir="auto"
        placeholder={t('composerPlaceholder')}
        aria-describedby={hintId}
        readOnly={pending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isSaveKey(e)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
          {left <= COUNTER_FROM ? t('charsLeft', { count: left }) : t('composerHint')}
        </p>
        <Button size="sm" disabled={empty || pending} onClick={save}>
          {pending && <Spinner />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

function NoteItem({
  note,
  canUpdate,
  when,
  saving,
  onDelete,
  onSave,
}: {
  note: ContactNoteResponse;
  canUpdate: boolean;
  when: (iso: string) => string;
  saving: boolean;
  onDelete: () => void;
  onSave: (body: string, done: () => void) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.notes');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const added = when(note.createdAt);
  const wasEdited = note.updatedAt !== note.createdAt;

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const startEdit = () => {
    setDraft(note.body);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const unchanged = draft.trim() === note.body.trim();
  const save = () => {
    if (draft.trim() === '' || unchanged || saving) return;
    onSave(draft.trim(), () => setEditing(false));
  };

  return (
    <li className="rounded-md border border-border p-3">
      {editing ? (
        <div className="space-y-2">
          <label htmlFor={id} className="sr-only">
            {t('editLabel')}
          </label>
          <Textarea
            ref={ref}
            id={id}
            rows={4}
            value={draft}
            maxLength={NOTE_BODY_MAX}
            dir="auto"
            readOnly={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSaveKey(e)) {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                // Escape only ends the edit; it must not also close a drawer or dialog around the notes.
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving || draft.trim() === '' || unchanged}>
              {saving && <Spinner />}
              {t('saveEdit')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
            {note.body}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-xs text-muted-foreground">
              {t('added', { when: added })}
              {wasEdited && <> &middot; {t('edited', { when: when(note.updatedAt) })}</>}
            </p>
            {canUpdate && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('editAria', { when: added })}
                  onClick={startEdit}
                >
                  {t('edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('deleteAria', { when: added })}
                  onClick={onDelete}
                >
                  {t('delete')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </li>
  );
}
