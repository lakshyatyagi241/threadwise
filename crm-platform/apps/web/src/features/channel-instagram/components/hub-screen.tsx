'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Spinner, useToast } from '@crm/ui';
import type { LinkIgAccountInput } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { KEYS, linkAccount, useAccounts } from '../api/instagram';
import { connectedAccount, engineOrigin } from '../lib/accounts-model';
import { AccountRow } from './account-row';
import { ConnectDialog } from './connect-dialog';
import { InstagramGlyph, InstagramGradientGlyph, PlusIcon } from './ig-icons';

const pillLink =
  'inline-flex h-9 items-center rounded-full border border-border bg-background px-4 text-xs font-medium hover:bg-muted';

/**
 * `/instagram` (TW-IG-001, 002, 006): the Instagram accounts linked to this workspace, with the "Add an Instagram account" dialog.
 * Reference showed them among the channels on the devices screen; they have their own hub here, built from the same parts so the
 * Channels page can show them too. A window the engine sends back with no opener lands here with `?ig_account=<id>` and is linked.
 */
export function HubScreen() {
  const t = useTranslations('instagram.hub');
  const accounts = useAccounts();
  const canManage = useCan('ig.accounts.manage');
  const canBroadcast = useCan('ig.broadcasts.manage');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const bridge = accounts.data?.bridge;
  const list = accounts.data?.data ?? [];

  /** Links an account and refreshes; the caller decides what to do when it fails. */
  const link = useCallback(
    async (input: LinkIgAccountInput) => {
      await linkAccount(input);
      toast(t('linked'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.all });
    },
    [qc, t, toast],
  );

  // The sign-in popup tells this window when an account was connected on the engine; only the engine's own origin is believed.
  const origin = engineOrigin(bridge?.manageUrl ?? null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const id = connectedAccount(e, origin);
      if (id === null) return;
      link({ instaflowAccountId: id }).catch((err: unknown) =>
        toast(err instanceof ApiError ? err.message : t('linkFailed'), 'danger'),
      );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, link, toast, t]);

  // A window with no opener comes back with the account id in the address: link it once, then take it out of the address.
  const returned = useRef(false);
  useEffect(() => {
    const id = search.get('ig_account');
    if (!id || returned.current) return;
    returned.current = true;
    link({ instaflowAccountId: id })
      .catch((err: unknown) =>
        toast(err instanceof ApiError ? err.message : t('linkFailed'), 'danger'),
      )
      .finally(() => router.replace(pathname));
  }, [search, link, toast, router, pathname, t]);

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
          {canBroadcast && count > 0 && (
            <Link href="/instagram/broadcast" className={pillLink}>
              {t('broadcasts')}
            </Link>
          )}
        </div>
      </div>

      {accounts.isError && <Alert tone="danger">{t('loadError')}</Alert>}
      {bridge && !bridge.connected && (
        <Alert tone="info">{t('engineOff', { engine: bridge.brand })}</Alert>
      )}

      <div className="rounded-2xl border border-border bg-gradient-to-br from-muted to-background p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-background shadow-sm">
            <InstagramGradientGlyph className="size-6" />
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
        {canManage && bridge?.connected && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <PlusIcon className="size-3.5" />
              {t('add')}
            </button>
          </div>
        )}
      </div>

      {accounts.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        bridge &&
        count > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <InstagramGlyph className="size-3" />
              {t('linkedAccounts')}
            </div>
            {list.map((a) => (
              <AccountRow key={a.id} account={a} bridge={bridge} canManage={canManage} />
            ))}
          </div>
        )
      )}

      {bridge?.connected && (
        <ConnectDialog
          open={open}
          engine={bridge.brand}
          onClose={() => setOpen(false)}
          onLink={link}
        />
      )}
    </main>
  );
}
