'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionDefResponse, RoleResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, useToast } from '@crm/ui';
import { RbacHeader, SectionBadge, pillLink } from '../ui/chrome';
import { CheckSmallIcon } from '../ui/icons';
import { createRole, fetchPermissions, fetchRoles, updateRole, wsKeys } from './lib/api';
import { wsError, type WsError } from './lib/errors';
import {
  applyTemplate,
  draftFromGrants,
  grantsFromDraft,
  sameDraft,
  type GrantDraft,
} from './lib/matrix';
import { usePlanFeature } from '@/lib/plan-features';
import { presetSlug, sortRoles } from './lib/members';
import { useUnsavedGuard } from './lib/use-unsaved-guard';
import { DeleteRoleDialog } from './ui/delete-role-dialog';
import { PermissionMatrix } from './ui/permission-matrix';
import { LoadingBlock, PermissionGate, QueryError } from './ui/states';

const NS = 'roles-permissions-workspace.editor';
const FORM_ID = 'workspaceRoleForm';
const NAME_MAX = 120;

/** /settings/roles/new */
export function WorkspaceRoleCreatePage() {
  return (
    <PermissionGate permission="admin.role.manage">
      <EditorLoader roleId={null} />
    </PermissionGate>
  );
}

/** /settings/roles/[id] */
export function WorkspaceRoleEditPage({ roleId }: { roleId: string }) {
  return (
    <PermissionGate permission="admin.role.manage">
      <EditorLoader roleId={roleId} />
    </PermissionGate>
  );
}

/**
 * Reads the catalogue, the roles (for "Start from role") and the list entry of this role, then mounts the form. All
 * of it is read fresh: a stale rowVersion would defeat the optimistic lock.
 */
function EditorLoader({ roleId }: { roleId: string | null }) {
  const [epoch, setEpoch] = useState(0);
  const fresh = { staleTime: 0, refetchOnWindowFocus: false, refetchOnMount: 'always' } as const;
  const catalogue = useQuery({
    queryKey: wsKeys.permissions,
    queryFn: ({ signal }) => fetchPermissions(signal),
    ...fresh,
  });
  const roles = useQuery({
    queryKey: wsKeys.roles,
    queryFn: ({ signal }) => fetchRoles(signal),
    ...fresh,
  });

  const failed = [catalogue, roles].find((q) => q.isError);
  if (failed) {
    return (
      <QueryError
        error={failed.error}
        onRetry={() => void Promise.all([catalogue.refetch(), roles.refetch()])}
      />
    );
  }
  if (!catalogue.data || !roles.data) return <LoadingBlock />;
  const role = roleId ? roles.data.find((r) => r.id === roleId) : null;
  if (roleId && !role) return <NotFound />;
  return (
    <RoleForm
      // A reload after a version conflict remounts the form with what is stored now.
      key={`${roleId ?? 'new'}-${epoch}`}
      role={role ?? null}
      catalogue={catalogue.data}
      templates={sortRoles(roles.data.filter((r) => r.id !== roleId))}
      onReload={async () => {
        await roles.refetch();
        setEpoch((e) => e + 1);
      }}
    />
  );
}

function NotFound() {
  const t = useTranslations(NS);
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg space-y-3 text-center">
      <h1 className="text-lg font-semibold">{t('notFoundTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('notFoundBody')}</p>
      <Link href="/settings/roles" className={pillLink('secondary')}>
        {t('backToRoles')}
      </Link>
    </div>
  );
}

interface FormErrors {
  name?: string;
  server?: WsError;
}

function RoleForm({
  role: loaded,
  catalogue,
  templates,
  onReload,
}: {
  /** The role as read when the form opened (null: creating). Frozen, including its rowVersion. */
  role: RoleResponse | null;
  catalogue: PermissionDefResponse[];
  templates: RoleResponse[];
  onReload: () => Promise<void>;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const tc = useTranslations('roles-permissions-workspace.common');
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [initial] = useState(loaded);
  const editing = initial !== null;
  const slug = presetSlug(initial?.systemKey ?? null);
  const owner = initial !== null && (initial.isLocked || slug === 'owner');
  // Custom roles and scoped permissions are a plan feature (`custom_roles`): without it the roles stay readable, not editable.
  const customRolesOn = usePlanFeature('custom_roles');
  const readOnly = (editing && (owner || !initial.editable)) || !customRolesOn;
  const nameLocked = editing && initial.isPreset;

  const initialDraft = useMemo(() => draftFromGrants(initial?.grants ?? []), [initial]);
  const [name, setName] = useState(initial?.name ?? '');
  const [draft, setDraft] = useState<GrantDraft>(initialDraft);
  const [template, setTemplate] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [leaving, setLeaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = name !== (initial?.name ?? '') || !sameDraft(draft, initialDraft);
  useUnsavedGuard(dirty && !leaving, t('discard'));

  const save = useMutation({
    mutationFn: () => {
      const grants = grantsFromDraft(draft, catalogue);
      // The name is always sent on an update: it makes the row-version check apply to grant-only edits too.
      return initial
        ? updateRole(initial.id, { name: name.trim(), grants, rowVersion: initial.rowVersion })
        : createRole({ name: name.trim(), grants });
    },
    onSuccess: async (saved) => {
      setLeaving(true);
      toast.toast(
        t(editing ? 'toasts.updated' : 'toasts.created', { name: saved.name }),
        'success',
      );
      await qc.invalidateQueries({ queryKey: wsKeys.roles });
      router.push('/settings/roles');
    },
    onError: (err) => {
      const info = wsError(err);
      if (info.field === 'name') {
        setErrors({ name: te('nameTaken') });
        requestAnimationFrame(() => document.getElementById('ws-role-name')?.focus());
      } else {
        setErrors({ server: info });
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending || readOnly) return;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      setErrors({
        name: te(trimmed.length === 0 ? 'nameRequired' : 'nameTooLong', { max: String(NAME_MAX) }),
      });
      document.getElementById('ws-role-name')?.focus();
      return;
    }
    setErrors({});
    save.mutate();
  }

  function pickTemplate(id: string) {
    setTemplate(id);
    const source = templates.find((r) => r.id === id);
    setDraft(
      applyTemplate(
        catalogue.map((d) => d.key),
        source ? source.grants : null,
      ),
    );
  }

  const confirmLeave = () => !dirty || window.confirm(t('discard'));
  const server = errors.server;
  const displayName = initial?.name ?? '';
  const canDelete = editing && !initial.isPreset;

  return (
    <div className="space-y-5">
      <RbacHeader
        crumbsLabel={tc('breadcrumb')}
        crumbs={[
          { label: tc('settings') },
          { label: t('crumbRoles'), href: '/settings/roles' },
          { label: editing ? displayName : t('crumbNew') },
        ]}
        eyebrow={editing ? t('eyebrowEdit') : t('eyebrowNew')}
        lead={editing ? undefined : t('titleLead')}
        accent={editing ? displayName : t('titleAccent')}
        description={editing ? t('summary', { count: initial.userCount }) : t('description')}
        actions={
          <>
            <Link
              href="/settings/roles"
              className={pillLink('secondary')}
              onClick={(e) => {
                if (!confirmLeave()) e.preventDefault();
              }}
            >
              {readOnly ? t('back') : tc('cancel')}
            </Link>
            {!readOnly && (
              <Button
                type="submit"
                form={FORM_ID}
                className="rounded-full"
                disabled={save.isPending}
                data-testid="save-role"
              >
                {save.isPending ? <Spinner label={t('saving')} /> : <CheckSmallIcon />}
                {editing ? t('save') : t('create')}
              </Button>
            )}
          </>
        }
      />

      {owner && (
        <Alert tone="info" data-testid="owner-lock-notice">
          {t('lockedNotice')}
        </Alert>
      )}
      {!customRolesOn && (
        <Alert tone="warning" className="space-y-1" data-testid="custom-roles-locked">
          <p>{t('customRolesLocked')}</p>
          <p>
            <Link href="/account/plans" className="font-semibold underline underline-offset-2">
              {t('upgrade')}
            </Link>
          </p>
        </Alert>
      )}
      {readOnly && !owner && customRolesOn && (
        <Alert tone="info" data-testid="read-only-notice">
          {slug === 'admin' ? t('adminNotice') : t('readOnlyNotice')}
        </Alert>
      )}
      {server?.kind === 'conflict' && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{te('conflict')}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              void onReload().finally(() => setReloading(false));
            }}
          >
            {reloading && <Spinner label={tc('loading')} />}
            {t('reload')}
          </Button>
        </Alert>
      )}
      {server && server.kind !== 'conflict' && (
        <Alert tone="danger" className="space-y-1" data-testid="save-error">
          <p>
            {server.detail && server.field !== 'grants'
              ? server.detail
              : te(server.key, server.values)}
          </p>
        </Alert>
      )}

      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
        <section
          aria-labelledby="ws-details-title"
          className="rounded-2xl border border-border bg-background p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2.5">
            <SectionBadge n="01" />
            <h2 id="ws-details-title" className="text-lg font-semibold leading-none">
              {t('details')}
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={
                <>
                  {t('name')} <span className="text-danger">*</span>
                </>
              }
              htmlFor="ws-role-name"
              hint={nameLocked ? t('presetNameHint') : undefined}
              error={errors.name}
            >
              <Input
                id="ws-role-name"
                name="name"
                value={name}
                maxLength={NAME_MAX}
                readOnly={nameLocked || readOnly}
                required
                invalid={Boolean(errors.name)}
                className="read-only:bg-muted read-only:text-muted-foreground"
                placeholder={t('namePlaceholder')}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
                }}
              />
            </Field>
            <Field label={t('template')} htmlFor="ws-role-template" hint={t('templateHint')}>
              <Select
                id="ws-role-template"
                value={template}
                disabled={readOnly}
                onChange={(e) => pickTemplate(e.target.value)}
              >
                <option value="">{t('templateBlank')}</option>
                {templates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t('templateOption', { name: r.name, count: r.grants.length })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <PermissionMatrix defs={catalogue} draft={draft} onChange={setDraft} readOnly={readOnly} />
      </form>

      {canDelete && (
        <section
          aria-labelledby="ws-danger-title"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-background p-5 shadow-sm"
        >
          <div className="min-w-0">
            <h2 id="ws-danger-title" className="text-sm font-semibold text-danger">
              {t('danger.title')}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {initial.userCount > 0
                ? t('danger.inUse', { count: initial.userCount })
                : t('danger.hint')}
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setDeleting(true)}
            data-testid="delete-role"
          >
            {t('danger.action')}
          </Button>
        </section>
      )}
      <DeleteRoleDialog
        role={deleting ? initial : null}
        onClose={() => setDeleting(false)}
        onDeleted={(deleted) => {
          setLeaving(true);
          setDeleting(false);
          toast.toast(t('toasts.deleted', { name: deleted }), 'success');
          router.push('/settings/roles');
        }}
      />
    </div>
  );
}
