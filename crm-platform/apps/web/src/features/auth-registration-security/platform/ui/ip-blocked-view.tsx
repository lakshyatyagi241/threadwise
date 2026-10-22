'use client';

import Link from 'next/link';
import { useSyncExternalStore, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, Spinner } from '@crm/ui';
import { ALLOWLIST_TAB, ipBlockStore } from '../lib/ip-blocked';
import { securityTabHref } from '../lib/links';
import { OPERATOR_LOGIN_PATH } from '../operator-fetch';
import { signOut as doSignOut } from '../../shared/sign-out';
import { CopyButton } from './copy-button';

const NS = 'auth-registration-security.platform.ipBlocked';
const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary';

/** The refusal recorded by `operatorFetch`, or null while every call is getting through. */
export function useIpBlock(): { ip: string | null } | null {
  return useSyncExternalStore(ipBlockStore.subscribe, ipBlockStore.get, () => null);
}

/**
 * The 403 page for an operator whose address is not on the allowlist (TW-AUTH-038): which address
 * was refused, where the list is edited, and the two ways out. Rendered inside the console shell in
 * place of the screen, and reusable by any layout that learns about the block on the server.
 */
export function IpBlockedView({ ip }: { ip: string | null }) {
  const t = useTranslations(NS);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    ipBlockStore.clear();
    // The sign-out call is itself an operator route and may be refused too; the helper navigates either way, and fully, so no
    // query cache of this operator outlives the sign-out.
    await doSignOut(OPERATOR_LOGIN_PATH, '/api/platform-auth/logout');
  };

  return (
    <section
      aria-labelledby="ip-blocked-title"
      className="mx-auto flex min-h-[60vh] max-w-xl items-center"
    >
      <Card className="w-full space-y-5 border-danger/40 p-6">
        <header className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-danger">
            {t('kicker')}
          </p>
          <h1 id="ip-blocked-title" className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('body')}</p>
        </header>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t('addressLabel')}</p>
          {ip ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2">
              <code dir="ltr" className="break-all font-mono text-sm font-medium">
                {ip}
              </code>
              <CopyButton text={ip} className="ms-auto" />
            </div>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('addressUnknown')}
            </p>
          )}
        </div>

        <div className="space-y-1.5 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{t('fixTitle')}</p>
          <p className="text-muted-foreground">{t('fixBody')}</p>
          <p className="font-mono text-xs" dir="auto">
            <Link
              href={securityTabHref(ALLOWLIST_TAB)}
              className="text-primary underline-offset-4 hover:underline"
            >
              {t('fixPath')}
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            onClick={() => ipBlockStore.clear()}
            className={`${LINK_BUTTON} bg-primary text-primary-foreground hover:opacity-90`}
          >
            {t('dashboard')}
          </Link>
          <Button variant="secondary" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut && <Spinner label={t('signingOut')} />}
            {signingOut ? t('signingOut') : t('signOut')}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/**
 * The same view as a page of its own, for a layout that learns about the block on the server before
 * any console shell exists (the session read answered 403 AUTH_IP_BLOCKED).
 */
export function IpBlockedPage({ ip }: { ip: string | null }) {
  return (
    <main className="min-h-dvh bg-background p-4 text-foreground md:p-6">
      <IpBlockedView ip={ip} />
    </main>
  );
}
