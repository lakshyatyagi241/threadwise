'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  connectEngineResponseSchema,
  removeExtensionResponseSchema,
  toggleExtensionResponseSchema,
  toggleModuleResponseSchema,
  verifyPurchaseResponseSchema,
  type EngineKey,
  type EngineState,
  type ExtensionsPageResponse,
  type InPlaceModule,
  type InstalledExtension,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PasswordInput,
  Spinner,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchExtensionsPage, uploadPackage } from '../api';
import { addonErrorKey } from '../lib/errors';
import { ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.extensions';

export function ExtensionsPage() {
  const t = useTranslations('addons-extension-registry.common');
  return (
    <ToastProvider dismissLabel={t('dismiss')}>
      <ExtensionsScreen />
    </ToastProvider>
  );
}

function ExtensionsScreen() {
  const q = useQuery({
    queryKey: KEYS.extensions,
    queryFn: ({ signal }) => fetchExtensionsPage(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <Page data={q.data} />;
}

function Page({ data }: { data: ExtensionsPageResponse }) {
  const t = useTranslations(NS);
  const tc = useTranslations('addons-extension-registry.common');
  const qc = useQueryClient();
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.extensions });

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<Badge>{t('coreVersion', { version: data.coreVersion })}</Badge>}
      />
      <Alert tone="info">
        <Link href="/admin/addons" className="underline underline-offset-2">
          {t('packsLink')}
        </Link>
      </Alert>
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        <EngineCard engine={data.engines.instagram} canEdit={canEdit} onChanged={refresh} />
        <EngineCard engine={data.engines.email} canEdit={canEdit} onChanged={refresh} />
      </div>

      {canEdit && <Installer onInstalled={refresh} />}
      <InstalledList data={data} canEdit={canEdit} onChanged={refresh} />
    </div>
  );
}

// --- engines ---------------------------------------------------------------------------------------------------

function EngineCard({
  engine,
  canEdit,
  onChanged,
}: {
  engine: EngineState;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations(`${NS}.engines`);
  const fmt = useFormatter();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const disconnect = useMutation({
    mutationFn: () =>
      operatorFetch(`/extensions/engines/${engine.engine}/disconnect`, { method: 'POST' }),
    onSuccess: onChanged,
    onError: () => toast(t('failed', { reason: '' }), 'danger'),
  });
  const info = engine.engine === 'instagram' ? 'instagram' : 'email';
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{engine.brand || t(`${info}.title`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`${info}.body`)}</p>
        </div>
        <Badge tone={engine.connected ? 'success' : 'neutral'}>
          {engine.connected ? t('connected') : t('notConnected')}
        </Badge>
      </div>
      {engine.blockedByNative && <Alert tone="warning">{t('blocked')}</Alert>}
      {engine.connected && (
        <p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">
          {engine.url}
          {engine.lastCheckAt && (
            <span className="font-sans">
              {' '}
              ({t('checkedAt', { when: fmt.relativeTime(new Date(engine.lastCheckAt)) })})
            </span>
          )}
        </p>
      )}
      {!engine.connected && engine.lastError && (
        <Alert tone="danger">{t('failed', { reason: engine.lastError })}</Alert>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={engine.blockedByNative}
            onClick={() => setOpen(true)}
          >
            {engine.connected ? t('manage') : t('connect')}
          </Button>
          {engine.connected && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              {t('disconnect')}
            </Button>
          )}
        </div>
      )}
      {open && (
        <EngineModal
          engine={engine}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function EngineModal({
  engine,
  onClose,
  onDone,
}: {
  engine: EngineState;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations(`${NS}.engines`);
  const tc = useTranslations('addons-extension-registry.common');
  const key: EngineKey = engine.engine;
  const [url, setUrl] = useState(engine.url);
  const [brand, setBrand] = useState(engine.brand);
  const [secret, setSecret] = useState('');
  const connect = useMutation({
    mutationFn: () =>
      operatorFetch(`/extensions/engines/${key}/connect`, {
        method: 'POST',
        body: { url, brand, secret: secret || undefined },
        schema: connectEngineResponseSchema,
      }),
    onSuccess: (r) => {
      if (r.ok) onDone();
    },
  });
  const failure = connect.data && !connect.data.ok ? connect.data.message : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate();
  };
  return (
    <Modal
      open
      onClose={() => !connect.isPending && onClose()}
      closeLabel={tc('close')}
      title={t(`${key}.title`)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={connect.isPending}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form={`engine-form-${key}`}
            disabled={connect.isPending || !url.trim()}
          >
            {connect.isPending && <Spinner label={t('testing')} />}
            {connect.isPending ? t('testing') : t('save')}
          </Button>
        </>
      }
    >
      <form id={`engine-form-${key}`} onSubmit={submit} className="space-y-4">
        {failure && <Alert tone="danger">{t('failed', { reason: failure })}</Alert>}
        {connect.isError && <Alert tone="danger">{t('failed', { reason: '' })}</Alert>}
        <Field label={t('url')} htmlFor={`engine-url-${key}`}>
          <Input
            id={`engine-url-${key}`}
            type="url"
            dir="ltr"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label={t('brand')} htmlFor={`engine-brand-${key}`}>
          <Input
            id={`engine-brand-${key}`}
            value={brand}
            maxLength={40}
            onChange={(e) => setBrand(e.target.value)}
          />
        </Field>
        <Field
          label={t('secret')}
          htmlFor={`engine-secret-${key}`}
          hint={engine.hasSecret ? t('secretSaved') : undefined}
        >
          <PasswordInput
            id={`engine-secret-${key}`}
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

// --- the two-step installer --------------------------------------------------------------------------------------

function Installer({ onInstalled }: { onInstalled: () => void }) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const [code, setCode] = useState('');
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [empty, setEmpty] = useState(false);
  // Step 2 unlocks only for the exact code that passed; editing the code locks it again. The server re-checks anyway.
  const unlocked = verifiedFor !== null && verifiedFor === code.trim();

  const verify = useMutation({
    mutationFn: (c: string) =>
      operatorFetch('/extensions/verify', {
        method: 'POST',
        body: { purchaseCode: c },
        schema: verifyPurchaseResponseSchema,
      }),
    onSuccess: (r, c) => setVerifiedFor(r.ok ? c : null),
    onError: () => setVerifiedFor(null),
  });
  const install = useMutation({
    mutationFn: () => uploadPackage(file as File, code.trim()),
    onSuccess: () => {
      setFile(null);
      onInstalled();
    },
  });

  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    setEmpty(!c);
    if (c) verify.mutate(c);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">{t('verify.title')}</h2>
        <form onSubmit={onVerify} className="space-y-3">
          <Field
            label={t('verify.label')}
            htmlFor="purchase-code"
            error={empty ? t('verify.empty') : undefined}
          >
            <Input
              id="purchase-code"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setEmpty(false);
              }}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={verify.isPending}>
            {verify.isPending && <Spinner label={t('verify.checking')} />}
            {verify.isPending ? t('verify.checking') : t('verify.action')}
          </Button>
        </form>
        {unlocked && <Alert tone="success">{t('verify.ok')}</Alert>}
        {verify.isError && <Alert tone="danger">{te('invalidPackage')}</Alert>}
      </Card>

      <Card className={unlocked ? 'space-y-3' : 'space-y-3 opacity-60'}>
        <h2 className="text-base font-semibold">{t('upload.title')}</h2>
        {!unlocked && <p className="text-sm text-muted-foreground">{t('upload.locked')}</p>}
        <Field label={t('upload.file')} htmlFor="package-file">
          <input
            id="package-file"
            type="file"
            accept=".zip,application/zip"
            disabled={!unlocked || install.isPending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2"
          />
        </Field>
        <Button disabled={!unlocked || !file || install.isPending} onClick={() => install.mutate()}>
          {install.isPending && <Spinner label={t('upload.installing')} />}
          {install.isPending ? t('upload.installing') : t('upload.action')}
        </Button>
        {install.isSuccess && (
          <Alert tone="success">
            {t(install.data.upgraded ? 'upload.upgraded' : 'upload.done', {
              name: install.data.extension.name,
              version: install.data.extension.version,
            })}
          </Alert>
        )}
        {install.isError && (
          <Alert tone="danger">
            {te(
              (
                {
                  invalidPackage: 'invalidPackage',
                  tooLarge: 'tooLarge',
                  coreTooOld: 'coreTooOld',
                  engineConflict: 'engineConflict',
                  forbidden: 'forbidden',
                } as const
              )[addonErrorKey(install.error) as 'invalidPackage'] ?? 'generic',
            )}
          </Alert>
        )}
      </Card>
    </div>
  );
}

// --- installed list ------------------------------------------------------------------------------------------------

type Target =
  { kind: 'extension'; item: InstalledExtension } | { kind: 'module'; item: InPlaceModule };

function InstalledList({
  data,
  canEdit,
  onChanged,
}: {
  data: ExtensionsPageResponse;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations(`${NS}.installed`);
  const tcf = useTranslations(`${NS}.confirm`);
  const tc = useTranslations('addons-extension-registry.common');
  const fmt = useFormatter();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<Target | null>(null);

  const fail = () => toast(tc('errors.request'), 'danger');
  const toggle = useMutation({
    mutationFn: (x: InstalledExtension) =>
      operatorFetch(`/extensions/${x.id}/toggle`, {
        method: 'POST',
        body: { rowVersion: x.rowVersion },
        schema: toggleExtensionResponseSchema,
      }),
    onSuccess: onChanged,
    onError: () => {
      fail();
      onChanged();
    },
  });
  const toggleModule = useMutation({
    mutationFn: (m: InPlaceModule) =>
      operatorFetch(`/extensions/modules/${m.slug}/toggle`, {
        method: 'POST',
        schema: toggleModuleResponseSchema,
      }),
    onSuccess: () => {
      setConfirm(null);
      onChanged();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (x: InstalledExtension) =>
      operatorFetch(`/extensions/${x.id}`, {
        method: 'DELETE',
        schema: removeExtensionResponseSchema,
      }),
    onSuccess: () => {
      setConfirm(null);
      onChanged();
    },
    onError: fail,
  });

  const busy = remove.isPending || toggleModule.isPending;
  const run = () => {
    if (!confirm) return;
    if (confirm.kind === 'extension') remove.mutate(confirm.item);
    else toggleModule.mutate(confirm.item);
  };

  return (
    <section className="space-y-3" aria-labelledby="installed-title">
      <div className="flex items-center gap-2">
        <h2 id="installed-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Badge>{t('count', { count: data.installedCount })}</Badge>
      </div>
      {data.installedCount === 0 ? (
        <EmptyState title={t('title')} message={t('empty')} />
      ) : (
        <ul className="space-y-3">
          {data.extensions.map((x) => (
            <li key={x.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{x.name}</span>
                    <Badge>{t('version', { version: x.version })}</Badge>
                    <Badge tone={x.status === 'active' ? 'success' : 'warning'}>
                      {x.status === 'active' ? t('active') : t('disabled')}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {x.slug} · {t('files', { count: x.fileCount })}
                    {x.installedAt &&
                      ` · ${t('installedAt', { when: fmt.relativeTime(new Date(x.installedAt)) })}`}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(x)}
                    >
                      {x.status === 'active' ? t('disable') : t('enable')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setConfirm({ kind: 'extension', item: x })}
                    >
                      {t('remove')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
          {data.modules.map((m) => (
            <li key={m.slug}>
              <Card
                className={
                  m.active
                    ? 'flex flex-wrap items-center justify-between gap-3'
                    : 'flex flex-wrap items-center justify-between gap-3 opacity-60'
                }
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.name}</span>
                    <Badge>{t('version', { version: m.version })}</Badge>
                    <Badge tone={m.active ? 'success' : 'warning'}>
                      {m.active ? t('active') : t('inactive')}
                    </Badge>
                    <Badge>{t('inPlace')}</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {m.slug} · {t('filesKept')}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      m.active ? setConfirm({ kind: 'module', item: m }) : toggleModule.mutate(m)
                    }
                  >
                    {m.active ? t('remove') : t('reactivate')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('footnote')}</p>

      {confirm && (
        <ConfirmDialog
          open
          tone="danger"
          busy={busy}
          title={
            confirm.kind === 'extension'
              ? tcf('removeTitle', { name: confirm.item.name })
              : tcf('moduleTitle', { name: confirm.item.name })
          }
          message={confirm.kind === 'extension' ? tcf('removeBody') : tcf('moduleBody')}
          confirmLabel={confirm.kind === 'extension' ? tcf('remove') : tcf('deactivate')}
          cancelLabel={tc('cancel')}
          onConfirm={run}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
