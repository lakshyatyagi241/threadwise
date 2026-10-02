'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
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
  Field,
  Input,
  Modal,
  PasswordInput,
  Spinner,
  ToastProvider,
  cn,
  useToast,
} from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { KEYS, fetchExtensionsPage, uploadPackage } from '../api';
import { addonErrorKey } from '../lib/errors';
import { Accent, ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.extensions';
const APP = 'common';

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
    <div className="space-y-5">
      <PageHead
        crumbs={[
          { label: tc('admin'), href: '/admin' },
          { label: tc('settings'), href: '/admin/settings' },
          { label: t('crumbHere') },
        ]}
        eyebrow={t('eyebrow')}
        title={
          <>
            {t('titleLead')} <Accent>{t('titleAccent')}</Accent>.
          </>
        }
        description={t('description')}
        actions={
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('coreVersion')} <span className="text-foreground">v{data.coreVersion}</span>
          </span>
        }
      />

      {/* A different thing from billing add-ons; each page points at the other (TW-ADD-024). */}
      <Alert tone="info" className="bg-primary/10 text-xs">
        {t('packsLead')}{' '}
        <Link href="/admin/addons" className="font-semibold text-primary hover:underline">
          {t('packsLink')}
        </Link>
        {t('packsTail')}
      </Alert>
      {!canEdit && <Alert tone="info">{tc('readOnly')}</Alert>}

      <EngineCard engine={data.engines.instagram} canEdit={canEdit} onChanged={refresh} />
      <EngineCard engine={data.engines.email} canEdit={canEdit} onChanged={refresh} />

      {canEdit && <Installer onInstalled={refresh} />}
      <InstalledList data={data} canEdit={canEdit} onChanged={refresh} />
    </div>
  );
}

// --- engines ---------------------------------------------------------------------------------------------------

const GRADIENT: Record<EngineKey, string> = {
  instagram: 'linear-gradient(135deg, #833ab4, #e1306c, #f77737)',
  email: 'linear-gradient(135deg, #0ea5e9, #4f46e5, #7c3aed)',
};

function EngineIcon({ engine, small }: { engine: EngineKey; small?: boolean }) {
  const size = small ? 'size-6 rounded-lg' : 'size-11 rounded-2xl';
  const glyph = small ? 'size-3.5' : 'size-6';
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center text-white', size)}
      style={{ background: GRADIENT[engine] }}
    >
      <svg viewBox="0 0 24 24" className={glyph} fill="none" stroke="currentColor" strokeWidth="2">
        {engine === 'instagram' ? (
          <>
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </>
        ) : (
          <>
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
            <path d="M3.5 7.5l8.5 6 8.5-6" />
          </>
        )}
      </svg>
    </span>
  );
}

type Flash = { ok: boolean; text: string } | null;

function EngineCard({
  engine,
  canEdit,
  onChanged,
}: {
  engine: EngineState;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const key = engine.engine;
  const t = useTranslations(`${NS}.engines`);
  const ti = useTranslations(`${NS}.engines.${key}`);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const hasUrl = engine.url !== '';
  const brandName = engine.brand;
  const manage = engine.connected || hasUrl;

  return (
    <Card className="space-y-3">
      {flash && <Alert tone={flash.ok ? 'success' : 'danger'}>{flash.text}</Alert>}
      <div className="flex flex-wrap items-center gap-4">
        <EngineIcon engine={key} />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {ti('title')}
            {engine.connected ? (
              <Badge tone="success">{t('connected')}</Badge>
            ) : hasUrl ? (
              <Badge tone="danger">{t('notConnected')}</Badge>
            ) : null}
            {engine.blockedByNative && <Badge>{ti('blocked')}</Badge>}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{ti('body', { brand: brandName })}</p>
          {hasUrl && (
            <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground" dir="ltr">
              {engine.url}
            </p>
          )}
        </div>
        {canEdit &&
          (engine.blockedByNative ? (
            <div className="max-w-[210px] shrink-0 text-end">
              <Button size="sm" disabled>
                {t('manage')}
              </Button>
              <p className="mt-1 text-[11px] text-danger">
                {ti('blockedNote', { brand: brandName })}
              </p>
            </div>
          ) : (
            <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
              {manage ? t('manage') : t('connect')}
            </Button>
          ))}
      </div>
      {open && (
        <EngineModal
          engine={engine}
          initialError={!engine.connected && hasUrl ? engine.lastError : null}
          onClose={() => setOpen(false)}
          onDone={(f) => {
            setFlash(f);
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
  initialError,
  onClose,
  onDone,
}: {
  engine: EngineState;
  initialError: string | null;
  onClose: () => void;
  onDone: (f: Flash) => void;
}) {
  const key: EngineKey = engine.engine;
  const t = useTranslations(`${NS}.engines`);
  const ti = useTranslations(`${NS}.engines.${key}`);
  const tc = useTranslations('addons-extension-registry.common');
  const app = useTranslations(APP)('appName');
  const fmt = useFormatter();
  const [url, setUrl] = useState(engine.url);
  const [brand, setBrand] = useState(engine.brand);
  const [secret, setSecret] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const [failure, setFailure] = useState<string | null>(initialError);
  const shownBrand = brand.trim() || engine.brand;
  const hasUrl = engine.url !== '';

  const connect = useMutation({
    mutationFn: () =>
      operatorFetch(`/extensions/engines/${key}/connect`, {
        method: 'POST',
        body: { url, brand, secret: secret || undefined },
        schema: connectEngineResponseSchema,
      }),
    onSuccess: (r) => {
      if (r.ok) onDone({ ok: true, text: r.message });
      else setFailure(r.message);
    },
    onError: (e) =>
      setFailure(tc(addonErrorKey(e) === 'forbidden' ? 'errors.forbidden' : 'errors.request')),
  });
  const disconnect = useMutation({
    mutationFn: () =>
      operatorFetch(`/extensions/engines/${key}/disconnect`, {
        method: 'POST',
        schema: connectEngineResponseSchema,
      }),
    onSuccess: (r) => onDone({ ok: true, text: r.message }),
    onError: () => {
      setConfirmOff(false);
      setFailure(tc('errors.request'));
    },
  });
  const busy = connect.isPending || disconnect.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    connect.mutate();
  };
  const formId = `engine-form-${key}`;

  return (
    <>
      <Modal
        open
        onClose={() => !busy && onClose()}
        closeLabel={tc('close')}
        title={
          <span className="flex items-center gap-2">
            <EngineIcon engine={key} small />
            {ti('modalTitle')}
          </span>
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {engine.lastCheckAt &&
                `${t('lastChecked')}: ${fmt.dateTime(new Date(engine.lastCheckAt), { dateStyle: 'medium', timeStyle: 'short' })}`}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {hasUrl && (
                <Button variant="danger" disabled={busy} onClick={() => setConfirmOff(true)}>
                  {t('disconnect')}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                {tc('cancel')}
              </Button>
              <Button type="submit" form={formId} disabled={busy || !url.trim()}>
                {connect.isPending && <Spinner label={t('testing')} />}
                {connect.isPending ? t('testing') : t('save')}
              </Button>
            </div>
          </div>
        }
      >
        <p className="mb-4 text-xs text-muted-foreground">
          {ti('modalBody', { brand: shownBrand, app })}
        </p>
        <form id={formId} onSubmit={submit} className="space-y-3">
          {failure && <Alert tone="danger">{t('failed', { reason: failure })}</Alert>}
          <Field label={ti('url', { brand: shownBrand })} htmlFor={`engine-url-${key}`}>
            <Input
              id={`engine-url-${key}`}
              type="url"
              dir="ltr"
              required
              placeholder={ti('urlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label={t('displayName')} htmlFor={`engine-brand-${key}`} hint={ti('brandHint')}>
            <Input
              id={`engine-brand-${key}`}
              value={brand}
              maxLength={40}
              placeholder={ti('brandPlaceholder')}
              onChange={(e) => setBrand(e.target.value)}
            />
          </Field>
          <Field label={t('secret')} htmlFor={`engine-secret-${key}`}>
            <PasswordInput
              id={`engine-secret-${key}`}
              autoComplete="off"
              placeholder={engine.hasSecret ? t('secretSaved') : t('secretNew')}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
        </form>
      </Modal>
      {confirmOff && (
        <ConfirmDialog
          open
          tone="danger"
          busy={disconnect.isPending}
          title={ti('disconnectTitle')}
          message={ti('disconnectBody', { app })}
          confirmLabel={t('disconnectYes')}
          cancelLabel={tc('cancel')}
          onConfirm={() => disconnect.mutate()}
          onClose={() => setConfirmOff(false)}
        />
      )}
    </>
  );
}

// --- the two-step installer --------------------------------------------------------------------------------------

function StepHead({ n, title, body, on }: { n: number; title: string; body: string; on: boolean }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold',
          on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {n}
      </span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Installer({ onInstalled }: { onInstalled: () => void }) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  const app = useTranslations(APP)('appName');
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [verifyNote, setVerifyNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Step 2 unlocks only for the exact code that passed; editing the code locks it again. The server re-checks anyway.
  const unlocked = verifiedFor !== null && verifiedFor === code.trim();

  const verify = useMutation({
    mutationFn: (c: string) =>
      operatorFetch('/extensions/verify', {
        method: 'POST',
        body: { purchaseCode: c },
        schema: verifyPurchaseResponseSchema,
      }),
    onSuccess: (r, c) => {
      setVerifiedFor(r.ok ? c : null);
      setVerifyNote({ ok: r.ok, text: r.message });
    },
    onError: () => {
      setVerifiedFor(null);
      setVerifyNote({ ok: false, text: t('verify.failed') });
    },
  });
  const install = useMutation({
    mutationFn: () => uploadPackage(file as File, code.trim()),
    onSuccess: (r) => {
      setFile(null);
      toast(r.message);
      onInstalled();
    },
    onError: (e) => {
      const k = addonErrorKey(e);
      toast(
        te(
          k === 'invalidPackage' ||
            k === 'tooLarge' ||
            k === 'coreTooOld' ||
            k === 'engineConflict' ||
            k === 'forbidden'
            ? k
            : 'generic',
        ),
        'danger',
      );
    },
  });

  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) setVerifyNote({ ok: false, text: t('verify.empty') });
    else verify.mutate(c);
  };

  return (
    <>
      <Card>
        <StepHead n={1} on title={t('verify.title')} body={t('verify.body', { brand: app })} />
        <form onSubmit={onVerify} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t('verify.label')}
            className="min-w-[240px] flex-1 font-mono"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('verify.placeholder')}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setVerifyNote(null);
            }}
          />
          <Button type="submit" disabled={verify.isPending}>
            {verify.isPending ? t('verify.checking') : t('verify.action')}
          </Button>
        </form>
        {verifyNote && (
          <Alert tone={verifyNote.ok ? 'success' : 'danger'} className="mt-2">
            {verifyNote.text}
          </Alert>
        )}
      </Card>

      {/* Locked until step 1 passes; courtesy only, the server re-verifies on upload (TW-ADD-003). */}
      <Card
        id="ext-step2"
        className={cn('transition', !unlocked && 'pointer-events-none opacity-50')}
        aria-disabled={!unlocked}
      >
        <StepHead n={2} on={unlocked} title={t('upload.title')} body={t('upload.body')} />
        <label
          htmlFor="package-file"
          className="block cursor-pointer rounded-xl border border-dashed border-border px-4 py-8 text-center transition hover:border-primary hover:bg-muted/50"
        >
          <svg
            viewBox="0 0 16 16"
            className="mx-auto mb-2 size-6 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 11V3" />
            <path d="M5 6l3-3 3 3" />
            <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
          </svg>
          <div className="text-sm font-medium">{file ? file.name : t('upload.choose')}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t('upload.max')}</div>
          <input
            id="package-file"
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            disabled={!unlocked || install.isPending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            disabled={!unlocked || !file || install.isPending}
            onClick={() => install.mutate()}
          >
            {install.isPending && <Spinner label={t('upload.installing')} />}
            {install.isPending ? t('upload.installing') : t('upload.action')}
          </Button>
        </div>
        {install.isPending && (
          <Alert tone="success" className="mt-2">
            {t('upload.progress')}
          </Alert>
        )}
      </Card>
    </>
  );
}

// --- installed list ------------------------------------------------------------------------------------------------

type Target =
  { kind: 'extension'; item: InstalledExtension } | { kind: 'module'; item: InPlaceModule };

const BoxIcon = ({ tone }: { tone: 'on' | 'off' | 'plain' }) => (
  <span
    aria-hidden="true"
    className={cn(
      'inline-flex size-10 shrink-0 items-center justify-center rounded-xl',
      tone === 'on' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
    )}
  >
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7l8-4 8 4v10l-8 4-8-4V7z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </svg>
  </span>
);

function Row({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <li>
      <Card className={cn('flex flex-wrap items-center gap-3.5 p-4', dim && 'bg-muted/40')}>
        {children}
      </Card>
    </li>
  );
}

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
    onSuccess: (r) => {
      toast(r.message);
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
    onSuccess: (r) => {
      toast(r.message);
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

  const dialog = (() => {
    if (!confirm) return null;
    const name = confirm.item.name;
    if (confirm.kind === 'extension')
      return {
        title: tcf('removeTitle', { name }),
        body: tcf('removeBody'),
        label: tcf('remove'),
        danger: true,
      };
    return confirm.item.active
      ? {
          title: tcf('moduleOffTitle', { name }),
          body: tcf('moduleOffBody'),
          label: tcf('remove'),
          danger: true,
        }
      : {
          title: tcf('moduleOnTitle', { name }),
          body: tcf('moduleOnBody'),
          label: tcf('reactivate'),
          danger: false,
        };
  })();

  return (
    <section aria-labelledby="installed-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="installed-title" className="text-[13px] font-semibold">
          {t('title')}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {data.installedCount}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-3">
        {data.extensions.map((x) => (
          <Row key={x.id}>
            <BoxIcon tone="on" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                {x.name}
                <Badge className="font-mono">{t('version', { version: x.version })}</Badge>
                <Badge tone={x.status === 'active' ? 'success' : 'neutral'}>
                  {x.status === 'active' ? t('active') : t('disabled')}
                </Badge>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
                {x.slug} · addon/{x.slug}/ · {t('files', { count: x.fileCount })}
                {x.installedAt && ` · ${fmt.relativeTime(new Date(x.installedAt))}`}
              </p>
            </div>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(x)}
                >
                  {x.status === 'active' ? t('disable') : t('enable')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 border-danger/40 text-danger"
                  onClick={() => setConfirm({ kind: 'extension', item: x })}
                >
                  {t('remove')}
                </Button>
              </>
            )}
          </Row>
        ))}
        {data.modules.map((m) => (
          <Row key={m.slug} dim={!m.active}>
            <BoxIcon tone="plain" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                {m.name}
                <Badge className="font-mono">{t('version', { version: m.version })}</Badge>
                <Badge tone={m.active ? 'success' : 'danger'}>
                  {m.active ? t('active') : t('inactive')}
                </Badge>
                <Badge>{t('inPlace')}</Badge>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
                {m.slug} · addon/{m.slug}/ · {t('filesKept')}
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                className={cn(
                  'shrink-0',
                  m.active ? 'border-danger/40 text-danger' : 'border-primary/40 text-primary',
                )}
                disabled={busy}
                onClick={() => setConfirm({ kind: 'module', item: m })}
              >
                {m.active ? t('remove') : t('reactivate')}
              </Button>
            )}
          </Row>
        ))}
        {data.installedCount === 0 && (
          <li className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-xs text-muted-foreground">
            {t('empty')}
          </li>
        )}
      </ul>
      <p className="mt-5 text-[11px] text-muted-foreground">{t('footnote')}</p>

      {confirm && dialog && (
        <ConfirmDialog
          open
          tone={dialog.danger ? 'danger' : 'default'}
          busy={busy}
          title={dialog.title}
          message={dialog.body}
          confirmLabel={dialog.label}
          cancelLabel={tc('cancel')}
          onConfirm={run}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
