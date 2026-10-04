'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { WizardShop } from '../lib/wizard-form';
import { ArrowIcon, EditIcon, ExternalIcon, ShareIcon, TrashIcon } from './icons';
import { Eyebrow } from './parts';

const PILL =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const ROUND =
  'grid size-9 place-items-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** One shop of the wizard list (TW-STORE-003): brand strip, name, URL, sending number, domain state and the five actions. */
export function ShopCard({
  shop,
  canManage,
  onShare,
  onDelete,
}: {
  shop: WizardShop;
  canManage: boolean;
  onShare: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('storefront-builder.admin.wizard.card');
  const name = shop.shopName?.trim();
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
      <div
        className="relative h-20"
        style={{
          background:
            'linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 80%, transparent))',
        }}
      >
        <span className="absolute end-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/95 px-2 py-0.5 text-[11px] font-medium text-foreground">
          <span
            className={`size-1.5 rounded-full ${shop.enabled ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          {shop.enabled ? t('live') : t('disabled')}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <Eyebrow>{t('theme', { theme: shop.themeKey })}</Eyebrow>
        <h3 className="mt-0.5 text-xl font-semibold leading-tight" dir="auto">
          {name || t('untitled')}
        </h3>
        <div className="mt-1.5 break-all font-mono text-xs" dir="ltr">
          {shop.publicUrl}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('sendingFrom')}
            </dt>
            <dd className="mt-0.5 truncate" dir="auto">
              {shop.sendingLabel || t('noDevice')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('domain')}
            </dt>
            <dd className="mt-0.5 truncate">
              {shop.customDomain ? (
                <>
                  <span dir="ltr">{shop.customDomain}</span>{' '}
                  {shop.customDomainVerified ? '✓' : `· ${t('pending')}`}
                </>
              ) : (
                t('builtIn')
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={`/store?shop=${encodeURIComponent(shop.id)}`}
            title={t('manageTitle')}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand px-3 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t('manage')} <ArrowIcon className="size-3 rtl:rotate-180" />
          </Link>
          <a
            href={shop.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t('previewTitle')}
            className={PILL}
          >
            <ExternalIcon className="size-3" /> {t('preview')}
          </a>
          {canManage && (
            <Link
              href={`/connect?platform=wa-store&shop=${encodeURIComponent(shop.id)}`}
              title={t('editTitle')}
              className={PILL}
            >
              <EditIcon className="size-3" /> {t('edit')}
            </Link>
          )}
          <button
            type="button"
            onClick={onShare}
            title={t('share')}
            aria-label={t('shareAria', { name: name || t('untitled') })}
            className={`${ROUND} hover:border-primary/40 hover:bg-primary/5 hover:text-primary`}
          >
            <ShareIcon className="size-3.5" />
          </button>
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              title={t('delete')}
              aria-label={t('deleteAria', { name: name || t('untitled') })}
              className={`${ROUND} hover:border-danger/40 hover:bg-danger/10 hover:text-danger`}
            >
              <TrashIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
