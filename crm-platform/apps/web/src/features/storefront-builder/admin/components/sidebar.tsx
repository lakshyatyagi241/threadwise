'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Select, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useOverview } from '../api/hooks';
import { formatInt, shopLabel } from '../lib/format';
import { isNoShop } from '../lib/errors';
import {
  MAIN_ENTRIES,
  SETTINGS_ENTRIES,
  activeKey,
  countFor,
  entryHref,
  visibleEntries,
  type SidebarEntry,
} from '../lib/sidebar';
import { ErrorPanel, Eyebrow, Skeleton } from './parts';
import { ExternalIcon, PathIcon, StoreIcon } from './icons';

const CARD = 'rounded-xl border border-border bg-background p-3 shadow-sm';

function CopyUrl({ url }: { url: string }) {
  const t = useTranslations('storefront-builder.admin.sidebar');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex-1 rounded-md px-2 py-1 text-center text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

function NavRow({
  entry,
  active,
  shopId,
  badge,
}: {
  entry: SidebarEntry;
  active: boolean;
  shopId: string | null;
  badge?: number;
}) {
  const t = useTranslations('storefront-builder.admin.sidebar');
  const locale = useLocale();
  const label = t(`items.${entry.key}`);
  const base = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm';
  if (entry.state === 'soon') {
    return (
      <span
        aria-disabled="true"
        title={t('comingSoonHint')}
        className={cn(base, 'cursor-not-allowed text-muted-foreground opacity-70')}
      >
        <PathIcon d={entry.icon} />
        {label}
        {badge !== undefined && badge > 0 && (
          <span className="ms-auto text-[11px] tabular-nums opacity-80">
            {formatInt(badge, locale)}
          </span>
        )}
        <span
          className={cn(
            'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium',
            !(badge !== undefined && badge > 0) && 'ms-auto',
          )}
        >
          {t('comingSoon')}
        </span>
      </span>
    );
  }
  return (
    <Link
      href={entryHref(entry, shopId)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground hover:bg-muted',
      )}
    >
      <PathIcon d={entry.icon} />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ms-auto text-[11px] tabular-nums opacity-80">
          {formatInt(badge, locale)}
        </span>
      )}
    </Link>
  );
}

/**
 * The left column of every `/store/*` page (WD-STORE-002): the shop card with its Live/Setup pill, the shop switcher
 * with two or more shops, the public URL, the section links and the sending-number panel. It reads the selected shop
 * from `?shop=`, so a page only has to render it. A workspace without a shop gets a "set up your store" card instead of
 * a broken page.
 */
export function StoreSidebar() {
  const t = useTranslations('storefront-builder.admin.sidebar');
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const shopParam = params.get('shop') ?? undefined;
  const overview = useOverview(shopParam);
  const active = activeKey(pathname);

  if (overview.isPending) {
    return (
      <aside aria-label={t('label')} className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </aside>
    );
  }

  if (overview.isError) {
    return (
      <aside aria-label={t('label')} className="space-y-3">
        {isNoShop(overview.error) ? (
          <div className={cn(CARD, 'space-y-2 p-4')}>
            <div className="text-base font-semibold">{t('noShopTitle')}</div>
            <p className="text-sm text-muted-foreground">{t('noShopMessage')}</p>
            <Link
              href="/connect?platform=wa-store"
              className="inline-block text-sm font-semibold text-primary hover:underline"
            >
              {t('noShopAction')}
            </Link>
          </div>
        ) : (
          <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} />
        )}
      </aside>
    );
  }

  const { shop, shops, counts, connection } = overview.data;
  const live = connection.live;
  const name = shop.shopName?.trim() || session.org.name || t('yourStore');
  const connectionLine =
    connection.kind === 'official'
      ? (connection.label ?? t('notConnected'))
      : connection.kind === 'device'
        ? `${t('unofficialApi')} · ${connection.label ?? ''}`.trim()
        : connection.kind === 'other_device'
          ? t('deviceConnected')
          : t('notConnected');
  const entries = visibleEntries(MAIN_ENTRIES, (p) => p in session.permissions);

  return (
    <aside aria-label={t('label')} className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      <div className={cn(CARD, 'p-4')}>
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <StoreIcon className="size-5" />
          </span>
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {t('live')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-border" />
              {t('setup')}
            </span>
          )}
        </div>
        <div className="mt-3 text-lg font-semibold leading-tight">{name}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground" dir="auto">
          {connectionLine}
        </div>
      </div>

      {shops.length > 1 && (
        <div className={CARD}>
          <Eyebrow className="mb-1.5 px-1">{t('switchShop')}</Eyebrow>
          <Select
            aria-label={t('switchShop')}
            value={shop.id}
            onChange={(e) => {
              if (e.target.value) router.push(`/store?shop=${encodeURIComponent(e.target.value)}`);
            }}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {shopLabel(s, t('shopFallback'))}
              </option>
            ))}
          </Select>
          <Link
            href="/connect?platform=wa-store"
            className="mt-2 block px-1 text-xs font-semibold text-primary hover:underline"
          >
            {t('manageShops')}
          </Link>
        </div>
      )}

      {shop.publicUrl && (
        <div className={CARD}>
          <Eyebrow className="mb-1.5 px-1">{t('publicUrl')}</Eyebrow>
          <div className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs" dir="ltr">
            {shop.publicUrl}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <a
              href={shop.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('open')} <ExternalIcon className="size-3" />
            </a>
            <CopyUrl url={shop.publicUrl} />
          </div>
        </div>
      )}

      <nav
        aria-label={t('navLabel')}
        className="space-y-0.5 rounded-xl border border-border bg-background p-2 shadow-sm"
      >
        <Eyebrow className="px-3 pb-1.5 pt-2">{t('section')}</Eyebrow>
        {entries.map((e) => (
          <NavRow
            key={e.key}
            entry={e}
            active={active === e.key}
            shopId={shop.id}
            badge={countFor(e.key, counts)}
          />
        ))}
        <Eyebrow className="px-3 pb-1.5 pt-3">{t('settings')}</Eyebrow>
        {SETTINGS_ENTRIES.map((e) => (
          <NavRow key={e.key} entry={e} active={active === e.key} shopId={shop.id} />
        ))}
      </nav>

      {live && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm leading-relaxed">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <span className="size-2 rounded-full bg-success" />
            {t('providerLive')}
          </div>
          {shop.sendingLabel ? (
            <p>
              {t('sendingFrom')}{' '}
              <span className="font-mono" dir="ltr">
                {shop.sendingLabel}
              </span>
              .
            </p>
          ) : (
            <p>
              {t('noDevice')}{' '}
              <Link href="/channels" className="font-semibold text-primary hover:underline">
                {t('connectOne')}
              </Link>
              , {t('thenBind')}{' '}
              <Link
                href="/connect?platform=wa-store"
                className="font-semibold text-primary hover:underline"
              >
                {t('connectWizard')}
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
