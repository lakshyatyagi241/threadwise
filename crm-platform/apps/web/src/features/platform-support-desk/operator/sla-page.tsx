'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { slaBoardResponseSchema, type SlaPolicy } from '@crm/contracts';
import { Badge, Button, Card, ConfirmDialog, Field, Input, StatTile, Switch } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKey } from '../lib/display';
import { minutesLabel, relativeTime } from '../lib/format';

const NS = 'platform-support-desk';
const KEY = ['support', 'operator', 'sla'] as const;

interface Draft {
  name: string;
  firstResponseMinutes: string;
  resolutionMinutes: string;
  respectBusinessHours: boolean;
  pauseWhenWaitingOnCustomer: boolean;
  isDefault: boolean;
}
const NEW_DRAFT: Draft = {
  name: '',
  firstResponseMinutes: '60',
  resolutionMinutes: '1440',
  respectBusinessHours: true,
  pauseWhenWaitingOnCustomer: false,
  isDefault: false,
};
const toDraft = (p: SlaPolicy): Draft => ({
  name: p.name,
  firstResponseMinutes: String(p.firstResponseMinutes),
  resolutionMinutes: String(p.resolutionMinutes),
  respectBusinessHours: p.respectBusinessHours,
  pauseWhenWaitingOnCustomer: p.pauseWhenWaitingOnCustomer,
  isDefault: p.isDefault,
});

const SEVERITY_TONE = { warn: 'warning', breach: 'danger', hard_breach: 'danger' } as const;

/** SLA board (TW-SUPP-026..028): KPIs, policies, recent breaches and the policy form (add, and edit as an addition to Reference). */
export function SlaPage() {
  const t = useTranslations(`${NS}.sla`);
  const te = useTranslations(`${NS}.errors`);
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canWrite = operator.role !== 'auditor';
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  const [deleting, setDeleting] = useState<SlaPolicy | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/support/sla', { schema: slaBoardResponseSchema, signal }),
  });
  const done = (message: string) => {
    toast.success(message);
    setDraft(NEW_DRAFT);
    setEditing(null);
    void qc.invalidateQueries({ queryKey: KEY });
  };
  const fail = (e: unknown) => {
    toast.error(te(errorKey(e)));
    void qc.invalidateQueries({ queryKey: KEY });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name,
        firstResponseMinutes: Number(draft.firstResponseMinutes),
        resolutionMinutes: Number(draft.resolutionMinutes),
        respectBusinessHours: draft.respectBusinessHours,
        pauseWhenWaitingOnCustomer: draft.pauseWhenWaitingOnCustomer,
        isDefault: draft.isDefault,
      };
      return editing
        ? operatorFetch(`/support/sla/policies/${editing.id}`, {
            method: 'PATCH',
            body: { ...body, rowVersion: editing.rowVersion },
          })
        : operatorFetch('/support/sla/policies', { method: 'POST', body });
    },
    onSuccess: () => done(editing ? t('updated') : t('saved')),
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (p: SlaPolicy) =>
      operatorFetch(`/support/sla/policies/${p.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      toast.success(t('deleted'));
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => {
      setDeleting(null);
      fail(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('kpi.policies')} value={q.data.kpis.policies} />
            <StatTile label={t('kpi.breaches')} value={q.data.kpis.openBreaches} tone="warning" />
            <StatTile label={t('kpi.atRisk')} value={q.data.kpis.atRisk} />
            <StatTile label={t('kpi.compliance')} value={`${q.data.kpis.compliance7d}%`} />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-5">
              <Card className="overflow-x-auto p-0">
                <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('policies')}</h2>
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start">{t('name')}</th>
                      <th className="p-3 text-end">{t('firstReply')}</th>
                      <th className="p-3 text-end">{t('resolution')}</th>
                      <th className="p-3 text-center">{t('hours')}</th>
                      <th className="p-3 text-center">{t('default')}</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.policies.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                          {t('noPolicies')}
                        </td>
                      </tr>
                    )}
                    {q.data.policies.map((p) => (
                      <tr key={p.id} className="border-b last:border-0" data-testid="policy-row">
                        <td className="p-3 font-semibold">{p.name}</td>
                        <td className="p-3 text-end font-mono">
                          {minutesLabel(p.firstResponseMinutes)}
                        </td>
                        <td className="p-3 text-end font-mono">
                          {minutesLabel(p.resolutionMinutes)}
                        </td>
                        <td className="p-3 text-center text-xs">
                          {p.respectBusinessHours ? t('biz') : t('always')}
                        </td>
                        <td className="p-3 text-center">
                          {p.isDefault && <Badge tone="success">{t('defaultBadge')}</Badge>}
                        </td>
                        <td className="p-3 text-end">
                          {canWrite && (
                            <span className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(p);
                                  setDraft(toDraft(p));
                                }}
                              >
                                {t('edit')}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                                {t('delete')}
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card className="overflow-x-auto p-0">
                <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('breaches')}</h2>
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3 text-start">{t('when')}</th>
                      <th className="p-3 text-start">{t('ticket')}</th>
                      <th className="p-3 text-start">{t('type')}</th>
                      <th className="p-3 text-end">{t('overBy')}</th>
                      <th className="p-3 text-start">{t('severity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.breaches.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-muted-foreground">
                          {t('noBreaches')}
                        </td>
                      </tr>
                    )}
                    {q.data.breaches.map((b) => (
                      <tr key={b.id} className="border-b last:border-0" data-testid="breach-row">
                        <td className="p-3 font-mono text-xs">
                          {relativeTime(b.breachedAt, locale)}
                        </td>
                        <td className="p-3">
                          #{b.ticketNumber}{' '}
                          <span className="text-muted-foreground">
                            · {b.subject.length > 50 ? `${b.subject.slice(0, 50)}...` : b.subject}
                          </span>
                        </td>
                        <td className="p-3">
                          <Badge>{b.breachType}</Badge>
                        </td>
                        <td className="p-3 text-end font-mono">{minutesLabel(b.overByMinutes)}</td>
                        <td className="p-3">
                          <Badge tone={SEVERITY_TONE[b.severity]}>{b.severity}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
            {canWrite && (
              <Card>
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {editing ? t('editPolicy') : t('newPolicy')}
                    </p>
                    <h3 className="text-lg font-semibold">{t('addTarget')}</h3>
                  </div>
                  <Field label={t('nameLabel')} htmlFor="sla-name">
                    <Input
                      id="sla-name"
                      required
                      maxLength={120}
                      placeholder={t('namePlaceholder')}
                      value={draft.name}
                      onChange={(e) => set('name', e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('firstLabel')} htmlFor="sla-first">
                      <Input
                        id="sla-first"
                        type="number"
                        min={1}
                        max={10080}
                        required
                        value={draft.firstResponseMinutes}
                        onChange={(e) => set('firstResponseMinutes', e.target.value)}
                      />
                    </Field>
                    <Field label={t('resolveLabel')} htmlFor="sla-res">
                      <Input
                        id="sla-res"
                        type="number"
                        min={1}
                        max={43200}
                        required
                        value={draft.resolutionMinutes}
                        onChange={(e) => set('resolutionMinutes', e.target.value)}
                      />
                    </Field>
                  </div>
                  <Toggle
                    label={t('bizOnly')}
                    checked={draft.respectBusinessHours}
                    onChange={(v) => set('respectBusinessHours', v)}
                  />
                  <Toggle
                    label={t('pause')}
                    checked={draft.pauseWhenWaitingOnCustomer}
                    onChange={(v) => set('pauseWhenWaitingOnCustomer', v)}
                  />
                  <Toggle
                    label={t('setDefault')}
                    checked={draft.isDefault}
                    onChange={(v) => set('isDefault', v)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1" disabled={save.isPending}>
                      {editing ? t('savePolicy') : t('addPolicy')}
                    </Button>
                    {editing && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setEditing(null);
                          setDraft(NEW_DRAFT);
                        }}
                      >
                        {t('cancel')}
                      </Button>
                    )}
                  </div>
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
        busy={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
