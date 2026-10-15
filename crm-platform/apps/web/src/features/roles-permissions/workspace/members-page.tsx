'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RoleResponse, UserResponse } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, Input, cn, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { RbacHeader } from '../ui/chrome';
import { PlusIcon, SearchIcon } from '../ui/icons';
import { fetchRoles, fetchUsers, updateUser, wsKeys } from './lib/api';
import { wsError, type WsError } from './lib/errors';
import {
  canChangeMemberRoles,
  filterMembers,
  grantableRoles,
  presetSlug,
  roleFilterCounts,
  sortRoles,
} from './lib/members';
import { AddMemberModal } from './ui/add-member-modal';
import { ChangeRoleModal } from './ui/change-role-modal';
import { LoadingBlock, PermissionGate, QueryError } from './ui/states';

const NS = 'roles-permissions-workspace.team';

/** /settings/team */
export function WorkspaceMembersPage() {
  return (
    <PermissionGate permission="admin.user.manage">
      <MembersScreen />
    </PermissionGate>
  );
}

type ChipRole = Pick<RoleResponse, 'id' | 'name' | 'systemKey'>;

function MembersScreen() {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions-workspace.common');
  const te = useTranslations('roles-permissions-workspace.errors');
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canInvite = useCan('org.member.invite');
  const canAssign = useCan('org.member.role_assign');
  const params = useSearchParams();

  const [roleId, setRoleId] = useState<string | null>(params.get('role'));
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [deactivating, setDeactivating] = useState<UserResponse | null>(null);
  const [failure, setFailure] = useState<WsError | null>(null);

  const users = useQuery({
    queryKey: wsKeys.users,
    queryFn: ({ signal }) => fetchUsers(signal),
    refetchOnWindowFocus: false,
  });
  // Listing roles needs admin.role.manage: without it the screen still works, minus the picker.
  const roles = useQuery({
    queryKey: wsKeys.roles,
    queryFn: ({ signal }) => fetchRoles(signal),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const members = users.data;
  const roleList: RoleResponse[] | null = roles.data ?? null;
  const chipRoles: ChipRole[] = useMemo(() => {
    if (roleList) return sortRoles(roleList);
    const seen = new Map<string, ChipRole>();
    for (const m of members ?? [])
      for (const r of m.roles) seen.set(r.id, { ...r, systemKey: null });
    return sortRoles([...seen.values()]);
  }, [roleList, members]);
  const counts = useMemo(() => roleFilterCounts(members ?? []), [members]);
  const shown = useMemo(
    () => filterMembers(members ?? [], { roleId, search }),
    [members, roleId, search],
  );
  const grantable = roleList ? grantableRoles(sortRoles(roleList)) : [];

  const status = useMutation({
    mutationFn: ({ user, next }: { user: UserResponse; next: 'active' | 'inactive' }) =>
      updateUser(user.id, { status: next, rowVersion: user.rowVersion }),
    onSuccess: async (saved) => {
      setFailure(null);
      setDeactivating(null);
      toast.toast(
        t(saved.status === 'active' ? 'toasts.reactivated' : 'toasts.deactivated', {
          name: saved.fullName,
        }),
        'success',
      );
      await qc.invalidateQueries({ queryKey: wsKeys.users });
    },
    onError: (err) => {
      setDeactivating(null);
      setFailure(wsError(err));
    },
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
        canInvite && grantable.length > 0 ? (
          <Button className="rounded-full" onClick={() => setAdding(true)} data-testid="add-member">
            <PlusIcon />
            {t('addMember')}
          </Button>
        ) : undefined
      }
    />
  );

  if (users.isPending) {
    return (
      <div className="space-y-5">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (users.isError) {
    return (
      <div className="space-y-5">
        {header}
        <QueryError error={users.error} onRetry={() => void users.refetch()} />
      </div>
    );
  }

  const chips: Array<{ id: string | null; label: string; count: number }> = [
    { id: null, label: t('filter.all'), count: counts.all },
    ...chipRoles.map((r) => {
      const slug = presetSlug(r.systemKey);
      return {
        id: r.id,
        label: slug ? t(`filter.preset.${slug}`) : r.name,
        count: counts.byRole.get(r.id) ?? 0,
      };
    }),
  ];

  const toggleStatus = (user: UserResponse) => {
    const next = user.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive') setDeactivating(user);
    else {
      setFailure(null);
      status.mutate({ user, next });
    }
  };

  return (
    <div className="space-y-5">
      {header}

      {failure && (
        <Alert
          tone={failure.kind === 'conflict' ? 'warning' : 'danger'}
          className="flex flex-wrap items-center justify-between gap-3"
          data-testid="member-error"
          data-code={failure.key}
        >
          <div className="space-y-1">
            <p>{te(failure.key, failure.values)}</p>
          </div>
          <div className="flex gap-2">
            {failure.kind === 'conflict' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFailure(null);
                  void users.refetch();
                }}
              >
                {t('reload')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setFailure(null)}>
              {tc('dismiss')}
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-background p-2 shadow-sm">
        <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <button
              key={c.id ?? 'all'}
              type="button"
              aria-pressed={roleId === c.id}
              data-testid={`chip-${c.id ?? 'all'}`}
              onClick={() => setRoleId(c.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary',
                roleId === c.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.label}
              <span className="font-mono text-xs opacity-80">{c.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            className="h-9 rounded-full ps-9 text-xs"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-background shadow-sm">
        {shown.length === 0 ? (
          <div className="space-y-3 px-4 py-10 text-center text-sm text-muted-foreground">
            <p>{members && members.length > 0 ? t('empty.noMatch') : t('empty.none')}</p>
            {members && members.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRoleId(null);
                  setSearch('');
                }}
              >
                {t('empty.clear')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <table
              className="hidden w-full table-fixed text-sm xl:table"
              data-testid="members-table"
            >
              <caption className="sr-only">{t('table.caption')}</caption>
              <thead className="border-b border-border bg-muted text-muted-foreground [&_th:first-child]:rounded-ss-2xl [&_th:last-child]:rounded-se-2xl">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-medium">
                    {t('table.member')}
                  </th>
                  <th scope="col" className="w-64 px-3 py-2.5 text-start font-medium">
                    {t('table.roles')}
                  </th>
                  <th scope="col" className="w-28 px-3 py-2.5 text-start font-medium">
                    {t('table.status')}
                  </th>
                  <th scope="col" className="w-72 px-3 py-2.5 text-end font-medium">
                    {t('table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((m) => (
                  <tr
                    key={m.id}
                    data-testid={`member-row-${m.email}`}
                    className="hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <Identity member={m} self={m.id === session.user.id} />
                    </td>
                    <td className="px-3 py-3">
                      <RoleChips member={m} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="px-3 py-3">
                      <Actions
                        member={m}
                        self={m.id === session.user.id}
                        canAssign={
                          roleList !== null &&
                          canChangeMemberRoles({
                            isSelf: m.id === session.user.id,
                            member: m,
                            roles: roleList,
                            hasPermission: canAssign,
                          })
                        }
                        busy={status.isPending && status.variables?.user.id === m.id}
                        onRoles={() => setEditing(m)}
                        onStatus={() => toggleStatus(m)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-border xl:hidden" aria-label={t('table.caption')}>
              {shown.map((m) => (
                <li
                  key={m.id}
                  data-testid={`member-card-${m.email}`}
                  className="space-y-3 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Identity member={m} self={m.id === session.user.id} />
                    <StatusBadge status={m.status} />
                  </div>
                  <RoleChips member={m} />
                  <Actions
                    member={m}
                    self={m.id === session.user.id}
                    canAssign={
                      roleList !== null &&
                      canChangeMemberRoles({
                        isSelf: m.id === session.user.id,
                        member: m,
                        roles: roleList,
                        hasPermission: canAssign,
                      })
                    }
                    busy={status.isPending && status.variables?.user.id === m.id}
                    onRoles={() => setEditing(m)}
                    onStatus={() => toggleStatus(m)}
                    start
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <div
          className="rounded-b-2xl border-t border-border bg-muted/40 px-4 py-3 font-mono text-xs text-muted-foreground"
          aria-live="polite"
        >
          {t('footer', { shown: shown.length, total: counts.all })}
        </div>
      </div>

      {roles.isError && (
        <p className="text-xs text-muted-foreground" data-testid="roles-unavailable">
          {t('rolesUnavailable')}
        </p>
      )}

      {adding && (
        <AddMemberModal
          roles={grantable}
          onClose={() => setAdding(false)}
          onCreated={(name, emailSent) => {
            setAdding(false);
            toast.toast(t(emailSent ? 'toasts.invited' : 'toasts.added', { name }), 'success');
          }}
        />
      )}
      {editing && (
        <ChangeRoleModal
          key={editing.id}
          member={editing}
          roles={grantable}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            toast.toast(t('toasts.rolesUpdated', { name }), 'success');
          }}
        />
      )}
      <ConfirmDialog
        open={deactivating !== null}
        title={t('deactivate.title')}
        message={t('deactivate.message', { name: deactivating?.fullName ?? '' })}
        confirmLabel={t('deactivate.confirm')}
        cancelLabel={t('deactivate.cancel')}
        tone="danger"
        busy={status.isPending}
        onConfirm={() =>
          deactivating &&
          !status.isPending &&
          status.mutate({ user: deactivating, next: 'inactive' })
        }
        onClose={() => setDeactivating(null)}
      />
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}

function Identity({ member, self }: { member: UserResponse; self: boolean }) {
  const t = useTranslations(NS);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-foreground"
      >
        {initials(member.fullName) || '?'}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold leading-tight">{member.fullName}</span>
          {self && <Badge className="shrink-0">{t('you')}</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground" dir="auto">
          {member.email}
        </div>
      </div>
    </div>
  );
}

function RoleChips({ member }: { member: UserResponse }) {
  const t = useTranslations(NS);
  if (member.roles.length === 0)
    return <span className="text-xs text-muted-foreground">{t('noRole')}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {member.roles.map((r) => (
        <span
          key={r.id}
          className="inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
        >
          {r.name}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: UserResponse['status'] }) {
  const t = useTranslations(NS);
  return (
    <Badge tone={status === 'active' ? 'success' : 'neutral'} data-testid="member-status">
      {t(`status.${status}`)}
    </Badge>
  );
}

function Actions({
  member,
  self,
  canAssign,
  busy,
  onRoles,
  onStatus,
  start,
}: {
  member: UserResponse;
  self: boolean;
  canAssign: boolean;
  busy: boolean;
  onRoles: () => void;
  onStatus: () => void;
  start?: boolean;
}) {
  const t = useTranslations(NS);
  const active = member.status === 'active';
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', start ? 'justify-start' : 'justify-end')}
    >
      <Button
        size="sm"
        variant="secondary"
        className="rounded-full"
        disabled={!canAssign}
        title={self ? t('selfRoleHint') : !canAssign ? t('roleLockedHint') : undefined}
        onClick={onRoles}
        data-testid={`change-role-${member.email}`}
      >
        {t('changeRoleAction')}
      </Button>
      <Button
        size="sm"
        variant={active ? 'secondary' : 'primary'}
        className="rounded-full"
        disabled={busy || (self && active)}
        title={self && active ? t('selfDeactivateHint') : undefined}
        onClick={onStatus}
        data-testid={`toggle-status-${member.email}`}
      >
        {active ? t('deactivate.action') : t('reactivate')}
      </Button>
    </div>
  );
}
