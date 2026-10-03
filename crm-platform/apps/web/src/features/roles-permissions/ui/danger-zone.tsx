'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlatformRoleDetail } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Select, Spinner } from '@crm/ui';
import { useToast } from '../../auth-registration-security/platform/ui/toast';
import { deleteRole, duplicateRole, rbacKeys, reassignRole } from '../lib/api';
import { rbacError } from '../lib/errors';
import { SectionBadge } from './chrome';

const NS = 'roles-permissions.dangerZone';

/** Section 03 of the role editor (hidden for a locked role): Duplicate, Reassign all users, Delete. */
export function DangerZone({
  role,
  confirmLeave,
}: {
  role: PlatformRoleDetail;
  /** Asks before leaving the page when the form holds unsaved edits; returns whether to go on. */
  confirmLeave: () => boolean;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions.common.errors');
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const duplicate = useMutation({
    mutationFn: () => duplicateRole(role.id),
    onSuccess: async (copy) => {
      await qc.invalidateQueries({ queryKey: rbacKeys.roles });
      router.push(`/admin/roles/${copy.id}?duplicated=1`);
    },
  });

  const reassign = useMutation({
    mutationFn: () => reassignRole(role.id, { targetRoleId: target }),
    onSuccess: async (res) => {
      toast.success(t('moved', { count: res.moved, from: res.from, to: res.to }));
      setTarget('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: rbacKeys.roles }),
        qc.invalidateQueries({ queryKey: rbacKeys.staff }),
      ]);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRole(role.id),
    onSuccess: async (res) => {
      toast.success(t('deleted', { name: res.name }));
      setConfirmDelete(false);
      // Refresh the lists before going back, but not this role's own query: it would answer 404 now.
      await qc.invalidateQueries({
        queryKey: rbacKeys.roles,
        predicate: (q) => q.queryKey[3] !== 'one',
      });
      router.push('/admin/roles');
    },
  });

  const failure = duplicate.error ?? reassign.error;
  const failureInfo = failure ? rbacError(failure) : null;
  const removeInfo = remove.error ? rbacError(remove.error, 'delete') : null;

  return (
    <section
      aria-labelledby="danger-title"
      className="rounded-2xl border border-danger/30 bg-background p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <SectionBadge n="03" tone="danger" />
        <h2 id="danger-title" className="text-lg font-semibold leading-none">
          {t('title')}
        </h2>
        <span className="ms-auto font-mono text-[10px] text-danger">{t('irreversible')}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('duplicate.title')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t('duplicate.hint')}</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={duplicate.isPending}
            onClick={() => {
              if (!confirmLeave()) return;
              duplicate.mutate();
            }}
          >
            {duplicate.isPending && <Spinner label={t('duplicate.busy')} />}
            {t('duplicate.action')}
          </Button>
        </div>

        <form
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (target && !reassign.isPending) reassign.mutate();
          }}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('reassign.title')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('reassign.hint', { count: role.userCount })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              aria-label={t('reassign.targetLabel')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 w-auto max-w-40 px-2 text-xs"
              required
            >
              <option value="">{t('reassign.placeholder')}</option>
              {role.otherRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="rounded-full"
              disabled={!target || reassign.isPending}
            >
              {reassign.isPending && <Spinner label={t('reassign.busy')} />}
              {t('reassign.action')}
            </Button>
          </div>
        </form>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-danger">{t('delete.title')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t('delete.hint')}</div>
          </div>
          <Button
            variant="danger"
            size="sm"
            className="rounded-full"
            onClick={() => {
              remove.reset();
              setConfirmDelete(true);
            }}
          >
            {t('delete.action')}
          </Button>
        </div>
      </div>

      {failureInfo && (
        <Alert tone="danger" className="mt-3">
          {te(failureInfo.key, failureInfo.values)}
        </Alert>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t('delete.dialogTitle')}
        message={
          <div className="space-y-3">
            <p>{t('delete.dialogMessage', { name: role.name })}</p>
            {removeInfo && <Alert tone="danger">{te(removeInfo.key, removeInfo.values)}</Alert>}
          </div>
        }
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </section>
  );
}
