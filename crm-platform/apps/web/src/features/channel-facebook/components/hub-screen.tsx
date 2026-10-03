'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useConfig, usePages } from '../api/facebook';
import { ConnectModal } from './connect-modal';
import { FB_BLUE, FacebookGlyph, PlusIcon } from './fb-icons';
import { PageRow } from './page-row';

const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/facebook` (WD-FB-001 to 005): connect a Facebook account or a Page token, and see and manage every connected Page. WaDesk showed
 * Pages among the channels on the devices screen; they have their own hub here. The login comes back with `?fb=connected|error`.
 */
export function HubScreen() {
  const t = useTranslations('facebook.hub');
  const pages = usePages();
  const config = useConfig();
  const canManage = useCan('fb.pages.manage');
  const canBroadcast = useCan('fb.broadcasts.read');
  const canPosts = useCan('fb.posts.read');
  const canSetup = useCan('fb.setup.manage');
  const [open, setOpen] = useState(false);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // The notice from the login round trip is read once, then taken out of the address.
  const [notice] = useState<{ ok: boolean; text: string } | null>(() => {
    const fb = search.get('fb');
    const text = search.get('message');
    return fb && text ? { ok: fb === 'connected', text } : null;
  });
  useEffect(() => {
    if (search.has('fb')) router.replace(pathname);
  }, [search, router, pathname]);

  const list = pages.data?.data ?? [];
  const count = list.length;

  return (
    <main className="mx-auto max-w-none space-y-6 px-4 py-7 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('kicker')}
          </div>
          <h1 className="text-3xl font-normal leading-none tracking-tight sm:text-[40px]">
            {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/team-inbox" className={pillLink}>
            {t('teamInbox')}
          </Link>
          {canPosts && (
            <Link href="/facebook/posts" className={pillLink}>
              {t('posts')}
            </Link>
          )}
          {canSetup && (
            <Link href="/facebook/setup" className={pillLink}>
              {t('setup')}
            </Link>
          )}
          {canBroadcast && (
            <Link href="/facebook/broadcasts" className={pillLink}>
              {t('broadcasts')}
            </Link>
          )}
        </div>
      </div>

      {notice && <Alert tone={notice.ok ? 'success' : 'danger'}>{notice.text}</Alert>}
      {pages.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {config.data && !config.data.configured && <Alert tone="info">{t('notConfigured')}</Alert>}

      <div className="rounded-2xl border border-border bg-gradient-to-br from-[#E8F0FE] to-background p-5 shadow-sm sm:p-6 dark:from-muted dark:to-background">
        <div className="flex items-start justify-between gap-3">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-2xl text-white"
            style={{ background: FB_BLUE }}
          >
            <FacebookGlyph className="size-6" />
          </span>
          {count > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 font-mono text-[11px] text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {t('connectedCount', { count })}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              {t('notConnected')}
            </span>
          )}
        </div>
        <div className="mt-4 text-[22px] leading-tight">{t('cardTitle')}</div>
        <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
          {t('cardBody')}
        </p>
        {canManage && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
              style={{ background: FB_BLUE }}
            >
              <PlusIcon className="size-3.5" />
              {count > 0 ? t('connectAnother') : t('connect')}
            </button>
          </div>
        )}
      </div>

      {pages.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        count > 0 && (
          <div className="space-y-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('connectedPages')}
            </div>
            {list.map((p) => (
              <PageRow key={p.id} page={p} canManage={canManage} />
            ))}
          </div>
        )
      )}

      {config.data && (
        <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="text-[13px] font-semibold">{t('webhookTitle')}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {t('webhookBody')}
          </p>
          <code className="mt-2 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px]">
            {config.data.webhookUrl}
          </code>
        </div>
      )}

      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </main>
  );
}
