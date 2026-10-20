'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RoleResponse } from '@crm/contracts';
import { Menu, MenuItem, MenuSeparator, cn, useToast } from '@crm/ui';
import { RbacHeader, pillLink } from '../ui/chrome';
import { DotsIcon, EditIcon, LockIcon, PlusIcon, ShieldIcon, TrashIcon } from '../ui/icons';
import { usePlanFeature } from '@/lib/plan-features';
import { fetchRoles, wsKeys } from './lib/api';
import { sortRoles } from './lib/members';
import { DeleteRoleDialog } from './ui/delete-role-dialog';
import { LoadingBlock, PermissionGate, QueryError } from './ui/states';

const NS = 'roles-permissions-workspace.list';

/** /settings/roles */
export function WorkspaceRolesPage() {
  return (
    <PermissionGate permission="admin.role.manage">
      <RolesList />
    </PermissionGate>
  );
}

function RolesList() {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions-workspace.common');
  const toast = useToast();
  const customRolesOn = usePlanFeature('custom_roles');
  const [deleting, setDeleting] = useState<RoleResponse | null>(null);
  const q = useQuery({
    queryKey: wsKeys.roles,
    queryFn: ({ signal }) => fetchRoles(signal),
    refetchOnWindowFocus: false,
  });

  const header = (
    <RbacHeader
      crumbsLabel={tc('breadcrumb')}
      crumbs={[{ label: tc('settings') }, { label: t('crumb') }]}
      eyebrow={t('eyebrow')}
      lead={t('titleLead')}
      accent={t('titleAccent')}
      description={t('description')}
      actions={
        <>
          <Link href="/settings/team" className={pillLink('secondary')}>
            {t('teamLink')}
          </Link>
          {customRolesOn ? (
            <Link href="/settings/roles/new" className={pillLink('primary')} data-testid="add-role">
              <PlusIcon />
              {t('addRole')}
            </Link>
          ) : (
            <Link
              href="/account/plans"
              className={pillLink('secondary')}
              data-testid="add-role-locked"
              title={t('customRolesLocked')}
            >
              <LockIcon className="size-3.5" />
              {t('addRoleLocked')}
            </Link>
          )}
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

  const roles = sortRoles(q.data);
  return (
    <div className="space-y-5">
      {header}
      <div className="rounded-2xl border border-border bg-background shadow-sm">
        {roles.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <table className="hidden w-full table-fixed text-sm xl:table" data-testid="roles-table">
              <caption className="sr-only">{t('table.caption')}</caption>
              <thead className="border-b border-border bg-muted text-muted-foreground [&_th:first-child]:rounded-ss-2xl [&_th:last-child]:rounded-se-2xl">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    {t('table.name')}
                  </th>
                  <th scope="col" className="w-44 px-3 py-2.5 text-start font-medium">
                    {t('table.type')}
                  </th>
                  <th scope="col" className="w-24 px-3 py-2.5 text-start font-medium">
                    {t('table.members')}
                  </th>
                  <th scope="col" className="w-32 px-3 py-2.5 text-start font-medium">
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
                {roles.map((role) => (
                  <tr
                    key={role.id}
                    data-testid={`role-row-${role.name}`}
                    className="hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <RoleName role={role} />
                    </td>
                    <td className="px-3 py-3">
                      <Badges role={role} />
                    </td>
                    <td className="px-3 py-3">
                      <MemberCount role={role} />
                    </td>
                    <td className="px-3 py-3 font-mono text-xs" data-testid="role-perms">
                      {role.grants.length}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      <Edited value={role.updatedAt} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <RowMenu role={role} onDelete={() => setDeleting(role)} />
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
                    <RowMenu role={role} onDelete={() => setDeleting(role)} />
                  </div>
                  <Badges role={role} />
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t('table.members')}</dt>
                      <dd className="mt-0.5">
                        <MemberCount role={role} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('table.permissions')}</dt>
                      <dd className="mt-0.5 font-mono">{role.grants.length}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('table.lastEdited')}</dt>
                      <dd className="mt-0.5 font-mono">
                        <Edited value={role.updatedAt} />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="rounded-b-2xl border-t border-border bg-muted/40 px-4 py-3 font-mono text-xs text-muted-foreground">
          {t('footer', { count: roles.length })}
        </div>
      </div>

      <DeleteRoleDialog
        role={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(name) => {
          setDeleting(null);
          toast.toast(t('toasts.deleted', { name }), 'success');
        }}
      />
    </div>
  );
}

function Edited({ value }: { value: string }) {
  const f = useFormatter();
  return <>{f.dateTime(new Date(value), { dateStyle: 'medium' })}</>;
}

function RoleName({ role }: { role: RoleResponse }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-brand-foreground">
        <ShieldIcon />
      </span>
      <Link
        href={`/settings/roles/${role.id}`}
        className="min-w-0 truncate font-semibold leading-tight hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {role.name}
      </Link>
    </div>
  );
}

function Badges({ role }: { role: RoleResponse }) {
  const t = useTranslations(NS);
  const owner = role.isLocked || role.systemKey === 'admin';
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={cn(
          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
          role.isPreset ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {role.isPreset ? t('preset') : t('custom')}
      </span>
      {owner && (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
          <LockIcon className="size-3" />
          {t('locked')}
        </span>
      )}
    </div>
  );
}

function MemberCount({ role }: { role: RoleResponse }) {
  const t = useTranslations(NS);
  if (role.userCount === 0) return <span className="font-mono text-xs">0</span>;
  return (
    <Link
      href={`/settings/team?role=${role.id}`}
      aria-label={t('membersLink', { name: role.name, count: role.userCount })}
      className="font-mono text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
    >
      {role.userCount}
    </Link>
  );
}

function RowMenu({ role, onDelete }: { role: RoleResponse; onDelete: () => void }) {
  const t = useTranslations(NS);
  const router = useRouter();
  const canEdit = role.editable && !role.isLocked;
  return (
    <Menu
      label={t('row.menu', { name: role.name })}
      align="end"
      className="min-w-44 whitespace-nowrap"
      triggerClassName="size-8 rounded-full border-transparent px-0"
      triggerProps={{ 'aria-label': t('row.menu', { name: role.name }) }}
      trigger={<DotsIcon className="size-4 text-muted-foreground" />}
    >
      <MenuItem onSelect={() => router.push(`/settings/roles/${role.id}`)}>
        <EditIcon className="text-muted-foreground" />
        {canEdit ? t('row.edit') : t('row.view')}
      </MenuItem>
      {!role.isPreset && (
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
