'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformPermission } from '@crm/contracts';
import { Alert, ConfirmDialog, Input, Select, cn } from '@crm/ui';
import { useToast } from '../auth-registration-security/platform/ui/toast';
import { deletePermission, fetchPermissions, rbacKeys } from './lib/api';
import { rbacError } from './lib/errors';
import { capitalise, groupPermissions } from './lib/matrix';
import { filterPermissions } from './lib/permission-filter';
import { AccessGate, useMyPermissions } from './ui/access';
import { Kpi, RbacHeader, pillLink } from './ui/chrome';
import { LockIcon, PersonIcon, PlusIcon, SearchIcon, ShieldIcon } from './ui/icons';
import { LoadingBlock, QueryError } from './ui/states';

const NS = 'roles-permissions.permissions';

/** /admin/permissions */
export function PermissionsPage() {
  return <AccessGate permission="platform.permission.manage">{() => <Catalogue />}</AccessGate>;
}

function Catalogue() {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions.common');
  const te = useTranslations('roles-permissions.common.errors');
  const me = useMyPermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('');
  const [deleting, setDeleting] = useState<PlatformPermission | null>(null);

  const q = useQuery({
    queryKey: rbacKeys.permissions,
    queryFn: ({ signal }) => fetchPermissions(signal),
    refetchOnWindowFocus: false,
  });

  const remove = useMutation({
    mutationFn: (p: PlatformPermission) => deletePermission(p.id),
    onSuccess: async (res) => {
      toast.success(t('toasts.deleted', { name: res.name }));
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: rbacKeys.permissions });
      // Role counts and the matrix both read the catalogue.
      await qc.invalidateQueries({ queryKey: rbacKeys.roles });
    },
  });
  const removeInfo = remove.error ? rbacError(remove.error) : null;

  const all = useMemo<PlatformPermission[]>(() => q.data?.data ?? [], [q.data]);
  const modules = useMemo(() => groupPermissions(all).map((g) => g.module), [all]);
  const groups = useMemo(() => filterPermissions(all, search, module), [all, search, module]);

  const header = (
    <RbacHeader
      crumbsLabel={tc('breadcrumb')}
      crumbs={[{ label: tc('admin'), href: '/admin' }, { label: t('crumb') }]}
      eyebrow={t('eyebrow')}
      lead={t('titleLead')}
      accent={t('titleAccent')}
      description={t('description')}
      actions={
        <>
          {me.can('platform.role.manage') && (
            <Link href="/admin/roles" className={pillLink('secondary')}>
              <ShieldIcon />
              {t('backToRoles')}
            </Link>
          )}
          <Link href="/admin/permissions/new" className={pillLink('primary')}>
            <PlusIcon />
            {t('add')}
          </Link>
        </>
      }
    />
  );

  if (q.isPending) {
    return (
      <div className="space-y-5">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-5">
        {header}
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const { kpis } = q.data;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="space-y-5">
      {header}

      <section
        aria-label={t('kpi.label')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="permission-kpis"
      >
        <Kpi
          label={t('kpi.total')}
          value={kpis.total}
          hint={t('kpi.totalHint', { modules: kpis.modules })}
        />
        <Kpi label={t('kpi.used')} value={kpis.usedInRoles} hint={t('kpi.usedHint')} />
        <Kpi
          tone="warning"
          label={t('kpi.orphans')}
          value={kpis.orphans}
          hint={t('kpi.orphansHint')}
        />
        <Kpi
          large={false}
          label={t('kpi.last')}
          value={kpis.lastAdded?.name ?? '—'}
          hint={kpis.lastAdded?.at.slice(0, 10)}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm">
        <div className="relative w-full flex-1 sm:max-w-md">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('filter.searchLabel')}
            placeholder={t('filter.search')}
            className="h-9 rounded-full ps-9 text-xs"
          />
        </div>
        <Select
          aria-label={t('filter.moduleLabel')}
          value={module}
          onChange={(e) => setModule(e.target.value)}
          className="h-9 w-auto rounded-full px-3 text-xs"
        >
          <option value="">{t('filter.allModules')}</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {capitalise(m)}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <span className="me-2 font-mono text-xs text-muted-foreground" aria-live="polite">
          {t('filter.count', { count: shown, modules: groups.length })}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-background p-10 text-center text-sm text-muted-foreground shadow-sm">
          {kpis.total === 0 ? (
            t.rich('empty.none', {
              link: (chunks) => (
                <Link
                  href="/admin/permissions/new"
                  className="font-semibold text-primary hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })
          ) : (
            <p>{t('empty.noMatch')}</p>
          )}
        </div>
      ) : (
        <section
          aria-label={t('groupsLabel')}
          className="grid grid-cols-1 gap-5 lg:grid-cols-2"
          data-testid="permission-groups"
        >
          {groups.map((g) => (
            <div
              key={g.module}
              data-module={g.module}
              className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
                <h2 className="flex items-center gap-2.5 text-base font-semibold">
                  <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                    <PersonIcon />
                  </span>
                  {capitalise(g.module)}
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {t('groupCount', { count: g.items.length })}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {g.items.map((p) => {
                  const orphan = p.roleCount === 0;
                  return (
                    <li
                      key={p.id}
                      data-testid={`permission-row-${p.name}`}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-muted/40',
                        orphan && 'bg-warning/5',
                      )}
                    >
                      <span
                        className={cn(
                          'min-w-0 break-all font-mono text-sm',
                          orphan && 'text-warning',
                        )}
                      >
                        {p.name}
                        {orphan && (
                          <span className="ms-1 rounded-full bg-warning/15 px-1.5 py-0.5 font-sans text-[9px] font-semibold text-warning">
                            {t('orphan')}
                          </span>
                        )}
                        {p.isSystem && (
                          <span
                            title={t('systemHint')}
                            className="ms-1 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-sans text-[9px] font-semibold text-muted-foreground"
                          >
                            <LockIcon className="size-2.5" />
                            {t('system')}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'font-mono text-xs',
                            orphan ? 'text-warning' : 'text-muted-foreground',
                          )}
                        >
                          {t('inRoles', { count: p.roleCount })}
                        </span>
                        {!p.isSystem && (
                          <button
                            type="button"
                            aria-label={t('deleteName', { name: p.name })}
                            onClick={() => {
                              remove.reset();
                              setDeleting(p);
                            }}
                            className="rounded-full px-2 py-0.5 text-xs text-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {t('delete.action')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={t('delete.title')}
        message={
          <div className="space-y-3">
            <p>{t('delete.message', { name: deleting?.name ?? '' })}</p>
            {removeInfo && <Alert tone="danger">{te(removeInfo.key, removeInfo.values)}</Alert>}
          </div>
        }
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
