'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsResponseSchema, type SupportAgent } from '@crm/contracts';
import { Button, Card, ConfirmDialog, Field, Input, Select, StatTile } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKey } from '../lib/display';
import { minutesLabel } from '../lib/format';

const NS = 'platform-support-desk';
const KEY = ['support', 'operator', 'agents'] as const;

/** Agent roster (TW-SUPP-017, 018): live workload, an On/Off switch, remove, and the "New agent" form. */
export function AgentsPage() {
  const t = useTranslations(`${NS}.agents`);
  const te = useTranslations(`${NS}.errors`);
  const qc = useQueryClient();
  const toast = useToast();
  const { operator } = useOperator();
  const canWrite = operator.role !== 'auditor';
  const [operatorId, setOperatorId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [removing, setRemoving] = useState<SupportAgent | null>(null);

  const q = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      operatorFetch('/support/agents', { schema: agentsResponseSchema, signal }),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ['support', 'operator', 'assignees'] });
  };
  const fail = (e: unknown) => {
    toast.error(te(errorKey(e)));
    refresh();
  };

  const add = useMutation({
    mutationFn: () =>
      operatorFetch('/support/agents', {
        method: 'POST',
        body: { operatorId, specialty: specialty || undefined },
      }),
    onSuccess: () => {
      toast.success(t('added'));
      setOperatorId('');
      setSpecialty('');
      refresh();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (a: SupportAgent) =>
      operatorFetch(`/support/agents/${a.id}`, {
        method: 'PATCH',
        body: { isActive: !a.isActive, rowVersion: a.rowVersion },
      }),
    onSuccess: (_d, a) => {
      toast.success(a.isActive ? t('disabled') : t('activated'));
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (a: SupportAgent) => operatorFetch(`/support/agents/${a.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(t('removed'));
      setRemoving(null);
      refresh();
    },
    onError: (e) => {
      setRemoving(null);
      fail(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (operatorId) add.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('kpi.total')} value={q.data.kpis.total} />
            <StatTile label={t('kpi.active')} value={q.data.kpis.active} tone="accent" />
            <StatTile label={t('kpi.open')} value={q.data.kpis.openTotal} />
            <StatTile label={t('kpi.unassigned')} value={q.data.kpis.unassigned} tone="warning" />
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card className="overflow-x-auto p-0">
              <h2 className="border-b px-5 py-4 text-lg font-semibold">{t('roster')}</h2>
              <table className="w-full text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-start">{t('name')}</th>
                    <th className="p-3 text-start">{t('specialty')}</th>
                    <th className="p-3 text-end">{t('openCol')}</th>
                    <th className="p-3 text-end">{t('resolved30')}</th>
                    <th className="p-3 text-end">{t('avgFirst')}</th>
                    <th className="p-3 text-center">{t('activeCol')}</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        {t('empty')}
                      </td>
                    </tr>
                  )}
                  {q.data.data.map((a) => (
                    <tr key={a.id} className="border-b last:border-0" data-testid="agent-row">
                      <td className="p-3">
                        <p className="font-semibold">{a.operator.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {a.operator.email}
                        </p>
                      </td>
                      <td className="p-3">{a.specialty || '—'}</td>
                      <td className="p-3 text-end font-mono">{a.openCount}</td>
                      <td className="p-3 text-end font-mono">{a.resolved30d}</td>
                      <td className="p-3 text-end font-mono">
                        {minutesLabel(a.avgFirstResponseMinutes)}
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          size="sm"
                          variant={a.isActive ? 'primary' : 'secondary'}
                          disabled={!canWrite || toggle.isPending}
                          aria-pressed={a.isActive}
                          onClick={() => toggle.mutate(a)}
                        >
                          {a.isActive ? t('on') : t('off')}
                        </Button>
                      </td>
                      <td className="p-3 text-end">
                        {canWrite && (
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(a)}>
                            {t('remove')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {canWrite && (
              <Card>
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t('promote')}
                    </p>
                    <h3 className="text-lg font-semibold">{t('newAgent')}</h3>
                  </div>
                  <Field eyebrow label={t('operator')} htmlFor="ag-op">
                    <Select
                      id="ag-op"
                      required
                      value={operatorId}
                      onChange={(e) => setOperatorId(e.target.value)}
                    >
                      <option value="">{t('pickOperator')}</option>
                      {q.data.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field eyebrow label={t('specialty')} htmlFor="ag-spec">
                    <Input
                      id="ag-spec"
                      maxLength={60}
                      placeholder={t('specialtyPlaceholder')}
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" className="w-full" disabled={!operatorId || add.isPending}>
                    {t('add')}
                  </Button>
                </form>
              </Card>
            )}
          </div>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('removeTitle')}
        message={t('removeConfirm', { name: removing?.operator.name ?? '' })}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
