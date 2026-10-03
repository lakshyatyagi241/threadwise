'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  roleNameSchema,
  type PlatformMyPermissions,
  type PlatformPermission,
  type PlatformRoleDetail,
  type PlatformRoleSummary,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@crm/ui';
import { useToast } from '../auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '../auth-registration-security/platform/ui/use-unsaved-guard';
import {
  createRole,
  fetchPermissions,
  fetchRole,
  fetchRoles,
  rbacKeys,
  updateRole,
} from './lib/api';
import { rbacError, type RbacError } from './lib/errors';
import { applyTemplate, sameSelection, selectionToList } from './lib/matrix';
import { AccessGate } from './ui/access';
import { RbacHeader, SectionBadge, pillLink } from './ui/chrome';
import { CheckSmallIcon } from './ui/icons';
import { DangerZone } from './ui/danger-zone';
import { PermissionMatrix } from './ui/permission-matrix';
import { LoadingBlock, QueryError } from './ui/states';

const NS = 'roles-permissions.editor';
const FORM_ID = 'roleForm';

/** /admin/roles/new */
export function RoleCreatePage() {
  return (
    <AccessGate permission="platform.role.manage">
      {(me) => <RoleEditorLoader me={me} roleId={null} duplicated={false} />}
    </AccessGate>
  );
}

/** /admin/roles/[id] */
export function RoleEditPage({ roleId, duplicated }: { roleId: string; duplicated: boolean }) {
  return (
    <AccessGate permission="platform.role.manage">
      {(me) => <RoleEditorLoader me={me} roleId={roleId} duplicated={duplicated} />}
    </AccessGate>
  );
}

/**
 * Reads what the editor needs (the whole catalogue, the other roles for "Start from template", and the role itself when
 * editing) and mounts the form once all of it is here. Everything is read fresh: a stale catalogue would drop a
 * permission another admin just created, a stale `rowVersion` would defeat the optimistic lock.
 */
function RoleEditorLoader({
  me,
  roleId,
  duplicated,
}: {
  me: PlatformMyPermissions;
  roleId: string | null;
  duplicated: boolean;
}) {
  const [epoch, setEpoch] = useState(0);
  const fresh = { staleTime: 0, refetchOnWindowFocus: false, refetchOnMount: 'always' } as const;
  const catalogue = useQuery({
    queryKey: rbacKeys.permissions,
    queryFn: ({ signal }) => fetchPermissions(signal),
    ...fresh,
  });
  const roles = useQuery({
    queryKey: rbacKeys.roleList('all', ''),
    queryFn: ({ signal }) => fetchRoles('all', '', signal),
    ...fresh,
  });
  const role = useQuery({
    queryKey: rbacKeys.role(roleId ?? 'new'),
    queryFn: ({ signal }) => fetchRole(roleId!, signal),
    enabled: roleId !== null,
    ...fresh,
  });

  const failed = [role, catalogue, roles].find((q) => q.isError);
  if (failed) {
    return (
      <QueryError
        error={failed.error}
        onRetry={() => void Promise.all([role.refetch(), catalogue.refetch(), roles.refetch()])}
      />
    );
  }
  if (!catalogue.data || !roles.data || (roleId !== null && !role.data)) {
    return <LoadingBlock />;
  }
  return (
    <RoleForm
      // A reload after a version conflict remounts the form with what is stored now.
      key={`${roleId ?? 'new'}-${epoch}`}
      role={roleId === null ? null : (role.data ?? null)}
      liveRole={role.data ?? null}
      catalogue={catalogue.data.data}
      templates={roles.data.data.filter((r) => r.id !== roleId)}
      canCreatePermission={me.permissions['platform.permission.manage'] === true}
      duplicated={duplicated}
      onReload={async () => {
        await role.refetch();
        setEpoch((e) => e + 1);
      }}
    />
  );
}

interface FormErrors {
  name?: string;
  server?: RbacError;
}

function RoleForm({
  role: loaded,
  liveRole,
  catalogue,
  templates,
  canCreatePermission,
  duplicated,
  onReload,
}: {
  /** The role as read when the form opened (null: creating). The form keeps this snapshot, including its rowVersion. */
  role: PlatformRoleDetail | null;
  /** The role as it is now, for the header chip and the danger zone. */
  liveRole: PlatformRoleDetail | null;
  catalogue: PlatformPermission[];
  templates: PlatformRoleSummary[];
  canCreatePermission: boolean;
  duplicated: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions.common.errors');
  const tc = useTranslations('roles-permissions.common');
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  // Frozen at mount: a later refetch must not slip a newer rowVersion under edits made on an older read.
  const [initial] = useState(loaded);
  const editing = initial !== null;
  const locked = initial?.isLocked === true;

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initial?.permissions ?? []),
  );
  const [template, setTemplate] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [leaving, setLeaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  const initialSelected = useMemo(() => new Set(initial?.permissions ?? []), [initial]);
  const catalogueNames = useMemo(() => catalogue.map((p) => p.name), [catalogue]);
  const dirty =
    name !== (initial?.name ?? '') ||
    description !== (initial?.description ?? '') ||
    !sameSelection(selected, initialSelected);
  useUnsavedGuard(dirty && !leaving);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        permissions: selectionToList(selected),
      };
      return initial
        ? updateRole(initial.id, { ...body, rowVersion: initial.rowVersion })
        : createRole(body);
    },
    onSuccess: async (saved) => {
      setLeaving(true);
      toast.success(t(editing ? 'toasts.updated' : 'toasts.created', { name: saved.name }));
      await qc.invalidateQueries({ queryKey: rbacKeys.roles });
      router.push('/admin/roles');
    },
    onError: (err) => {
      const info = rbacError(err, 'save');
      setErrors(
        info.kind === 'field' && info.field === 'name'
          ? { name: te(info.key, info.values) }
          : { server: info },
      );
      if (info.kind === 'field' && info.field === 'name') {
        requestAnimationFrame(() => document.getElementById('role-name')?.focus());
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    if (!roleNameSchema.safeParse(name).success) {
      setErrors({ name: te('nameRequired') });
      document.getElementById('role-name')?.focus();
      return;
    }
    setErrors({});
    save.mutate();
  }

  async function pickTemplate(id: string) {
    setTemplate(id);
    if (!id) {
      setSelected(applyTemplate(catalogueNames, null));
      return;
    }
    setTemplateBusy(true);
    try {
      const source = await qc.fetchQuery({
        queryKey: rbacKeys.role(id),
        queryFn: ({ signal }) => fetchRole(id, signal),
        staleTime: 0,
      });
      setSelected(applyTemplate(catalogueNames, source.permissions));
    } catch (err) {
      const info = rbacError(err);
      toast.error(te(info.key, info.values));
      setTemplate('');
    } finally {
      setTemplateBusy(false);
    }
  }

  const confirmLeave = () => !dirty || window.confirm(t('discard'));
  const count = liveRole?.userCount ?? 0;
  const lastEdited = initial?.updatedAt.slice(0, 10) ?? '—';
  const displayName = initial?.name ?? '';

  const cancelLink = (
    <Link
      href="/admin/roles"
      className={pillLink('secondary')}
      onClick={(e) => {
        if (!confirmLeave()) e.preventDefault();
      }}
    >
      {tc('cancel')}
    </Link>
  );

  const actions: ReactNode = (
    <>
      {editing && (
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs font-medium text-muted-foreground">
          {t('userChip', { count })}
        </span>
      )}
      {cancelLink}
      <Button type="submit" form={FORM_ID} className="rounded-full" disabled={save.isPending}>
        {save.isPending ? <Spinner label={t('saving')} /> : <CheckSmallIcon />}
        {editing ? t('save') : t('create')}
      </Button>
    </>
  );

  const serverInfo = errors.server;
  const summary: string[] = [];
  if (serverInfo && serverInfo.kind !== 'conflict')
    summary.push(te(serverInfo.key, serverInfo.values));

  return (
    <div className="space-y-5">
      <RbacHeader
        crumbsLabel={tc('breadcrumb')}
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: t('crumbRoles'), href: '/admin/roles' },
          { label: editing ? displayName : t('crumbNew') },
        ]}
        eyebrow={editing ? t('eyebrowEdit') : t('eyebrowNew')}
        lead={editing ? undefined : t('titleLead')}
        accent={editing ? displayName : t('titleAccent')}
        description={
          editing
            ? t('summary', {
                count: initial.permissions.length,
                total: catalogue.length,
                date: lastEdited,
              })
            : t('description')
        }
        actions={actions}
      />

      {duplicated && editing && (
        <Alert tone="success">{t('duplicatedBanner', { name: displayName })}</Alert>
      )}
      {locked && <Alert tone="info">{t('lockedNotice', { name: displayName })}</Alert>}
      {serverInfo?.kind === 'conflict' && (
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
      {summary.length > 0 && (
        <Alert tone="danger" className="space-y-1">
          {summary.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {serverInfo?.requestId && (
            <p className="font-mono text-xs opacity-80">
              {tc('requestId')}: {serverInfo.requestId}
            </p>
          )}
        </Alert>
      )}

      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-5">
        <section
          aria-labelledby="details-title"
          className="rounded-2xl border border-border bg-background p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2.5">
            <SectionBadge n="01" />
            <h2 id="details-title" className="text-lg font-semibold leading-none">
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
              htmlFor="role-name"
              error={errors.name}
            >
              <Input
                id="role-name"
                name="name"
                value={name}
                maxLength={191}
                readOnly={locked}
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
            <Field
              label={t('template')}
              htmlFor="role-template"
              hint={templateBusy ? t('templateBusy') : undefined}
            >
              <Select
                id="role-template"
                value={template}
                disabled={locked || templateBusy}
                onChange={(e) => void pickTemplate(e.target.value)}
              >
                <option value="">{t('templateBlank')}</option>
                {templates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t('templateOption', { name: r.name, count: r.permissionCount })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('descriptionLabel')} htmlFor="role-desc" className="sm:col-span-2">
              <Textarea
                id="role-desc"
                name="description"
                rows={2}
                value={description}
                maxLength={500}
                placeholder={t('descriptionPlaceholder')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
        </section>

        <PermissionMatrix
          catalogue={catalogue}
          selected={selected}
          onChange={setSelected}
          lockedNames={locked ? initialSelected : undefined}
          canCreatePermission={canCreatePermission}
        />
      </form>

      {editing && liveRole && !locked && <DangerZone role={liveRole} confirmLeave={confirmLeave} />}
    </div>
  );
}
