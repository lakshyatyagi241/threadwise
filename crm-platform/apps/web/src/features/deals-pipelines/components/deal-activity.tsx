'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Select, Spinner, Textarea, cn, useToast } from '@crm/ui';
import { invalidateTasks } from '@/features/tasks';
import { KEYS, useActivities } from '../api/hooks';
import { dealsApi } from '../api/service';
import type { Activity, Deal } from '../api/schemas';
import { dueState, formatDateTime, formatDay } from '../lib/format';
import { ErrorLine } from './parts';
import { CalendarIcon, CheckIcon, MessageIcon, MoveIcon } from './icons';

type NewType = 'note' | 'task' | 'call';
const TYPES: readonly NewType[] = ['note', 'task', 'call'];

/** The deal's timeline (newest first) with a composer for notes, call logs and follow-up tasks (TW-DEAL-015/016). */
export function DealActivity({ deal, canWrite }: { deal: Deal; canWrite: boolean }) {
  const t = useTranslations('deals-pipelines.activity');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useActivities(deal.id);
  const [type, setType] = useState<NewType>('note');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await dealsApi.addActivity(deal.id, {
        type,
        body: text,
        dueAt: type === 'task' && due ? new Date(`${due}T09:00:00`).toISOString() : undefined,
      });
      setBody('');
      setDue('');
      toast(t('added'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.activities(deal.id) });
      // A timeline task is mirrored into the tasks list (D-14): the deal's task section and the Tasks screen follow.
      if (type === 'task') await invalidateTasks(qc);
    } catch {
      toast(t('addFailed'), 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: Activity) {
    try {
      await dealsApi.setTaskDone(deal.id, a.id, !a.done);
      await qc.invalidateQueries({ queryKey: KEYS.activities(deal.id) });
      await invalidateTasks(qc);
    } catch {
      toast(t('toggleFailed'), 'danger');
    }
  }

  const icon = (a: Activity) =>
    a.type === 'stage_change' ? (
      <MoveIcon />
    ) : a.type === 'task' ? (
      <CalendarIcon />
    ) : (
      <MessageIcon />
    );

  return (
    <section aria-labelledby="deal-activity-h" className="space-y-4">
      <h3 id="deal-activity-h" className="text-sm font-semibold">
        {t('title')}
      </h3>

      {canWrite && (
        <form
          className="space-y-2 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label={t('type')}
              className="w-auto min-w-32"
              value={type}
              onChange={(e) => setType(e.target.value as NewType)}
            >
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </Select>
            {type === 'task' && (
              <input
                type="date"
                aria-label={t('due')}
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            )}
          </div>
          <Textarea
            rows={3}
            maxLength={5000}
            aria-label={t('placeholder')}
            placeholder={t('placeholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || body.trim() === ''}>
              {busy && <Spinner />}
              {t('add')}
            </Button>
          </div>
        </form>
      )}

      {list.isPending && (
        <div className="space-y-2" aria-busy="true">
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      )}
      {list.isError && <ErrorLine error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      )}

      <ol className="space-y-3">
        {(list.data ?? []).map((a) => {
          const state = a.type === 'task' && !a.done ? dueState(a.dueAt) : null;
          return (
            <li key={a.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                {icon(a)}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'whitespace-pre-wrap break-words text-sm',
                    a.done && 'text-muted-foreground line-through',
                  )}
                >
                  {a.type === 'stage_change'
                    ? a.stageChange
                      ? t('stageChangeLabel', {
                          from: a.stageChange.from ?? '—',
                          to: a.stageChange.to,
                        })
                      : t('stageChanged')
                    : a.body}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(`kinds.${a.type}`)} · {a.userName ?? t('system')} ·{' '}
                  {formatDateTime(a.createdAt, locale)}
                  {a.type === 'task' && a.dueAt && (
                    <>
                      {' · '}
                      <span
                        className={cn(
                          state === 'overdue' && 'font-medium text-danger',
                          state === 'today' && 'font-medium text-warning',
                        )}
                      >
                        {t('dueOn', { date: formatDay(a.dueAt, locale) })}
                      </span>
                    </>
                  )}
                </p>
                {a.type === 'task' && canWrite && (
                  <button
                    type="button"
                    aria-pressed={a.done}
                    onClick={() => void toggle(a)}
                    className={cn(
                      'mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                      a.done
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-foreground hover:bg-border',
                    )}
                  >
                    <CheckIcon className="size-3" /> {a.done ? t('done') : t('markDone')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
