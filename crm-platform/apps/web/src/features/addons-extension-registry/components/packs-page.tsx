'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addonPackSchema, type AddonPack, type GrantFieldsResponse } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, ToastProvider, cn, useToast } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchGrantFields, fetchPacks } from '../api';
import { addonErrorKey } from '../lib/errors';
import { Accent, ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.packs';
const MAX_CHIPS = 4;

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
  // Labels for the grant chips; the list still renders (with raw keys) while this loads or if it fails.
  const fields = useQuery({
    queryKey: KEYS.fields,
    queryFn: ({ signal }) => fetchGrantFields(signal),
    staleTime: 60_000,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <Catalogue packs={q.data.data} fields={fields.data} />;
}

function labelOf(
  fields: GrantFieldsResponse | undefined,
  kind: 'features' | 'limits',
  key: string,
) {
  return fields?.[kind].find((f) => f.key === key)?.label ?? key;
}

function Catalogue({
  packs,
  fields,
}: {
  packs: AddonPack[];
  fields: GrantFieldsResponse | undefined;
}) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const tc = useTranslations('addons-extension-registry.common');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const [deleting, setDeleting] = useState<AddonPack | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.packs });

  // The form page redirects here with ?saved=created|updated (WaDesk's flash message); show it once, then clean the URL.
  const router = useRouter();
  const saved = useSearchParams().get('saved');
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || (saved !== 'created' && saved !== 'updated')) return;
    shown.current = true;
    toast(t(`toasts.${saved}`, { name: '' }));
    router.replace('/admin/addons');
  }, [saved, toast, t, router]);

  const toggle = useMutation({
    mutationFn: (p: AddonPack) =>
      operatorFetch(`/addons/${p.id}/active`, {
        method: 'PATCH',
        body: { isActive: !p.isActive, rowVersion: p.rowVersion },
        schema: addonPackSchema,
      }),
    onMutate: (p) => setTogglingId(p.id),
    onSuccess: (pack) => {
      toast(t(pack.isActive ? 'toasts.activated' : 'toasts.deactivated', { name: pack.name }));
      return refresh();
    },
    onError: (e) => {
      const k = addonErrorKey(e);
      toast(te(k === 'forbidden' || k === 'notFound' ? k : 'generic'), 'danger');
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

  const money = (p: AddonPack) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: p.currency }).format(
      Number(p.offerAmount ?? p.amount),
    );

  const chips = (p: AddonPack): string[] => [
    ...p.grants.features.map((k) => labelOf(fields, 'features', k)),
    ...Object.entries(p.grants.limits).map(([k, v]) =>
      v === -1
        ? t('grants.unlimited', { name: labelOf(fields, 'limits', k) })
        : t('grants.add', { amount: v, name: labelOf(fields, 'limits', k) }),
    ),
  ];

  const head = 'px-2 py-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]';

  return (
    <div className="space-y-5">
      <PageHead
        crumbs={[{ label: tc('admin'), href: '/admin' }, { label: t('crumbHere') }]}
        eyebrow={t('eyebrow')}
        title={
          <>
            {t('titleLead')} <Accent>{t('titleAccent')}</Accent>
          </>
        }
        description={t('description')}
        actions={
          canEdit && (
            <Link
              href="/admin/addons/new"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              {t('new')}
            </Link>
          )
        }
      />
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <caption className="sr-only">{t('table.label')}</caption>
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className={cn(head, 'px-4 text-start')}>
                  {t('table.name')}
                </th>
                <th scope="col" className={cn(head, 'text-end')}>
                  {t('table.price')}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.period')}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.grants')}
                </th>
                <th scope="col" className={cn(head, 'text-start')}>
                  {t('table.status')}
                </th>
                <th scope="col" className={cn(head, 'w-[210px] px-4 text-end')}>
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {packs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="text-[13px]">{t('empty.title')}</div>
                    {canEdit && (
                      <Link
                        href="/admin/addons/new"
                        className="text-[12.5px] font-semibold text-primary hover:underline"
                      >
                        {t('empty.action')}
                      </Link>
                    )}
                  </td>
                </tr>
              )}
              {packs.map((p) => {
                const c = chips(p);
                return (
                  <tr key={p.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{p.name}</div>
                      {p.subtitle && (
                        <div className="text-[11px] text-muted-foreground">{p.subtitle}</div>
                      )}
                    </td>
                    <td className="px-2 py-3 text-end font-mono" dir="ltr">
                      {p.isFree ? t('price.free') : money(p)}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">
                      {p.isLifetime
                        ? t('price.lifetime')
                        : t(`period.${p.billingUnit}`, { count: p.billingDuration })}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex max-w-[280px] flex-wrap gap-1">
                        {c.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {t('grants.none')}
                          </span>
                        )}
                        {c.slice(0, MAX_CHIPS).map((g) => (
                          <span
                            key={g}
                            className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                          >
                            {g}
                          </span>
                        ))}
                        {c.length > MAX_CHIPS && (
                          <span className="text-[10px] text-muted-foreground">
                            {t('grants.more', { count: c.length - MAX_CHIPS })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] uppercase',
                          p.isActive
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            p.isActive ? 'bg-primary' : 'bg-muted-foreground/50',
                          )}
                        />
                        {p.isActive ? t('status.active') : t('status.off')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/addons/${p.id}/edit`}
                            className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[11.5px] font-medium hover:bg-muted"
                          >
                            {t('actions.edit')}
                          </Link>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-lg px-2.5 text-[11.5px]"
                            disabled={togglingId === p.id}
                            onClick={() => toggle.mutate(p)}
                          >
                            {p.isActive ? t('actions.disable') : t('actions.enable')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-lg border-danger/40 px-2.5 text-[11.5px] text-danger"
                            onClick={() => {
                              remove.reset();
                              setDeleting(p);
                            }}
                          >
                            {t('actions.delete')}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

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
