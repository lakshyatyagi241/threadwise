'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLAYBOOK_ACTIONS,
  PLAYBOOK_TRIGGERS,
  playbooksResponseSchema,
  type Playbook,
  type PlaybookStep,
} from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Select, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKey } from '../lib/display';

const NS = 'platform-support-desk';
const KEY = ['support', 'operator', 'playbooks'] as const;
const SLOTS = 3;
type Slot = { action: string; value: string };
const emptySlots = (): Slot[] => Array.from({ length: SLOTS }, () => ({ action: '', value: '' }));

/** Playbook library and builder (WD-SUPP-022, 023): three step slots, empty rows are dropped before saving. */
export function PlaybooksPage() {
  const t = useTranslations(`${NS}.playbooks`);
  const te = useTranslations(`${NS}.errors`);
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canWrite = operator.role !== 'auditor';
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<(typeof PLAYBOOK_TRIGGERS)[number]>('manual');
  const [triggerValue, setTriggerValue] = useState('');
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [deleting, setDeleting] = useState<Playbook | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/support/playbooks', { schema: playbooksResponseSchema, signal }),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ['support', 'operator', 'runnable'] });
  };
  const fail = (e: unknown) => {
    toast.error(te(errorKey(e)));
    refresh();
  };

  const create = useMutation({
    mutationFn: () => {
      const steps = slots
        .filter((s) => s.action)
        .map((s) => ({ action: s.action as PlaybookStep['action'], value: s.value }));
      return operatorFetch('/support/playbooks', {
        method: 'POST',
        body: { name, triggerType: trigger, triggerValue: triggerValue || undefined, steps },
      });
    },
    onSuccess: () => {
      toast.success(t('created'));
      setName('');
      setTrigger('manual');
      setTriggerValue('');
      setSlots(emptySlots());
      refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (p: Playbook) =>
      operatorFetch(`/support/playbooks/${p.id}`, {
        method: 'PATCH',
        body: { isActive: !p.isActive, rowVersion: p.rowVersion },
      }),
    onSuccess: (_d, p) => {
      toast.success(p.isActive ? t('pausedToast') : t('activated'));
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (p: Playbook) => operatorFetch(`/support/playbooks/${p.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      toast.success(t('deleted'));
      refresh();
    },
    onError: (e) => {
      setDeleting(null);
      fail(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  const setSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const label = (action: string) =>
    PLAYBOOK_ACTIONS.includes(action as PlaybookStep['action'])
      ? t(`actions.${action as PlaybookStep['action']}`)
      : action;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label={t('kpi.total')} value={q.data.kpis.total} />
            <StatTile label={t('kpi.active')} value={q.data.kpis.active} tone="accent" />
            <StatTile label={t('kpi.runs')} value={q.data.kpis.uses} />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="p-0">
              <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('library')}</h2>
              {q.data.data.length === 0 ? (
                <div className="space-y-4 p-8 text-center">
                  <h3 className="text-xl font-semibold">{t('emptyTitle')}</h3>
                  <p className="mx-auto max-w-xs text-sm text-muted-foreground">{t('emptyBody')}</p>
                  <div className="mx-auto max-w-md space-y-2 text-start">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t('starters')}
                    </p>
                    {(['starter1', 'starter2', 'starter3'] as const).map((s) => (
                      <div key={s} className="rounded-md border bg-muted/30 p-3">
                        <p className="text-sm font-semibold">{t(s)}</p>
                        <p className="text-xs text-muted-foreground">{t(`${s}Body`)}</p>
                      </div>
                    ))}
                    <p className="font-mono text-xs text-muted-foreground">{t('starterHint')}</p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y">
                  {q.data.data.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 p-4"
                      data-testid="playbook-row"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold">{p.name}</h3>
                          <Badge tone={p.isActive ? 'success' : 'neutral'}>
                            {p.isActive ? t('active') : t('paused')}
                          </Badge>
                          <Badge>
                            {p.triggerType}
                            {p.triggerValue ? `: ${p.triggerValue}` : ''}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {t('meta', { steps: p.steps.length, uses: p.useCount, slug: p.slug })}
                        </p>
                        {p.steps.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.steps.map((s, i) => (
                              <span
                                key={i}
                                className="rounded-full border bg-muted/30 px-2 py-0.5 font-mono text-[11px]"
                              >
                                {label(s.action)}
                                {s.value
                                  ? `: ${s.value.length > 24 ? `${s.value.slice(0, 24)}...` : s.value}`
                                  : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {canWrite && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate(p)}
                          >
                            {p.isActive ? t('pause') : t('activate')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                            {t('delete')}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {canWrite && (
              <Card>
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t('newPlaybook')}
                    </p>
                    <h3 className="text-lg font-semibold">{t('build')}</h3>
                  </div>
                  <Field label={t('nameLabel')} htmlFor="pb-name">
                    <Input
                      id="pb-name"
                      required
                      maxLength={120}
                      placeholder={t('namePlaceholder')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('trigger')} htmlFor="pb-trigger">
                      <Select
                        id="pb-trigger"
                        value={trigger}
                        onChange={(e) => setTrigger(e.target.value as typeof trigger)}
                      >
                        {PLAYBOOK_TRIGGERS.map((tr) => (
                          <option key={tr} value={tr}>
                            {t(`triggers.${tr}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('triggerValue')} htmlFor="pb-tv">
                      <Input
                        id="pb-tv"
                        maxLength={120}
                        placeholder={t('triggerValuePlaceholder')}
                        value={triggerValue}
                        onChange={(e) => setTriggerValue(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t('steps')}
                    </p>
                    {slots.map((s, i) => (
                      <div key={i} className="grid grid-cols-[8.75rem_1fr] gap-2">
                        <Select
                          aria-label={`${t('steps')} ${i + 1}`}
                          value={s.action}
                          onChange={(e) => setSlot(i, { action: e.target.value })}
                        >
                          <option value="">{t('skip')}</option>
                          {PLAYBOOK_ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {t(`actions.${a}`)}
                            </option>
                          ))}
                        </Select>
                        <Input
                          aria-label={`${t('valuePlaceholder')} ${i + 1}`}
                          maxLength={8000}
                          placeholder={t('valuePlaceholder')}
                          value={s.value}
                          onChange={(e) => setSlot(i, { value: e.target.value })}
                        />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">{t('stepsHint')}</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={create.isPending}>
                    {t('create')}
                  </Button>
                </form>
              </Card>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle')}
        message={t('deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
