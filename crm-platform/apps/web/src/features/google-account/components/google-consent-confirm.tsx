'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { GoogleCapability } from '@crm/contracts';
import { Alert, Badge, Button, Spinner, cn } from '@crm/ui';
import { googleConsentApi, useGoogleConsent } from '../api/google-account';
import { consentFailureOf, consentReturnAddress, readConsentId } from '../lib/model';

const CARD = 'rounded-xl border border-border bg-card p-5 shadow-sm';

/**
 * The page Google's redirect ends on (TW-GACC-010). Nothing is connected until the person who pressed Connect, signed in to the same
 * workspace, reads who and what and presses Confirm. A link forwarded to somebody else ends here with a plain refusal, so a consent
 * cannot be completed by another person.
 */
export function GoogleConsentConfirm() {
  const t = useTranslations('google-account.consent');
  const tp = useTranslations('google-account.page');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const id = readConsentId(`?${params.toString()}`);
  const consent = useGoogleConsent(id);
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function end(how: 'confirm' | 'cancel') {
    if (!id) return;
    setBusy(how);
    setError(null);
    try {
      const result = await (how === 'confirm'
        ? googleConsentApi.confirm(id)
        : googleConsentApi.cancel(id));
      router.replace(consentReturnAddress(result));
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  const names = (keys: readonly GoogleCapability[]) =>
    new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
      keys.map((k) => tp(`permissions.${k}.name`)),
    );

  const failure = consent.isError
    ? consentFailureOf(consent.error)
    : error
      ? consentFailureOf(error)
      : null;
  const data = consent.data;

  return (
    <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-10">
      <header>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {tp('eyebrow')}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </header>

      {!id && (
        <Alert tone="danger">
          <p>{t('failure.notFound')}</p>
        </Alert>
      )}

      {id && consent.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> {t('loading')}
        </div>
      )}

      {id && failure && !data && (
        <Alert tone="danger">
          <p className="font-medium">{t(`failure.${failure}`)}</p>
          <p className="mt-1 text-xs">{t('failure.nothingConnected')}</p>
        </Alert>
      )}

      {id && data && (
        <section className={cn(CARD, 'space-y-4')} aria-labelledby="gc-question">
          <h2 id="gc-question" className="text-base font-semibold">
            {t('question', {
              email: data.googleEmail ?? t('unknownAccount'),
              workspace: data.workspaceName,
              permissions: names(data.granted.length > 0 ? data.granted : data.requested),
            })}
          </h2>
          <ul className="flex flex-wrap gap-2" aria-label={t('permissions')}>
            {data.granted.map((k) => (
              <li key={k}>
                <Badge tone="success">{tp(`permissions.${k}.name`)}</Badge>
              </li>
            ))}
            {data.missing.map((k) => (
              <li key={k}>
                <Badge tone="warning">
                  {tp(`permissions.${k}.name`)}: {t('notGiven')}
                </Badge>
              </li>
            ))}
          </ul>
          {data.missing.length > 0 && (
            <Alert tone="warning">
              <p>{t('missing', { permissions: names(data.missing) })}</p>
            </Alert>
          )}
          {data.replacesAccount && (
            <Alert tone="warning">
              <p>{t('replaces', { email: data.replacesAccount })}</p>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{t('onlyYou')}</p>
          {failure && (
            <Alert tone="danger">
              <p>{t(`failure.${failure}`)}</p>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void end('confirm')} disabled={busy !== null}>
              {busy === 'confirm' ? t('working') : t('confirm')}
            </Button>
            <Button variant="secondary" onClick={() => void end('cancel')} disabled={busy !== null}>
              {busy === 'cancel' ? t('working') : t('cancel')}
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
