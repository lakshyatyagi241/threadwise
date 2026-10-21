'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';

type Phase = 'loading' | 'ready' | 'working' | 'done' | 'already' | 'invalid' | 'error';

const base = (token: string) => `/api/public/consent/${encodeURIComponent(token)}`;

/**
 * The page an email's unsubscribe link opens (`/u/<token>`, BL-141). No login and no app shell: the signed token in the address is the
 * only credential. It asks the API whether the link is valid, shows one button, and writes the withdrawal only when it is pressed
 * (a mail scanner that opens the link does not unsubscribe anyone; the mail client's one-click header does).
 */
export function UnsubscribePage({ token }: { token: string }) {
  const t = useTranslations('contact-consent.unsubscribe');
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    const ctl = new AbortController();
    fetch(base(token), { cache: 'no-store', credentials: 'omit', signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) return setPhase(res.status === 404 ? 'invalid' : 'error');
        const body = (await res.json()) as { unsubscribed?: boolean };
        setPhase(body.unsubscribed ? 'already' : 'ready');
      })
      .catch(() => {
        if (!ctl.signal.aborted) setPhase('error');
      });
    return () => ctl.abort();
  }, [token]);

  async function confirm() {
    setPhase('working');
    try {
      const res = await fetch(base(token), {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setPhase(res.ok ? 'done' : res.status === 404 ? 'invalid' : 'error');
    } catch {
      setPhase('error');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-10">
      {phase === 'loading' && <Spinner />}
      {(phase === 'ready' || phase === 'working' || phase === 'error') && (
        <>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p>{t('intro')}</p>
          {phase === 'error' && <Alert tone="danger">{t('error')}</Alert>}
          <Button onClick={confirm} disabled={phase === 'working'}>
            {phase === 'working' ? t('working') : t('confirm')}
          </Button>
        </>
      )}
      {phase === 'done' && (
        <>
          <h1 className="text-xl font-semibold">{t('doneTitle')}</h1>
          <p>{t('doneBody')}</p>
        </>
      )}
      {phase === 'already' && (
        <>
          <h1 className="text-xl font-semibold">{t('doneTitle')}</h1>
          <p>{t('already')}</p>
        </>
      )}
      {phase === 'invalid' && (
        <>
          <h1 className="text-xl font-semibold">{t('invalidTitle')}</h1>
          <p>{t('invalidBody')}</p>
        </>
      )}
    </main>
  );
}
