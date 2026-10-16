'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { leadError } from '../lib/errors';
import type { MetaLogin } from './use-meta-login';

/**
 * A failed Meta call, in words, with the way out its code points to: a Page without lead access offers "Grant lead access", a Page
 * whose token Meta refused offers "Reconnect", and a Meta that did not answer offers "Try again". The choice is by the problem
 * `code` (through `leadError`), never by the server's wording. The one server text shown is Meta's own refusal, labelled as such.
 */
export function MetaFailure({
  error,
  onRetry,
  login,
  canLogin = true,
}: {
  error: unknown;
  onRetry?: () => void;
  login?: MetaLogin;
  /** The person may start the Facebook login (`leads.sources.manage` and `fb.pages.manage`). */
  canLogin?: boolean;
}) {
  const t = useTranslations('lead-sources');
  const e = leadError(error);

  if (e.kind === 'locked') {
    return (
      <Alert tone="warning" className="space-y-2" data-testid="meta-failure" data-kind="locked">
        <p>{t('meta.planLocked')}</p>
        <Link
          href={e.upgradeUrl ?? PLAN_UPGRADE_PATH}
          className="font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('states.upgrade')}
        </Link>
      </Alert>
    );
  }

  const offerLogin = login && canLogin && (e.kind === 'grantAccess' || e.kind === 'reconnect');
  const offerRetry = onRetry && e.kind !== 'grantAccess' && e.kind !== 'reconnect';
  return (
    <Alert tone="danger" className="space-y-2" data-testid="meta-failure" data-kind={e.kind}>
      <p>{t(`errors.${e.key}`, e.values)}</p>
      {e.metaSaid && (
        <p className="text-xs">
          {t('meta.metaSaid')} <span dir="auto">{e.metaSaid}</span>
        </p>
      )}
      {(offerLogin || offerRetry) && (
        <div className="flex flex-wrap items-center gap-2">
          {offerLogin && (
            <Button size="sm" variant="secondary" disabled={login.pending} onClick={login.run}>
              {login.pending && <Spinner />}
              {e.kind === 'grantAccess' ? t('meta.page.grant') : t('meta.page.reconnect')}
            </Button>
          )}
          {offerRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
      {e.requestId && (
        <p className="text-xs opacity-80">
          {t('meta.requestId')} <code dir="ltr">{e.requestId}</code>
        </p>
      )}
    </Alert>
  );
}
