'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Select, Spinner } from '@crm/ui';
import { useToast } from '../auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '../auth-registration-security/platform/ui/use-unsaved-guard';
import { createPermission, rbacKeys } from './lib/api';
import { rbacError } from './lib/errors';
import {
  PERMISSION_MODULES,
  autofillName,
  isValidPermissionName,
  previewParts,
} from './lib/permission-name';
import { AccessGate } from './ui/access';
import { RbacHeader, SectionBadge, pillLink } from './ui/chrome';
import { CheckSmallIcon } from './ui/icons';

const NS = 'roles-permissions.permissionNew';
const FORM_ID = 'permForm';

/** /admin/permissions/new */
export function PermissionCreatePage() {
  return (
    <AccessGate permission="platform.permission.manage">{() => <PermissionForm />}</AccessGate>
  );
}

function PermissionForm() {
  const t = useTranslations(NS);
  const tc = useTranslations('roles-permissions.common');
  const te = useTranslations('roles-permissions.common.errors');
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [name, setName] = useState('');
  // WaDesk: the name follows module + action until the person types in it.
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useUnsavedGuard((module !== '' || action !== '' || name !== '') && !leaving);

  const create = useMutation({
    // The visible name is the only thing sent: what is shown in the field is what gets stored.
    mutationFn: (finalName: string) => createPermission({ name: finalName }),
    onSuccess: async (saved) => {
      setLeaving(true);
      toast.success(t('toasts.created', { name: saved.name }));
      await qc.invalidateQueries({ queryKey: rbacKeys.permissions });
      router.push('/admin/permissions');
    },
    onError: (err) => {
      const info = rbacError(err);
      if (info.kind === 'field' && info.field === 'name') {
        setError(te(info.key, info.values));
        requestAnimationFrame(() => document.getElementById('name')?.focus());
      } else {
        setGeneral(te(info.key, info.values));
      }
    },
  });

  function sync(next: { module?: string; action?: string }) {
    const m = next.module ?? module;
    const a = next.action ?? action;
    if (next.module !== undefined) setModule(m);
    if (next.action !== undefined) setAction(a);
    setName((current) => autofillName({ module: m, action: a, name: current, edited }));
    setError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const finalName = name.trim();
    setGeneral(null);
    if (finalName === '') {
      setError(te('permissionNameRequired'));
      document.getElementById('name')?.focus();
      return;
    }
    if (!isValidPermissionName(finalName)) {
      setError(te('permissionNameFormat'));
      document.getElementById('name')?.focus();
      return;
    }
    setError(null);
    create.mutate(finalName);
  }

  const preview = previewParts(module, action);
  const full = `${preview.module}.${preview.action}`;

  return (
    <div className="space-y-5">
      <RbacHeader
        crumbsLabel={tc('breadcrumb')}
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: t('crumbPermissions'), href: '/admin/permissions' },
          { label: t('crumbNew') },
        ]}
        eyebrow={t('eyebrow')}
        lead={t('titleLead')}
        accent={t('titleAccent')}
        description={t('description')}
        actions={
          <>
            <Link href="/admin/permissions" className={pillLink('secondary')}>
              {tc('cancel')}
            </Link>
            <Button
              type="submit"
              form={FORM_ID}
              className="rounded-full"
              disabled={create.isPending}
            >
              {create.isPending ? <Spinner label={t('creating')} /> : <CheckSmallIcon />}
              {t('create')}
            </Button>
          </>
        }
      />

      {general && <Alert tone="danger">{general}</Alert>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22.5rem]">
        <form
          id={FORM_ID}
          onSubmit={submit}
          noValidate
          className="space-y-4 rounded-2xl border border-border bg-background p-5 shadow-sm"
        >
          <div className="flex items-center gap-2.5">
            <SectionBadge n="01" />
            <h2 className="text-lg font-semibold leading-none">{t('details')}</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('module')} htmlFor="module" hint={t('moduleHint')}>
              <Select id="module" value={module} onChange={(e) => sync({ module: e.target.value })}>
                <option value="">{t('modulePlaceholder')}</option>
                {PERMISSION_MODULES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('action')}
              htmlFor="action"
              hint={
                <>
                  {t('actionHint')} <span className="font-mono text-foreground">{full}</span>.
                </>
              }
            >
              <Input
                id="action"
                value={action}
                maxLength={64}
                placeholder={t('actionPlaceholder')}
                onChange={(e) => sync({ action: e.target.value })}
              />
            </Field>
            <Field
              label={
                <>
                  {t('name')} <span className="text-danger">*</span>
                </>
              }
              htmlFor="name"
              hint={t('nameHint')}
              error={error}
              className="sm:col-span-2"
            >
              <Input
                id="name"
                value={name}
                maxLength={191}
                required
                invalid={Boolean(error)}
                placeholder={t('namePlaceholder')}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setName(e.target.value);
                  setEdited(true);
                  setError(null);
                }}
              />
            </Field>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs leading-snug">
            <span className="mt-0.5 size-3.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <p>
              {t.rich('tip', {
                b: (chunks) => <b>{chunks}</b>,
                code: (chunks) => <span className="font-mono">{chunks}</span>,
              })}
            </p>
          </div>
        </form>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('preview.title')}
            </div>
            <div className="rounded-xl border border-border bg-muted p-4 text-center">
              <div className="break-all font-mono text-sm" data-testid="preview-full">
                {full}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {t.rich('preview.appearsUnder', {
                  module: module === '' ? t('preview.selectedModule') : module,
                  b: (chunks) => <b>{chunks}</b>,
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('code.title')}
            </div>
            <pre
              dir="ltr"
              className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed"
            >{`@PlatformPermission('${full}')\n// protected route`}</pre>
            <p className="mt-2 text-xs text-muted-foreground">
              {t.rich('code.hint', {
                code: (chunks) => <span className="font-mono">{chunks}</span>,
              })}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-primary/10 p-3 text-xs leading-snug shadow-sm">
            {t.rich('tipCard', {
              b: (chunks) => <b>{chunks}</b>,
              code: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
