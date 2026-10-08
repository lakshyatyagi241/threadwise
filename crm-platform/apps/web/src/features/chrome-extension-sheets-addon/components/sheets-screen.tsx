'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ExtSheetsKeyStatus, ExtSheetsOverview } from '@crm/contracts';
import { EXT_SHEETS_USE_PERMISSION } from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Spinner, cn, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, downloadAddonFile, sheetsApi, useOverview } from '../api/sheets';
import {
  CONTACT_COLUMNS,
  MARKETPLACE_APP_PATH,
  PRODUCT_COLUMNS,
  capabilityList,
  displayMask,
  errorKind,
  formatPrice,
  formatWhen,
  orderedFiles,
  shopTitle,
  sizeLabel,
  viewState,
  type ErrorKind,
  type OneTimeKey,
} from '../lib/model';
import { saveBlob } from '../lib/save-file';
import { CopyButton } from './copy-button';
import { DownloadIcon, SheetIcon } from './icons';

const CARD = 'rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5';
const H2 = 'text-base font-semibold';

/** A failed call, shown as the red notice. */
interface Notice {
  kind: ErrorKind;
  requestId?: string;
}

const toNotice = (error: unknown): Notice => ({
  kind: errorKind(error),
  requestId: error instanceof ApiError ? error.requestId : undefined,
});

/**
 * `/google-sheets-addon` (WD-EXT-001 to 006): the install state, the member's key (shown once when created), what the key may do, the
 * six add-on files with a setup guide, and the workspace's shops and recent products. The secret lives in this component's state only.
 */
export function SheetsScreen() {
  const t = useTranslations('chrome-extension-sheets-addon.page');
  const canUse = useCan(EXT_SHEETS_USE_PERMISSION);
  const q = useOverview(canUse);
  const view = viewState({
    canUse,
    isPending: q.isPending,
    isError: q.isError && q.data === undefined,
    overview: q.data,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Header overview={view === 'ready' || view === 'notInstalled' ? q.data : undefined} />
      {view === 'noPermission' && (
        <Alert tone="danger">
          <p className="font-semibold">{t('forbidden.title')}</p>
          <p>{t('forbidden.body')}</p>
        </Alert>
      )}
      {view === 'loading' && (
        <div className={cn(CARD, 'flex justify-center p-10')}>
          <Spinner label={t('loading')} />
        </div>
      )}
      {view === 'error' && <LoadFailed error={q.error} onRetry={() => void q.refetch()} />}
      {(view === 'ready' || view === 'notInstalled') && q.data && <Body overview={q.data} />}
    </div>
  );
}

function Header({ overview }: { overview: ExtSheetsOverview | undefined }) {
  const t = useTranslations('chrome-extension-sheets-addon.page');
  const status = !overview
    ? null
    : !overview.installed
      ? { tone: 'warning' as const, text: t('status.notInstalled') }
      : overview.key.active
        ? { tone: 'success' as const, text: t('status.connected') }
        : { tone: 'neutral' as const, text: t('status.noKey') };
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
          <SheetIcon className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>
      {status && <Badge tone={status.tone}>{status.text}</Badge>}
    </header>
  );
}

export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTranslations('chrome-extension-sheets-addon.page');
  const c = useTranslations('chrome-extension-sheets-addon.common');
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Alert tone="danger">
      <p className="font-semibold">{t('loadFailed.title')}</p>
      <p>{t(`loadFailed.${errorKind(error)}`)}</p>
      {requestId && <p className="mt-1 font-mono text-xs">{c('reference', { id: requestId })}</p>}
      <Button className="mt-2" variant="secondary" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </Alert>
  );
}

function Body({ overview }: { overview: ExtSheetsOverview }) {
  return (
    <>
      {!overview.installed && (
        <InstallNotice marketplaceUrl={overview.marketplaceUrl} keyActive={overview.key.active} />
      )}
      <KeyCard overview={overview} />
      {overview.installed && <CanCard can={overview.can} />}
      <FilesCard files={overview.files} />
      <StepsCard />
      <ShopsCard overview={overview} />
    </>
  );
}

/** The add-on is not installed: say so plainly, with the Marketplace link, and offer no key. */
export function InstallNotice({
  marketplaceUrl,
  keyActive,
}: {
  marketplaceUrl: string | null;
  keyActive: boolean;
}) {
  const t = useTranslations('chrome-extension-sheets-addon.install');
  return (
    <section
      aria-labelledby="sheets-install"
      className="rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:p-5"
    >
      <h2 id="sheets-install" className={H2}>
        {t('title')}
      </h2>
      <p className="mt-1 text-sm">{t('body')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={MARKETPLACE_APP_PATH}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {t('marketplace')}
        </Link>
        {marketplaceUrl && (
          <a
            href={marketplaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('google')}
          </a>
        )}
      </div>
      {keyActive && <p className="mt-2 text-sm text-muted-foreground">{t('keyKept')}</p>}
    </section>
  );
}

export function KeyCard({ overview }: { overview: ExtSheetsOverview }) {
  const t = useTranslations('chrome-extension-sheets-addon.key');
  const c = useTranslations('chrome-extension-sheets-addon.common');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [shown, setShown] = useState<OneTimeKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<'generate' | 'revoke' | null>(null);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const status: ExtSheetsKeyStatus = overview.key;

  useEffect(() => {
    if (shown) keyField.current?.focus();
  }, [shown]);

  const refresh = () => qc.invalidateQueries({ queryKey: KEYS.overview });

  const generate = async () => {
    if (busy) return;
    setBusy('generate');
    setNotice(null);
    try {
      const issued = await sheetsApi.generate();
      setShown({ secret: issued.key, rotated: issued.rotated });
      toast(t('generated'), 'success');
      await refresh();
    } catch (error) {
      setNotice(toNotice(error));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy('revoke');
    setNotice(null);
    try {
      await sheetsApi.revoke();
      setShown(null);
      toast(t('revoked'), 'success');
      await refresh();
    } catch (error) {
      setNotice(toNotice(error));
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const mask = displayMask(status);
  const created = formatWhen(status.createdAt, locale);
  const lastUsed = formatWhen(status.lastUsedAt, locale);

  return (
    <section aria-labelledby="sheets-key" className={CARD}>
      <h2 id="sheets-key" className={H2}>
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>

      {notice && (
        <Alert tone="danger" className="mt-3">
          <p>{t(`errors.${notice.kind}`)}</p>
          {notice.requestId && <p className="mt-1 font-mono text-xs">{notice.requestId}</p>}
        </Alert>
      )}

      {shown && (
        <div
          role="group"
          aria-labelledby="sheets-key-new"
          className="mt-4 rounded-xl border border-warning/50 bg-warning/10 p-4"
        >
          <h3 id="sheets-key-new" className="text-sm font-semibold">
            {t('newTitle')}
          </h3>
          <p className="mt-1 text-sm">{t('newWarning')}</p>
          {shown.rotated && <p className="mt-1 text-sm">{t('rotatedNote')}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={keyField}
              readOnly
              value={shown.secret}
              aria-label={t('keyLabel')}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <CopyButton
              text={shown.secret}
              label={c('copy')}
              copiedLabel={c('copied')}
              failedLabel={c('copyFailed')}
            />
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {status.active && mask ? (
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('active')}</p>
            <p className="mt-1 break-all font-mono text-sm" data-testid="sheets-key-mask">
              {mask}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {[
                created ? t('created', { when: created }) : null,
                lastUsed ? t('lastUsed', { when: lastUsed }) : t('neverUsed'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        ) : (
          overview.installed && <p className="text-sm text-muted-foreground">{t('none')}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {overview.installed && (
            <Button
              disabled={busy !== null}
              onClick={() => (status.active ? setConfirm('rotate') : void generate())}
            >
              {busy === 'generate' && <Spinner />}
              {status.active ? t('rotate') : t('generate')}
            </Button>
          )}
          {status.active && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirm('revoke')}>
              {busy === 'revoke' && <Spinner />}
              {t('revoke')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'rotate'}
        title={t('confirmRotate.title')}
        message={t('confirmRotate.message')}
        confirmLabel={t('confirmRotate.confirm')}
        cancelLabel={t('cancel')}
        busy={busy === 'generate'}
        onConfirm={() => void generate()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        title={t('confirmRevoke.title')}
        message={t('confirmRevoke.message')}
        confirmLabel={t('confirmRevoke.confirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy === 'revoke'}
        onConfirm={() => void revoke()}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}

export function CanCard({ can }: { can: ExtSheetsOverview['can'] }) {
  const t = useTranslations('chrome-extension-sheets-addon.can');
  return (
    <section aria-labelledby="sheets-can" className={CARD}>
      <h2 id="sheets-can" className={H2}>
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {capabilityList(can).map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span>{t(c.id)}</span>
            <Badge tone={c.allowed ? 'success' : 'neutral'}>
              {c.allowed ? t('allowed') : t('notAllowed')}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FilesCard({ files }: { files: ExtSheetsOverview['files'] }) {
  const t = useTranslations('chrome-extension-sheets-addon.files');
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (name: string) => {
    if (busy) return;
    setBusy(name);
    try {
      const { blob, filename } = await downloadAddonFile(name);
      saveBlob(blob, filename);
      toast(t('downloaded', { name }), 'success');
    } catch {
      toast(t('failed', { name }), 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="sheets-files" className={CARD}>
      <h2 id="sheets-files" className={H2}>
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {orderedFiles(files).map((f) => (
          <li
            key={f.name}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="font-mono text-sm font-medium">{f.name}</p>
              <p className="text-xs text-muted-foreground">
                {f.available
                  ? [f.description, sizeLabel(f.sizeBytes)].filter(Boolean).join(' · ')
                  : t('notAvailable')}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={!f.available || busy !== null}
              aria-label={t('downloadFile', { name: f.name })}
              onClick={() => void download(f.name)}
            >
              {busy === f.name ? <Spinner /> : <DownloadIcon className="size-3.5" />}
              {t('download')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StepsCard() {
  const t = useTranslations('chrome-extension-sheets-addon.steps');
  const c = useTranslations('chrome-extension-sheets-addon.columns');
  const steps = ['one', 'two', 'three', 'four', 'five', 'six'] as const;
  return (
    <section aria-labelledby="sheets-steps" className={CARD}>
      <h2 id="sheets-steps" className={H2}>
        {t('title')}
      </h2>
      <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-sm">
        {steps.map((s) => (
          <li key={s}>{t(s)}</li>
        ))}
      </ol>
      <h3 className="mt-4 text-sm font-semibold">{c('title')}</h3>
      <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">{c('contacts')}</dt>
          <dd className="mt-0.5 font-mono text-xs">{CONTACT_COLUMNS.join(', ')}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{c('contactsHint')}</dd>
        </div>
        <div>
          <dt className="font-medium">{c('products')}</dt>
          <dd className="mt-0.5 font-mono text-xs">{PRODUCT_COLUMNS.join(', ')}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{c('productsHint')}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ShopsCard({ overview }: { overview: ExtSheetsOverview }) {
  const t = useTranslations('chrome-extension-sheets-addon.shops');
  const p = useTranslations('chrome-extension-sheets-addon.products');
  const locale = useLocale();
  if (!overview.installed) return null;
  return (
    <section aria-labelledby="sheets-shops" className={CARD}>
      <h2 id="sheets-shops" className={H2}>
        {t('title')}
      </h2>
      {overview.shops.length === 0 ? (
        <EmptyState className="mt-3" title={t('empty')} />
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {overview.shops.map((shop) => (
            <li key={shop.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{shopTitle(shop)}</p>
                <span className="flex items-center gap-1.5">
                  {!shop.enabled && <Badge tone="neutral">{t('disabled')}</Badge>}
                  <Badge>{shop.currency}</Badge>
                </span>
              </div>
              <a
                href={shop.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('open', { name: shopTitle(shop) })}
                className="mt-1 block break-all text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {shop.publicUrl}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('updated', { when: formatWhen(shop.updatedAt, locale) ?? '' })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 id="sheets-products" className={cn(H2, 'mt-5')}>
        {p('title')}
      </h2>
      {overview.recentProducts.length === 0 ? (
        <EmptyState className="mt-3" title={p('empty')} />
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {p('count', { count: overview.productCount })}
          </p>
          <ul
            aria-labelledby="sheets-products"
            className="mt-2 divide-y divide-border rounded-xl border border-border"
          >
            {overview.recentProducts.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{product.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatPrice(product.priceMajor, product.currencyCode, locale)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
