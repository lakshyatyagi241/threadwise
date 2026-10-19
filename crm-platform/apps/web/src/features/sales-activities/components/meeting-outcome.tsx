'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Field, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { ERROR_CODES, MEETING_RESULT_NOTE_MAX, type MeetingResult } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  ACTIVITY_KEYS,
  activityTypesApi,
  useActivitySettings,
  useMeetingResults,
} from '../api/activity-types';
import { useQueryClient } from '@tanstack/react-query';
import { useVocabulary } from '@/features/persona-vocabulary';
import { useActivityLabels } from '../lib/labels';

/**
 * "Add outcome" on a meeting row: complete the meeting with one of the Meeting activity's outcomes and a note, change them later, or
 * reopen it. Drawn only when the workspace allows completing meetings (Settings > Sales Activities); the outcome picker only when that
 * activity predicts outcomes. Small on purpose: it sits under the row and touches nothing else of the meeting.
 */
export function MeetingOutcome({
  contactId,
  meetingId,
  title,
  canUpdate,
}: {
  contactId: string;
  meetingId: string;
  title: string;
  canUpdate: boolean;
}) {
  const tRaw = useTranslations('sales-activities.meeting');
  // The workspace's own word for "meeting" (a clinic may say "visit") in the toasts and errors.
  const { localize } = useVocabulary();
  const t = tRaw;
  const tv = (key: string) => localize(tRaw(key));
  const labels = useActivityLabels();
  const { toast } = useToast();
  const qc = useQueryClient();
  const id = useId();
  const settings = useActivitySettings('meeting');
  const results = useMeetingResults(contactId);
  const result: MeetingResult | undefined = results.data?.find((r) => r.meetingId === meetingId);
  const [open, setOpen] = useState(false);
  const [outcomeId, setOutcomeId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ACTIVITY_KEYS.meetingResults(contactId) });
  const errorText = (e: unknown) =>
    e instanceof ApiError && e.code === ERROR_CODES.ACTIVITY_COMPLETION_DISABLED
      ? tv('errors.disabled')
      : e instanceof ApiError && e.code === ERROR_CODES.ACTIVITY_OPTION_INVALID
        ? tv('errors.optionGone')
        : tv('errors.failed');

  const begin = () => {
    setOutcomeId(result?.outcome?.id ?? '');
    setNote(result?.note ?? '');
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await activityTypesApi.setMeetingResult(contactId, meetingId, {
        outcomeId: outcomeId || null,
        note: note.trim() || null,
      });
      await refresh();
      setOpen(false);
      toast(tv('saved'));
    } catch (e) {
      toast(errorText(e), 'danger');
      void refresh();
      void qc.invalidateQueries({ queryKey: ACTIVITY_KEYS.list });
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await activityTypesApi.clearMeetingResult(contactId, meetingId);
      await refresh();
      toast(tv('reopened'));
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    const list = settings.activity?.outcomes ?? [];
    const gone =
      result?.outcome && !list.some((o) => o.id === result.outcome!.id) ? result.outcome : null;
    return (
      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-3">
        {settings.outcomesEnabled && (
          <Field label={t('outcome')} htmlFor={`${id}-outcome`}>
            <Select
              id={`${id}-outcome`}
              value={outcomeId}
              onChange={(e) => setOutcomeId(e.target.value)}
            >
              <option value="">{t('noOutcome')}</option>
              {gone && (
                <option value={gone.id}>
                  {labels.ref(gone)} {t('removedSuffix')}
                </option>
              )}
              {list.map((o) => (
                <option key={o.id} value={o.id}>
                  {labels.option('meeting', o)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('notes')} htmlFor={`${id}-notes`}>
          <Textarea
            id={`${id}-notes`}
            rows={2}
            maxLength={MEETING_RESULT_NOTE_MAX}
            value={note}
            dir="auto"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button size="sm" variant="brand" onClick={() => void save()} disabled={busy}>
            {busy && <Spinner />}
            {t('save')}
          </Button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mt-2 space-y-1 text-xs">
        <p className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-medium text-success">
            {result.outcome
              ? t('outcomeChip', { name: labels.ref(result.outcome) })
              : t('completed')}
          </span>
          {canUpdate && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('editAria', { title })}
                onClick={begin}
                disabled={busy}
              >
                {t('edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('reopenAria', { title })}
                onClick={() => void reopen()}
                disabled={busy}
              >
                {t('reopen')}
              </Button>
            </>
          )}
        </p>
        {result.note && (
          <p dir="auto" className="break-words text-muted-foreground">
            {result.note}
          </p>
        )}
      </div>
    );
  }

  if (!canUpdate || !settings.allowComplete) return null;
  return (
    <div className="mt-2">
      <Button size="sm" variant="secondary" aria-label={t('addAria', { title })} onClick={begin}>
        {settings.outcomesEnabled ? t('add') : t('markCompleted')}
      </Button>
    </div>
  );
}
