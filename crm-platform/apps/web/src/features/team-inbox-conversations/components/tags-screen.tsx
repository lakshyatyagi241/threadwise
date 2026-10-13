'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, ConfirmDialog, EmptyState, Field, Input, Spinner, useToast } from '@crm/ui';
import { LABEL_COLOR_PATTERN, LABEL_NAME_MAX, type InboxLabel } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { KEYS, useLabels } from '../api/hooks';
import { inboxApi } from '../api/service';
import { BackIcon } from './icons';
import { DEFAULT_LABEL_COLOR, LabelChip, safeLabelColor } from './label-chip';
import { useErrorText } from './parts';

interface Draft {
  name: string;
  color: string;
  description: string;
}
const EMPTY: Draft = { name: '', color: DEFAULT_LABEL_COLOR, description: '' };

/**
 * Settings, "Labels" (`/inbox/labels`): the workspace label library used to tag conversations and filter the inbox. Anyone who may
 * manage labels can add, rename, recolour, describe and delete them. The labels are the same tags contacts use, so a deletion also
 * takes the label off contacts; the screen says how many conversations carry it before it asks.
 */
export function LabelsScreen() {
  const t = useTranslations('team-inbox-conversations.labels');
  const errorText = useErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const library = useLabels(true);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<InboxLabel | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<InboxLabel | null>(null);
  const [deleting, setDeleting] = useState(false);

  const colorOk = LABEL_COLOR_PATTERN.test(draft.color.trim());
  const nameOk = draft.name.trim().length > 0;

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'CON_TAG_NAME_TAKEN')
      toast(t('screen.nameTaken'), 'danger');
    else if (e instanceof ApiError && e.isRowVersionConflict) toast(t('screen.conflict'), 'danger');
    else toast(errorText(e), 'danger');
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!nameOk || !colorOk || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await inboxApi.updateLabel(editing.id, {
          rowVersion: editing.rowVersion,
          name: draft.name.trim(),
          color: draft.color.trim(),
          description: draft.description.trim() || null,
        });
        toast(t('screen.saved'));
      } else {
        await inboxApi.createLabel({
          name: draft.name.trim(),
          color: draft.color.trim(),
          ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
        });
        toast(t('screen.created'));
      }
      setDraft(EMPTY);
      setEditing(null);
      await qc.invalidateQueries({ queryKey: KEYS.labels });
    } catch (e) {
      fail(e);
      await qc.invalidateQueries({ queryKey: KEYS.labels });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await inboxApi.deleteLabel(toDelete.id);
      toast(t('screen.deleted'));
      setToDelete(null);
      await qc.invalidateQueries({ queryKey: KEYS.labels });
    } catch (e) {
      fail(e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BackIcon width={14} height={14} /> {t('screen.back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('screen.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('screen.intro')}</p>
      </div>

      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3 rounded-lg border border-border p-4"
        data-testid="labels-form"
      >
        <h2 className="text-sm font-medium">
          {editing ? t('screen.editTitle') : t('screen.newTitle')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label={t('screen.name')}>
            <Input
              value={draft.name}
              maxLength={LABEL_NAME_MAX}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              data-testid="labels-name"
            />
          </Field>
          <Field label={t('screen.color')} error={colorOk ? undefined : t('screen.colorInvalid')}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: safeLabelColor(colorOk ? draft.color : null) }}
              />
              <Input
                dir="ltr"
                value={draft.color}
                maxLength={16}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                data-testid="labels-color"
              />
            </div>
          </Field>
        </div>
        <Field label={t('screen.description')}>
          <Input
            value={draft.description}
            maxLength={255}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={!nameOk || !colorOk || saving} data-testid="labels-save">
            {saving ? <Spinner /> : null}
            {editing ? t('screen.save') : t('screen.create')}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setDraft(EMPTY);
              }}
            >
              {t('screen.cancel')}
            </Button>
          )}
        </div>
      </form>

      {library.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {library.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('loadFailed')}
        </p>
      )}
      {library.data && library.data.data.length === 0 && (
        <EmptyState title={t('screen.emptyTitle')} message={t('screen.emptyMessage')} />
      )}
      {library.data && library.data.data.length > 0 && (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="labels-list"
        >
          {library.data.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <LabelChip label={l} className="max-w-[14rem] text-xs" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" dir="auto">
                {l.description}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('screen.inUse', { count: l.conversationCount })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setEditing(l);
                  setDraft({
                    name: l.name,
                    color: l.color ?? DEFAULT_LABEL_COLOR,
                    description: l.description ?? '',
                  });
                }}
              >
                {t('screen.edit')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setToDelete(l)}>
                {t('screen.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={t('screen.deleteTitle')}
        message={t('screen.deleteMessage', {
          name: toDelete?.name ?? '',
          count: toDelete?.conversationCount ?? 0,
        })}
        confirmLabel={t('screen.delete')}
        cancelLabel={t('screen.cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
