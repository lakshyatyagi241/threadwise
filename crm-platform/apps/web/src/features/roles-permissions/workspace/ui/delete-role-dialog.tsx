'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoleResponse } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Modal } from '@crm/ui';
import { deleteRole, wsKeys } from '../lib/api';
import { wsError } from '../lib/errors';

const NS = 'roles-permissions-workspace.delete';

/**
 * Delete a custom role. A role that still has members cannot be deleted: the dialog says so and links to the members
 * page filtered by that role (the server refuses it too, RBAC_ROLE_IN_USE, for a stale count).
 */
export function DeleteRoleDialog({
  role,
  onClose,
  onDeleted,
}: {
  role: RoleResponse | null;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (r: RoleResponse) => deleteRole(r.id),
    onSuccess: async (_d, r) => {
      await qc.invalidateQueries({ queryKey: wsKeys.roles });
      await qc.invalidateQueries({ queryKey: wsKeys.users });
      onDeleted(r.name);
    },
  });
  const reset = remove.reset;
  useEffect(() => reset(), [role?.id, reset]);

  const info = remove.error ? wsError(remove.error) : null;
  const inUse = role !== null && (role.userCount > 0 || info?.key === 'roleInUse');

  if (inUse && role) {
    return (
      <Modal
        open
        onClose={onClose}
        title={t('inUseTitle', { name: role.name })}
        closeLabel={t('cancel')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Link
              href={`/settings/team?role=${role.id}`}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('viewMembers')}
            </Link>
          </>
        }
      >
        <p className="text-sm text-muted-foreground" data-testid="role-in-use">
          {t('inUse', { count: role.userCount })}
        </p>
      </Modal>
    );
  }

  return (
    <ConfirmDialog
      open={role !== null}
      title={t('title')}
      message={
        <div className="space-y-3">
          <p>{t('message', { name: role?.name ?? '' })}</p>
          {info && <Alert tone="danger">{te(info.key, info.values)}</Alert>}
        </div>
      }
      confirmLabel={t('confirm')}
      cancelLabel={t('cancel')}
      tone="danger"
      busy={remove.isPending}
      onConfirm={() => role && !remove.isPending && remove.mutate(role)}
      onClose={onClose}
    />
  );
}
