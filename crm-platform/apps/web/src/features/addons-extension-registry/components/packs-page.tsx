'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addonPackSchema, type AddonPack } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  StatTile,
  Switch,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchPacks } from '../api';
import { addonErrorKey } from '../lib/errors';
import { PackEditor } from './pack-editor';
import { ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.packs';

export function PacksPage() {
  const t = useTranslations('addons-extension-registry.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <PacksScreen />
    </ToastProvider>
  );
}

function PacksScreen() {
  const q = useQuery({
    queryKey: KEYS.packs,
    queryFn: ({ signal }) => fetchPacks(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <Catalogue packs={q.data.data} summary={q.data.summary} />;
}

function Catalogue({
  packs,
  summary,
}: {
  packs: AddonPack[];
  summary: { total: number; active: number };
}) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const tc = useTranslations('addons-extension-registry.common');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [editing, setEditing] = useState<AddonPack | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AddonPack | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.packs });
  const fail = (e: unknown) => {
    const k = addonErrorKey(e);
    toast(te(k === 'forbidden' || k === 'notFound' ? k : 'generic'), 'danger');
  };

  const toggle = useMutation({
    mutationFn: (v: { pack: AddonPack; isActive: boolean }) =>
      operatorFetch(`/addons/${v.pack.id}/active`, {
        method: 'PATCH',
        body: { isActive: v.isActive, rowVersion: v.pack.rowVersion },
        schema: addonPackSchema,
      }),
    onMutate: (v) => setTogglingId(v.pack.id),
    onSuccess: (pack) => {
      toast(t(pack.isActive ? 'toasts.activated' : 'toasts.deactivated', { name: pack.name }));
      return refresh();
    },
    onError: (e) => {
      fail(e);
      void refresh();
    },
    onSettled: () => setTogglingId(null),
  });

  const remove = useMutation({
    mutationFn: (pack: AddonPack) => operatorFetch(`/addons/${pack.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast(t('toasts.deleted', { name: deleting?.name ?? '' }));
      setDeleting(null);
      await refresh();
    },
  });

  const money = (p: AddonPack, value: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(
      Number(value),
    );

  const price = (p: AddonPack) =>
    p.isFree ? (
      <span>{t('price.free')}</span>
    ) : (
      <div>
        {p.offerAmount && (
          <span className="me-1.5 text-xs text-muted-foreground line-through">
            {money(p, p.amount)}
          </span>
        )}
        <span className="font-medium">{money(p, p.offerAmount ?? p.amount)}</span>
        <p className="text-xs text-muted-foreground">
          {p.isLifetime
            ? t('price.lifetime')
            : t(`period.${p.billingUnit}`, { count: p.billingDuration })}
        </p>
      </div>
    );

  const grants = (p: AddonPack) => {
    const f = p.grants.features;
    const l = Object.entries(p.grants.limits);
    if (!f.length && !l.length)
      return <span className="text-muted-foreground">{t('grants.none')}</span>;
    return (
      <ul className="space-y-0.5 text-xs">
        {f.map((k) => (
          <li key={`f-${k}`} className="font-mono">
            {k}
          </li>
        ))}
        {l.map(([k, v]) => (
          <li key={`l-${k}`}>
            {v === -1
              ? t('grants.unlimited', { name: k })
              : t('grants.add', { name: k, amount: v })}
          </li>
        ))}
      </ul>
    );
  };

  const status = (p: AddonPack) => (
    <div className="flex items-center gap-2">
      <Switch
        checked={p.isActive}
        label={t('active.toggle', { name: p.name })}
        disabled={!canEdit || togglingId === p.id}
        onCheckedChange={(isActive) => toggle.mutate({ pack: p, isActive })}
      />
      <span className="text-xs text-muted-foreground">
        {p.isActive ? t('active.on') : t('active.off')}
      </span>
    </div>
  );

  const actions = (p: AddonPack) => (
    <div className="flex gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
        {t('actions.edit')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        onClick={() => {
          remove.reset();
          setDeleting(p);
        }}
      >
        {t('actions.delete')}
      </Button>
    </div>
  );

  const nameCell = (p: AddonPack) => (
    <>
      <span className="font-medium">{p.name}</span>
      <p dir="ltr" className="text-start font-mono text-xs text-muted-foreground">
        {p.slug}
      </p>
      {p.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{p.subtitle}</p>}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link
              href="/admin/extensions"
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              {t('modulesLink')}
            </Link>
            {canEdit && <Button onClick={() => setEditing('new')}>{t('new')}</Button>}
          </>
        }
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      <div className="grid grid-cols-2 gap-3" role="group" aria-label={t('kpi.label')}>
        <StatTile label={t('kpi.total')} value={summary.total} />
        <StatTile label={t('kpi.active')} value={summary.active} />
      </div>

      {packs.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          message={t('empty.body')}
          actions={
            canEdit ? (
              <Button onClick={() => setEditing('new')}>{t('empty.action')}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('table.label')}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  {(['name', 'price', 'grants', 'owners', 'status'] as const).map((c) => (
                    <th key={c} scope="col" className="px-4 py-3 text-start font-medium">
                      {t(`table.${c}`)}
                    </th>
                  ))}
                  {canEdit && (
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">{t('table.actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3">{nameCell(p)}</td>
                    <td className="px-4 py-3">{price(p)}</td>
                    <td className="px-4 py-3">{grants(p)}</td>
                    <td className="px-4 py-3 font-mono">{p.activePurchases}</td>
                    <td className="px-4 py-3">{status(p)}</td>
                    {canEdit && <td className="px-4 py-3">{actions(p)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ul className="space-y-3 lg:hidden" aria-label={t('table.label')}>
            {packs.map((p) => (
              <li key={p.id}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{nameCell(p)}</div>
                    {status(p)}
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                    {price(p)}
                    {grants(p)}
                    <Badge>{`${t('table.owners')}: ${p.activePurchases}`}</Badge>
                  </div>
                  {canEdit && actions(p)}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <PackEditor
          key={editing === 'new' ? 'new' : editing.id}
          pack={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            toast(t(created ? 'toasts.created' : 'toasts.updated', { name: saved.name }));
            void refresh();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          tone="danger"
          busy={remove.isPending}
          title={t('delete.title', { name: deleting.name })}
          message={
            <div className="space-y-3">
              <p>{t('delete.body')}</p>
              {deleting.activePurchases > 0 && (
                <Alert tone="warning">
                  {t('delete.inUse', { count: deleting.activePurchases })}
                </Alert>
              )}
              {remove.isError && <Alert tone="danger">{te('generic')}</Alert>}
            </div>
          }
          confirmLabel={t('delete.confirm')}
          cancelLabel={tc('cancel')}
          onConfirm={() => remove.mutate(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
