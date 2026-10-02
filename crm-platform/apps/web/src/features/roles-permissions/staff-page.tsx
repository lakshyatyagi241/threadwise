'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformStaff } from '@crm/contracts';
import { Alert, Badge, Button, Card, Checkbox, Modal, Spinner } from '@crm/ui';
import { useToast } from '../auth-registration-security/platform/ui/toast';
import { fetchRoles, fetchStaff, rbacKeys, setStaffRoles } from './lib/api';
import { rbacError } from './lib/errors';
import { AccessGate } from './ui/access';
import { RbacHeader, pillLink } from './ui/chrome';
import { ShieldIcon } from './ui/icons';
import { LoadingBlock, QueryError } from './ui/states';

const NS = 'roles-permissions.staff';
const TIER_TONE = { super_admin: 'success', support: 'neutral', auditor: 'neutral' } as const;

/** /admin/roles/staff (WD-RBAC-021: the role picker WaDesk's docs promise and its Users screen never had). */
export function StaffPage() {
  return (
    <AccessGate permission="platform.role.manage">
      {(me) => <StaffList isSuperAdmin={me.isSuperAdmin} />}
    </AccessGate>
  );
}

function StaffList({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions.common');
  const [assigning, setAssigning] = useState<PlatformStaff | null>(null);

  const staff = useQuery({
    queryKey: rbacKeys.staff,
    queryFn: ({ signal }) => fetchStaff(signal),
    refetchOnWindowFocus: false,
  });
  // The role list says which roles are locked (only a Super Admin may grant or revoke those).
  const roles = useQuery({
    queryKey: rbacKeys.roleList('all', ''),
    queryFn: ({ signal }) => fetchRoles('all', '', signal),
    refetchOnWindowFocus: false,
  });

  const header = (
    <RbacHeader
      crumbsLabel={tc('breadcrumb')}
      crumbs={[
        { label: tc('admin'), href: '/admin' },
        { label: t('crumbRoles'), href: '/admin/roles' },
        { label: t('crumb') },
      ]}
      eyebrow={t('eyebrow')}
      lead={t('titleLead')}
      accent={t('titleAccent')}
      description={t('description')}
      actions={
        <Link href="/admin/roles" className={pillLink('secondary')}>
          <ShieldIcon />
          {t('backToRoles')}
        </Link>
      }
    />
  );

  if (staff.isPending) {
    return (
      <div className="space-y-5">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (staff.isError) {
    return (
      <div className="space-y-5">
        {header}
        <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
      </div>
    );
  }

  const lockedIds = new Set((roles.data?.data ?? []).filter((r) => r.isLocked).map((r) => r.id));
  const { data, roles: allRoles } = staff.data;

  const roleChips = (s: PlatformStaff) =>
    s.roles.length === 0 ? (
      <span className="text-xs text-muted-foreground">{t('noRoles')}</span>
    ) : (
      <ul className="flex flex-wrap gap-1.5" aria-label={t('rolesOf', { name: s.fullName })}>
        {s.roles.map((r) => (
          <li key={r.id}>
            <Badge tone={lockedIds.has(r.id) ? 'success' : 'neutral'}>{r.name}</Badge>
          </li>
        ))}
      </ul>
    );

  const identity = (s: PlatformStaff) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
      >
        {s.fullName.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="truncate font-semibold leading-tight">{s.fullName}</div>
        <div className="truncate text-xs text-muted-foreground">{s.email}</div>
      </div>
    </div>
  );

  const assignButton = (s: PlatformStaff) => (
    <Button
      variant="secondary"
      size="sm"
      className="rounded-full"
      aria-label={t('assignFor', { name: s.fullName })}
      onClick={() => setAssigning(s)}
    >
      {t('assign')}
    </Button>
  );

  const tierBadge = (s: PlatformStaff) => (
    <Badge tone={TIER_TONE[s.tier]}>{t(`tier.${s.tier}`)}</Badge>
  );
  const statusBadge = (s: PlatformStaff) => (
    <Badge tone={s.status === 'active' ? 'success' : 'warning'}>{t(`status.${s.status}`)}</Badge>
  );

  return (
    <div className="space-y-5">
      {header}

      {data.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{t('empty')}</Card>
      ) : (
        <>
          <Card className="hidden p-0 lg:block">
            <table className="w-full text-sm" data-testid="staff-table">
              <caption className="sr-only">{t('caption')}</caption>
              <thead className="border-b border-border bg-muted text-muted-foreground">
                <tr>
                  {(['operator', 'tier', 'status', 'roles'] as const).map((col) => (
                    <th key={col} scope="col" className="px-4 py-2.5 text-start font-medium">
                      {t(`table.${col}`)}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">{t('table.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((s) => (
                  <tr key={s.id} data-testid={`staff-row-${s.email}`} className="hover:bg-muted/50">
                    <td className="px-4 py-3">{identity(s)}</td>
                    <td className="px-4 py-3">{tierBadge(s)}</td>
                    <td className="px-4 py-3">{statusBadge(s)}</td>
                    <td className="px-4 py-3">{roleChips(s)}</td>
                    <td className="px-4 py-3 text-end">{assignButton(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className="space-y-3 lg:hidden" aria-label={t('caption')}>
            {data.map((s) => (
              <li key={s.id} data-testid={`staff-card-${s.email}`}>
                <Card className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    {identity(s)}
                    {assignButton(s)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tierBadge(s)}
                    {statusBadge(s)}
                  </div>
                  {roleChips(s)}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {assigning && (
        <AssignRolesDialog
          key={assigning.id}
          staff={assigning}
          roles={allRoles}
          lockedIds={lockedIds}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  );
}

function AssignRolesDialog({
  staff,
  roles,
  lockedIds,
  isSuperAdmin,
  onClose,
}: {
  staff: PlatformStaff;
  roles: Array<{ id: string; name: string }>;
  lockedIds: ReadonlySet<string>;
  isSuperAdmin: boolean;
  onClose: () => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions.common.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(staff.roles.map((r) => r.id)),
  );

  const save = useMutation({
    mutationFn: () => setStaffRoles(staff.id, { roleIds: [...picked] }),
    onSuccess: async (saved) => {
      toast.success(t('toasts.saved', { name: saved.fullName }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: rbacKeys.staff }),
        qc.invalidateQueries({ queryKey: rbacKeys.roles }),
      ]);
      onClose();
    },
  });
  const info = save.error ? rbacError(save.error) : null;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      open
      onClose={() => !save.isPending && onClose()}
      size="md"
      eyebrow={staff.email}
      title={t('dialog.title', { name: staff.fullName })}
      closeLabel={t('dialog.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner label={t('dialog.saving')} />}
            {t('dialog.save')}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-muted-foreground">{t('dialog.hint')}</legend>
        {roles.map((r) => {
          const restricted = lockedIds.has(r.id) && !isSuperAdmin;
          return (
            <div key={r.id} className="rounded-md border border-border px-3 py-2">
              <Checkbox
                id={`staff-role-${r.id}`}
                label={<span className="font-medium">{r.name}</span>}
                checked={picked.has(r.id)}
                disabled={restricted || save.isPending}
                onChange={() => toggle(r.id)}
              />
              {restricted && (
                <p className="ms-6 mt-0.5 text-xs text-muted-foreground">{t('dialog.superOnly')}</p>
              )}
            </div>
          );
        })}
      </fieldset>
      <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
        {t('dialog.count', { count: picked.size })}
      </p>
      {info && (
        <Alert tone="danger" className="mt-3">
          {te(info.key, info.values)}
        </Alert>
      )}
    </Modal>
  );
}
