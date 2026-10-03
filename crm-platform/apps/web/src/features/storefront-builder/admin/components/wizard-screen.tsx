'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Alert, ConfirmDialog, EmptyState, Button, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { useDeleteShop, useResetAll, useWizard } from '../api/hooks';
import { resolveMode, type WizardShop } from '../lib/wizard-form';
import { errorKind } from '../lib/errors';
import { ArrowIcon, BackIcon, PlusIcon, WhatsAppIcon } from './icons';
import { ErrorPanel, Eyebrow, LinkButton, Skeleton, useErrorLine } from './parts';
import { ShareModal, type ShareTarget } from './share-modal';
import { ShopCard } from './shop-card';
import { ShopForm } from './shop-form';

const LIST_HREF = '/connect?platform=wa-store';

/**
 * `/connect?platform=wa-store` (WD-STORE-003..005, 030): the shop wizard. A workspace without any WhatsApp sender sees
 * "Connect WhatsApp first"; otherwise the list of shops, or the add / edit form.
 */
export function WizardScreen() {
  const t = useTranslations('storefront-builder.admin.wizard');
  const errorLine = useErrorLine();
  const router = useRouter();
  const { toast } = useToast();
  const session = useSession();
  const canManage = useCan('store.shops.manage');
  const params = useSearchParams();
  const wizard = useWizard();
  const del = useDeleteShop();
  const reset = useResetAll();
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [deleting, setDeleting] = useState<WizardShop | null>(null);
  const [resetting, setResetting] = useState(false);
  // An action error belongs to the address it happened on: navigating elsewhere hides it.
  const here = params.toString();
  const [failure, setFailure] = useState<{ message: string; at: string } | null>(null);
  const actionError = failure && failure.at === here ? failure.message : null;
  const setActionError = (message: string | null) =>
    setFailure(message === null ? null : { message, at: here });

  const mode = wizard.data
    ? resolveMode({ shop: params.get('shop'), action: params.get('action') }, wizard.data.shops)
    : null;
  const workspace = session.org.name;
  const shopName = (s: WizardShop) => s.shopName?.trim() || t('delete.thisShop');

  const confirmDelete = () => {
    if (!deleting) return;
    setActionError(null);
    del.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null);
        toast(t('delete.done'));
        router.push(LIST_HREF);
      },
      onError: (error) => {
        setDeleting(null);
        setActionError(errorLine(error));
      },
    });
  };

  const confirmReset = () => {
    setActionError(null);
    reset.mutate(undefined, {
      onSuccess: () => {
        setResetting(false);
        toast(t('reset.done'));
        router.push(LIST_HREF);
      },
      onError: (error) => {
        setResetting(false);
        setActionError(
          errorKind(error) === 'resetNotConfirmed' ? t('reset.notConfirmed') : errorLine(error),
        );
      },
    });
  };

  const title =
    mode?.kind === 'edit'
      ? t('titles.edit', { name: mode.shop.shopName?.trim() || t('titles.shopFallback') })
      : mode?.kind === 'add'
        ? t('titles.add')
        : t('titles.list');

  return (
    <div className="-m-4 md:-m-6">
      <div className="border-b border-border bg-background">
        <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={
                mode && mode.kind !== 'list' && wizard.data && wizard.data.shops.length > 0
                  ? LIST_HREF
                  : '/channels'
              }
              title={t('back')}
              aria-label={t('back')}
              className="grid size-8 place-items-center rounded-full border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <BackIcon className="size-3.5 rtl:rotate-180" />
            </Link>
            <div className="min-w-0">
              <Eyebrow>{t('breadcrumb')}</Eyebrow>
              <h1 className="truncate text-xl font-semibold leading-tight" dir="auto">
                {title}
              </h1>
            </div>
          </div>
          <Link
            href="/channels"
            className="shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            {t('manageConnections')}
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] space-y-5 px-4 py-8 sm:px-6">
        {actionError && <Alert tone="danger">{actionError}</Alert>}

        {wizard.isPending ? (
          <div role="status" aria-label={t('loading')} className="space-y-4">
            <Skeleton className="h-16" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
          </div>
        ) : wizard.isError ? (
          <ErrorPanel error={wizard.error} onRetry={() => void wizard.refetch()} />
        ) : !wizard.data.hasSender ? (
          <div className="flex items-start gap-5 rounded-2xl border border-border bg-background p-6 shadow-sm">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10">
              <WhatsAppIcon className="size-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>{t('gate.step')}</Eyebrow>
              <h2 className="mt-0.5 text-xl font-semibold leading-tight">{t('gate.title')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{t('gate.message')}</p>
              <LinkButton href="/channels" className="mt-4 rounded-full">
                {t('gate.action')} <ArrowIcon className="size-3 rtl:rotate-180" />
              </LinkButton>
            </div>
          </div>
        ) : mode?.kind === 'list' ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold leading-tight sm:text-3xl">
                  {t('list.headline', { count: wizard.data.shops.length, workspace })}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{t('list.intro')}</p>
              </div>
              {canManage && (
                <LinkButton href="/connect?platform=wa-store&action=add" className="rounded-full">
                  <PlusIcon className="size-3" /> {t('list.add')}
                </LinkButton>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {wizard.data.shops.map((s) => (
                <ShopCard
                  key={s.id}
                  shop={s}
                  canManage={canManage}
                  onShare={() =>
                    setShare({
                      url: s.publicUrl,
                      name: s.shopName?.trim() || t('share.fallbackName'),
                    })
                  }
                  onDelete={() => setDeleting(s)}
                />
              ))}
              {canManage && (
                <Link
                  href="/connect?platform=wa-store&action=add"
                  className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-8 text-center transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="mb-3 grid size-12 place-items-center rounded-xl bg-primary/10">
                    <PlusIcon className="size-5 text-primary" />
                  </span>
                  <span className="text-lg font-semibold">{t('list.addAnother')}</span>
                  <span className="mt-1 max-w-[220px] text-sm text-muted-foreground">
                    {t('list.addAnotherHint')}
                  </span>
                </Link>
              )}
            </div>

            {canManage && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10"
                  onClick={() => setResetting(true)}
                >
                  {t('reset.open')}
                </Button>
              </div>
            )}
          </>
        ) : mode && !canManage ? (
          <EmptyState
            title={t('noAccess.title')}
            message={t('noAccess.message')}
            actions={
              <LinkButton href={LIST_HREF} variant="secondary">
                {t('noAccess.action')}
              </LinkButton>
            }
          />
        ) : mode ? (
          <ShopForm
            key={mode.kind === 'edit' ? mode.shop.id : 'add'}
            wizard={wizard.data}
            shop={mode.kind === 'edit' ? mode.shop : null}
            workspaceName={workspace}
            onDelete={() => mode.kind === 'edit' && setDeleting(mode.shop)}
            onShare={() =>
              mode.kind === 'edit' &&
              setShare({
                url: mode.shop.publicUrl,
                name: mode.shop.shopName?.trim() || t('share.fallbackName'),
              })
            }
          />
        ) : null}
      </div>

      <ShareModal target={share} onClose={() => setShare(null)} />

      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={del.isPending}
        title={t('delete.title', { name: deleting ? shopName(deleting) : '' })}
        message={t('delete.message')}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={resetting}
        tone="danger"
        busy={reset.isPending}
        title={t('reset.title')}
        message={t('reset.message')}
        confirmLabel={t('reset.confirm')}
        cancelLabel={t('delete.cancel')}
        onConfirm={confirmReset}
        onClose={() => setResetting(false)}
      />
    </div>
  );
}
