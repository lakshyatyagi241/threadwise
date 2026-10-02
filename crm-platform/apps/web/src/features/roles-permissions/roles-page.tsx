'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformRoleSummary, PlatformRoleType } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Input, Menu, MenuItem, MenuSeparator, cn } from '@crm/ui';
import { useToast } from '../auth-registration-security/platform/ui/toast';
import { deleteRole, fetchRoles, rbacKeys } from './lib/api';
import { rbacError } from './lib/errors';
import { useDebounced } from './lib/use-debounced';
import { AccessGate, useMyPermissions } from './ui/access';
import { Kpi, RbacHeader, pillLink } from './ui/chrome';
import {
  DotsIcon,
  EditIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
} from './ui/icons';
import { LoadingBlock, QueryError } from './ui/states';

const NS = 'roles-permissions.list';
const TYPES: readonly PlatformRoleType[] = ['all', 'system', 'custom'];

/** /admin/roles */
export function RolesPage() {
  return <AccessGate permission="platform.role.manage">{() => <RolesList />}</AccessGate>;
}

function RolesList() {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions.common');
  const [type, setType] = useState<PlatformRoleType>('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim(), 300);
  const me = useMyPermissions();

  // Filtering happens on the server; the previous rows stay on screen (dimmed) while the next set loads.
  const q = useQuery({
    queryKey: rbacKeys.roleList(type, search),
    queryFn: ({ signal }) => fetchRoles(type, search, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

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
          {me.can('platform.permission.manage') && (
            <Link href="/admin/permissions" className={pillLink('secondary')}>
              <LockIcon />
              {t('managePermissions')}
            </Link>
          )}
          <Link href="/admin/roles/new" className={pillLink('primary')}>
            <PlusIcon />
            {t('addRole')}
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

  const { data, kpis } = q.data;
  const filtering = type !== 'all' || search !== '';
  return (
    <div className="space-y-5">
      {header}

      <section
        aria-label={t('kpi.label')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        data-testid="role-kpis"
      >
        <Kpi
          label={t('kpi.total')}
          value={kpis.totalRoles}
          hint={t('kpi.totalHint', { system: kpis.systemRoles, custom: kpis.customRoles })}
        />
        <Kpi
          label={t('kpi.permissions')}
          value={kpis.totalPermissions}
          hint={t('kpi.permissionsHint')}
        />
        <Kpi label={t('kpi.users')} value={kpis.usersWithRole} hint={t('kpi.usersHint')} />
        <Kpi
          tone="warning"
          label={t('kpi.noUsers')}
          value={kpis.rolesWithoutUsers}
          hint={t('kpi.noUsersHint')}
        />
      </section>

      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-background p-2 shadow-sm">
        <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-1">
          {TYPES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary',
                type === value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`filter.${value}`)}
              {value === 'all' && (
                <span className="font-mono text-xs opacity-80">{kpis.totalRoles}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            maxLength={100}
            aria-label={t('filter.searchLabel')}
            placeholder={t('filter.search')}
            className="h-9 rounded-full ps-9 text-xs"
          />
        </div>
      </div>

      <RolesTable
        roles={data}
        total={kpis.totalRoles}
        totalPermissions={kpis.totalPermissions}
        busy={q.isPlaceholderData}
        filtering={filtering}
        onClear={() => {
          setType('all');
          setSearchInput('');
        }}
      />
    </div>
  );
}

function RolesTable({
  roles,
  total,
  totalPermissions,
  busy,
  filtering,
  onClear,
}: {
  roles: PlatformRoleSummary[];
  total: number;
  totalPermissions: number;
  busy: boolean;
  filtering: boolean;
  onClear: () => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions.common.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<PlatformRoleSummary | null>(null);

  const remove = useMutation({
    mutationFn: (role: PlatformRoleSummary) => deleteRole(role.id),
    onSuccess: async (res) => {
      toast.success(t('toasts.deleted', { name: res.name }));
      setDeleting(null);
      await qc.invalidateQueries({ queryKey: rbacKeys.roles });
    },
  });
  const removeInfo = remove.error ? rbacError(remove.error, 'delete') : null;

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-background shadow-sm transition-opacity',
        busy && 'opacity-60',
      )}
      aria-busy={busy}
    >
      {roles.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {filtering && total > 0 ? (
            <div className="space-y-3">
              <p>{t('empty.noMatch')}</p>
              <Button variant="secondary" size="sm" onClick={onClear}>
                {t('empty.clear')}
              </Button>
            </div>
          ) : (
            <p>
              {t.rich('empty.none', {
                link: (chunks) => (
                  <Link
                    href="/admin/roles/new"
                    className="font-semibold text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
        </div>
      ) : (
        <>
          <table className="hidden w-full table-fixed text-sm xl:table">
            <caption className="sr-only">{t('table.caption')}</caption>
            <thead className="border-b border-border bg-muted text-muted-foreground [&_th:first-child]:rounded-ss-2xl [&_th:last-child]:rounded-se-2xl">
              <tr>
                <th scope="col" className="w-12 px-4 py-2.5 text-start font-medium">
                  {t('table.index')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">
                  {t('table.name')}
                </th>
                <th scope="col" className="w-28 px-3 py-2.5 text-start font-medium">
                  {t('table.type')}
                </th>
                <th scope="col" className="w-24 px-3 py-2.5 text-start font-medium">
                  {t('table.users')}
                </th>
                <th scope="col" className="w-40 px-3 py-2.5 text-start font-medium">
                  {t('table.permissions')}
                </th>
                <th scope="col" className="w-36 px-3 py-2.5 text-start font-medium">
                  {t('table.lastEdited')}
                </th>
                <th scope="col" className="w-16 px-3 py-2.5">
                  <span className="sr-only">{t('table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role, i) => (
                <tr
                  key={role.id}
                  data-testid={`role-row-${role.name}`}
                  className="hover:bg-muted/50"
                >
                  <td className="px-4 py-3 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-3">
                    <RoleName role={role} />
                  </td>
                  <td className="px-3 py-3">
                    <TypeBadge system={role.isSystem} />
                  </td>
                  <td className="px-3 py-3 font-mono text-xs" data-testid="role-users">
                    {role.userCount}
                  </td>
                  <td className="px-3 py-3">
                    <PermissionBar count={role.permissionCount} total={totalPermissions} />
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {role.updatedAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <RowMenu role={role} onDelete={() => (remove.reset(), setDeleting(role))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-border xl:hidden" aria-label={t('table.caption')}>
            {roles.map((role) => (
              <li
                key={role.id}
                data-testid={`role-card-${role.name}`}
                className="space-y-3 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <RoleName role={role} />
                  <RowMenu role={role} onDelete={() => (remove.reset(), setDeleting(role))} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">{t('table.type')}</dt>
                    <dd className="mt-0.5">
                      <TypeBadge system={role.isSystem} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('table.users')}</dt>
                    <dd className="mt-0.5 font-mono">{role.userCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('table.lastEdited')}</dt>
                    <dd className="mt-0.5 font-mono">{role.updatedAt.slice(0, 10)}</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <dt className="text-muted-foreground">{t('table.permissions')}</dt>
                    <dd className="mt-0.5">
                      <PermissionBar count={role.permissionCount} total={totalPermissions} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-4 py-3">
        <div className="font-mono text-xs text-muted-foreground" aria-live="polite">
          {t('footer.showing', { shown: roles.length, total })}
        </div>
        <Link
          href="/admin/roles/new"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          {t('footer.add')}
        </Link>
      </div>

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

function RoleName({ role }: { role: PlatformRoleSummary }) {
  const t = useTranslations(NS);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground">
        <ShieldIcon />
      </span>
      <div className="min-w-0">
        <div className="truncate font-semibold leading-tight">{role.name}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {role.isSystem ? t('systemRole') : t('customRole')}
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ system }: { system: boolean }) {
  const t = useTranslations(NS);
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
        system ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
      )}
    >
      {system ? t('systemBadge') : t('customBadge')}
    </span>
  );
}

/** "n / total" with a thin bar of the rounded percentage, as Reference's Permissions column. */
function PermissionBar({ count, total }: { count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <span dir="ltr" className="inline-block font-mono text-xs text-primary">
        {count} / {total}
      </span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Edit role, and Delete unless the role is locked (Super Admin only offers "Edit role"). */
function RowMenu({ role, onDelete }: { role: PlatformRoleSummary; onDelete: () => void }) {
  const t = useTranslations(NS);
  const router = useRouter();
  return (
    <Menu
      label={t('row.menu', { name: role.name })}
      align="end"
      className="min-w-44 whitespace-nowrap"
      triggerClassName="size-8 rounded-full border-transparent px-0"
      triggerProps={{ 'aria-label': t('row.menu', { name: role.name }) }}
      trigger={<DotsIcon className="size-4 text-muted-foreground" />}
    >
      <MenuItem onSelect={() => router.push(`/admin/roles/${role.id}`)}>
        <EditIcon className="text-muted-foreground" />
        {t('row.edit')}
      </MenuItem>
      {!role.isLocked && (
        <>
          <MenuSeparator />
          <MenuItem danger onSelect={onDelete}>
            <TrashIcon />
            {t('row.delete')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
