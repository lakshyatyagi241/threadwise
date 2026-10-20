'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoleResponse, UserResponse } from '@crm/contracts';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { updateUser, wsKeys } from '../lib/api';
import { wsError, type WsError } from '../lib/errors';
import { noTeamMeetsTeamScope, presetSlug, rolesChanged } from '../lib/members';

const NS = 'roles-permissions-workspace.team.changeRole';

/** Replaces a member's roles with the ticked set (only roles the caller may grant are listed). */
export function ChangeRoleModal({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: UserResponse;
  roles: readonly RoleResponse[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const tc = useTranslations('roles-permissions-workspace.common');
  const tr = useTranslations('roles-permissions-workspace.blurb');
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>(() => member.roles.map((r) => r.id));
  const [error, setError] = useState<WsError | null>(null);

  const save = useMutation({
    mutationFn: (m: UserResponse) =>
      updateUser(m.id, { roleIds: selected, rowVersion: m.rowVersion }),
    onSuccess: async (user) => {
      await qc.invalidateQueries({ queryKey: wsKeys.users });
      await qc.invalidateQueries({ queryKey: wsKeys.roles });
      onSaved(user.fullName);
    },
    onError: (err) => setError(wsError(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending || selected.length === 0) return;
    setError(null);
    save.mutate(member);
  }

  const changed = rolesChanged(member.roles, selected);
  // Roles the member holds that the caller cannot hand out would be dropped by a replacement: keep them visible, locked.
  const lockedRoles = member.roles.filter((r) => !roles.some((x) => x.id === r.id));
  // A role set to a team scope shows a person in no team only their own records (BL-382): say so before the roles are handed out.
  const teamScoped = noTeamMeetsTeamScope(member.teams.length, roles, selected);

  return (
    <Modal
      open
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      title={t('title', { name: member.fullName })}
      closeLabel={tc('close')}
    >
      <form onSubmit={submit} className="space-y-3" data-testid="change-role-form">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">{t('legend')}</legend>
          {roles.map((r) => {
            const slug = presetSlug(r.systemKey);
            return (
              <label
                key={r.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected((cur) =>
                      e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id),
                    )
                  }
                  className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{r.name}</span>
                  {slug && <span className="block text-xs text-muted-foreground">{tr(slug)}</span>}
                </span>
              </label>
            );
          })}
          {lockedRoles.map((r) => (
            <p key={r.id} className="text-xs text-muted-foreground">
              {t('keptRole', { name: r.name })}
            </p>
          ))}
        </fieldset>
        {selected.length === 0 && <p className="text-xs text-danger">{t('atLeastOne')}</p>}
        {teamScoped && (
          <Alert tone="warning" data-testid="change-role-no-team">
            <p>{t('noTeamWarning', { name: member.fullName })}</p>
          </Alert>
        )}
        {error && (
          <Alert
            tone={error.kind === 'conflict' ? 'warning' : 'danger'}
            data-testid="change-role-error"
            data-code={error.key}
          >
            <p>{te(error.key, error.values)}</p>
          </Alert>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          {error?.kind === 'conflict' ? (
            <Button
              onClick={async () => {
                await qc.invalidateQueries({ queryKey: wsKeys.users });
                onClose();
              }}
            >
              {t('reload')}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={save.isPending || !changed || selected.length === 0}
              data-testid="submit-change-role"
            >
              {save.isPending && <Spinner label={tc('loading')} />}
              {t('save')}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
